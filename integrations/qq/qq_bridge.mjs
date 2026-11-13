/**
 * 知序 · QQ 分享桥（可选）
 *
 * 作用：连接本地 OneBot 11 WebSocket（NapCat / Lagrange / LLOneBot 等），
 *      把私聊里收到的链接：
 *        1) 交给知序服务端抓正文（/api/resolve）
 *        2) 让 AI 提炼成知识卡片（/api/analyze）
 *        3) 在 QQ 里直接回一张「摘要卡」
 *        4) 同时投递到「分享收件箱」（带上已提炼好的卡片，网页端一键确认即可入库）
 *
 * 运行：
 *   node qq_bridge.mjs
 *
 * 环境变量：
 *   QQ_WS_URL          OneBot WebSocket 地址，默认 ws://127.0.0.1:3001
 *   QQ_ACCESS_TOKEN    OneBot access token（没有就留空）
 *   ZHIXU_BASE         知序服务地址，默认 http://127.0.0.1:8788
 *   ZHIXU_INBOX_URL    收件箱接口，默认 {ZHIXU_BASE}/api/inbox
 *   ZHIXU_INBOX_TOKEN  收件箱 token（服务端设了 WJ_INBOX_TOKEN 才需要）
 *   QQ_ALLOWED_USERS   允许的 QQ 号，逗号分隔；留空=接受所有私聊
 *   QQ_SUMMARY         1=抓正文+AI 提炼+回摘要（默认 1）；0=只投递链接
 *   QQ_REPLY           1=回复（默认 1，摘要模式会自动开）
 *   QQ_REPLY_FULL      1=连要点一起回；默认 0 只回标题+摘要
 *
 * 依赖：Node.js 22+（内置 WebSocket / fetch），不需要 npm install。
 * 安全：只处理私聊；不要把 OneBot 端口暴露到公网。
 */
const WS_URL = process.env.QQ_WS_URL || 'ws://127.0.0.1:3001';
const ACCESS_TOKEN = process.env.QQ_ACCESS_TOKEN || '';
const BASE = (process.env.ZHIXU_BASE || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const INBOX_URL = process.env.ZHIXU_INBOX_URL || BASE + '/api/inbox';
const INBOX_TOKEN = process.env.ZHIXU_INBOX_TOKEN || '';
const ALLOWED = (process.env.QQ_ALLOWED_USERS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SUMMARY = process.env.QQ_SUMMARY !== '0';
const REPLY = process.env.QQ_REPLY !== '0' || SUMMARY;
const REPLY_FULL = process.env.QQ_REPLY_FULL === '1';

// 账号绑定：结果一对一转发到该账号绑定的 QQ（可选）
const AUTH_TOKEN = process.env.ZHIXU_AUTH_TOKEN || '';
const ONEBOT_HTTP = (process.env.QQ_ONEBOT_HTTP || '').replace(/\/+$/, '');
const CLOUD_API = (process.env.ZHIXU_CLOUD_API || 'https://zhixu-note.netlify.app').replace(/\/+$/, '');

if (typeof WebSocket === 'undefined') {
  console.error('需要 Node.js 22+（内置 WebSocket）。当前版本：' + process.version);
  process.exit(1);
}

const seen = new Map();
let retry = 0;

export function textOf(event) {
  const parts = [];
  if (typeof event.raw_message === 'string') parts.push(event.raw_message);
  if (Array.isArray(event.message)) {
    for (const seg of event.message) {
      if (seg && seg.type === 'text' && seg.data && seg.data.text) parts.push(String(seg.data.text));
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function urlsOf(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"'，。！？、；：）】》」』]+/g;
  let m;
  while ((m = re.exec(text))) {
    const url = m[0].replace(/[，。！？、；：,.!?)）】》」』]+$/, '');
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

async function postJson(url, payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (INBOX_TOKEN && /\/api\/inbox/.test(url)) headers['X-Inbox-Token'] = INBOX_TOKEN;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* 保留原文 */ }
  return { ok: res.ok, status: res.status, json, text };
}

/** 抓正文 */
async function resolveUrl(url) {
  try {
    const r = await postJson(BASE + '/api/resolve', { url });
    if (!r.ok || !r.json) return { ok: false, blocked: true, note: '服务端读取失败 HTTP ' + r.status };
    return r.json;
  } catch (e) {
    return { ok: false, blocked: true, note: '读取失败：' + e.message };
  }
}

/** AI 提炼（服务端没配 key 时会失败，自动降级） */
async function analyzeText(text, url) {
  try {
    const r = await postJson(BASE + '/api/analyze', { text, url });
    if (r.ok && r.json && r.json.ok && r.json.card) return r.json.card;
    return null;
  } catch (e) {
    return null;
  }
}

function cardReply(card, url, item) {
  const lines = [];
  lines.push('【知序】' + (card.title || '已归档'));
  if (card.summary) lines.push(card.summary);
  if (REPLY_FULL && Array.isArray(card.points) && card.points.length) {
    lines.push('要点：');
    card.points.slice(0, 3).forEach((p, i) => lines.push((i + 1) + '. ' + p));
  }
  if (Array.isArray(card.tags) && card.tags.length) lines.push('标签：' + card.tags.join(' / '));
  if (card.category) lines.push('归档：' + card.category + ' › ' + (card.topic || '综合笔记'));
  lines.push('已放进收件箱，打开知序点「读取并归档」即可确认。');
  return lines.join('\n');
}

let cachedQQ = { qq: '', at: 0 };

/** 查询当前账号绑定的接收 QQ（缓存 60 秒） */
export async function boundQQ() {
  if (!AUTH_TOKEN) return '';
  if (Date.now() - cachedQQ.at < 60000) return cachedQQ.qq;
  try {
    const r = await postJson(CLOUD_API + '/api/auth', { action: 'me', token: AUTH_TOKEN });
    const qq = r.ok && r.json && r.json.ok && r.json.user ? String(r.json.user.qq || '') : '';
    cachedQQ = { qq: qq, at: Date.now() };
    return qq;
  } catch (e) {
    return '';
  }
}

/** 把摘要一对一转发到绑定 QQ（不重复发给发送者本人） */
export async function forwardToBoundQQ(text, senderId) {
  if (!ONEBOT_HTTP || !AUTH_TOKEN || !text) return false;
  const qq = await boundQQ();
  if (!qq || String(qq) === String(senderId)) return false;
  try {
    const r = await postJson(ONEBOT_HTTP + '/send_private_msg', { user_id: Number(qq) || qq, message: text });
    if (r.ok) console.log('[qq] 已转发到绑定账号 ' + qq);
    return r.ok;
  } catch (e) {
    console.error('[qq] 转发到绑定账号失败：' + e.message);
    return false;
  }
}

/** 处理一条链接：抓取 → 提炼 → 回消息 → 投递收件箱（导出供测试调用） */
export async function handleUrl(url, event) {
  const key = url;
  const now = Date.now();
  if (seen.has(key) && now - seen.get(key) < 60000) return { skipped: true };
  seen.set(key, now);

  const from = 'QQ · ' + (event.sender && event.sender.nickname ? event.sender.nickname : event.user_id);
  let card = null;
  let resolved = null;
  let note = '';

  if (SUMMARY) {
    resolved = await resolveUrl(url);
    const text = String((resolved && (resolved.text || resolved.description)) || '').trim();
    if (resolved && resolved.blocked) {
      note = resolved.note || '这个链接读不到正文，已保留为来源。';
    } else if (text.length >= 12) {
      card = await analyzeText(text, url);
      if (!card) note = '正文已抓到，但 AI 提炼暂时不可用（服务端未配置 key？），已保留正文。';
    } else {
      note = '这个链接没有可读正文，已保留为来源。';
    }
  }

  const payload = {
    url,
    from,
    title: card ? card.title : (resolved && (resolved.title || resolved.site)) || '',
    text: card
      ? [card.summary].concat(Array.isArray(card.points) ? card.points : []).join('\n')
      : String((resolved && (resolved.text || resolved.description)) || ''),
    card: card || undefined
  };

  const inbox = await postJson(INBOX_URL, payload);
  if (!inbox.ok) {
    console.error(`[inbox] ${inbox.status} ${String(inbox.text).slice(0, 120)}`);
  } else {
    console.log(`[inbox] 已投递 ${url}${card ? '（含 AI 摘要）' : ''}`);
  }

  return { card, note, inboxOk: inbox.ok };
}

function reply(ws, event, text) {
  if (!REPLY || !text) return;
  const action = event.message_type === 'group'
    ? { action: 'send_group_msg', params: { group_id: event.group_id, message: text }, echo: 'reply' }
    : { action: 'send_private_msg', params: { user_id: event.user_id, message: text }, echo: 'reply' };
  try { ws.send(JSON.stringify(action)); } catch (e) { /* 忽略 */ }
}

function connect() {
  const url = WS_URL + (ACCESS_TOKEN ? (WS_URL.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(ACCESS_TOKEN) : '');
  console.log('[qq] 连接 ' + WS_URL + ' …');
  const ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    retry = 0;
    console.log('[qq] 已连接 OneBot；把链接私聊发给机器人即可');
    console.log('[qq] 模式：' + (SUMMARY ? '抓正文 + AI 提炼 + 回摘要' : '只投递链接'));
    console.log('[qq] 允许用户：' + (ALLOWED.length ? ALLOWED.join(', ') : '所有私聊（建议设置 QQ_ALLOWED_USERS）'));
  });

  ws.addEventListener('message', async (ev) => {
    let data;
    try { data = JSON.parse(String(ev.data)); } catch (e) { return; }
    if (!data || data.post_type !== 'message') return;
    if (data.message_type !== 'private') return; // 私聊最稳；群聊不处理
    if (ALLOWED.length && !ALLOWED.includes(String(data.user_id))) {
      console.log('[qq] 忽略非白名单用户 ' + data.user_id);
      return;
    }
    const text = textOf(data);
    const urls = urlsOf(text);
    if (!urls.length) return;
    console.log(`[qq] 收到 ${urls.length} 条链接，来自 ${data.user_id}`);

    for (const url of urls) {
      try {
        const result = await handleUrl(url, data);
        if (result.skipped) continue;
        let replyText = '';
        if (result.card) {
          replyText = cardReply(result.card, url, result);
          reply(ws, data, replyText);
        } else if (result.note) {
          replyText = '【知序】' + result.note + '\n链接已放进收件箱。';
          reply(ws, data, replyText);
        } else {
          replyText = '知序已收到，打开网页在「分享收件箱」里归档。';
          reply(ws, data, replyText);
        }
        await forwardToBoundQQ(replyText, data.user_id);
      } catch (e) {
        console.error('[qq] 处理失败：' + e.message);
      }
    }
  });

  ws.addEventListener('close', () => {
    const wait = Math.min(30000, 3000 * Math.pow(1.5, Math.min(retry, 5)));
    retry += 1;
    console.log(`[qq] 连接断开，${Math.round(wait / 1000)} 秒后重试…`);
    setTimeout(connect, wait);
  });

  ws.addEventListener('error', () => {
    /* close 会跟着触发 */
  });
}

if (process.env.QQ_BRIDGE_NO_AUTOSTART !== '1') connect();
