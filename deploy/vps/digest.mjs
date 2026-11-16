/**
 * 知序 · 服务器端每日汇总
 *
 * 流程：
 *   1. 读配置 /opt/zhixu/config/digest.json 里的来源（RSS 或固定链接）
 *   2. 抓取 → 只挑「没见过的」新内容 → 调本地 /api/analyze 提炼成卡片
 *   3. 卡片投递到「分享收件箱」（网页端可见、一键归档）
 *   4. 生成文字汇总，按配置推送：
 *        qmsg  → Qmsg酱（推送到 QQ）
 *        smtp  → 用 curl 走 QQ 邮箱 SMTP（无需额外依赖）
 *        无     → 只写文件 + 收件箱
 *
 * 运行：node digest.mjs（建议由 systemd timer 每天触发）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const BASE = process.env.ZHIXU_BASE || 'http://127.0.0.1';
const CONFIG_FILE = process.env.ZHIXU_DIGEST_CONFIG || '/opt/zhixu/config/digest.json';
const DATA_DIR = process.env.ZHIXU_DATA_DIR || '/opt/zhixu/data';
const STATE_FILE = path.join(DATA_DIR, 'digest-state.json');
const LAST_FILE = path.join(DATA_DIR, 'last-digest.md');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ZhixuDigest/1.0';

function log(...a) {
  console.log('[' + new Date().toISOString() + ']', ...a);
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    log('读取失败 ' + file + ': ' + e.message);
    return fallback;
  }
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,application/rss+xml,*/*;q=0.8' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 极简 RSS/Atom 解析：返回 [{id,title,link,desc}] */
function parseFeed(xml) {
  const items = [];
  const blocks = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const pick = (tag) => {
      const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
      if (!m) return '';
      return decodeEntities(stripTags(m[1]));
    };
    let link = '';
    const lm = block.match(/<link[^>]*href=["']([^"']+)["']/i) || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (lm) link = decodeEntities(stripTags(lm[1]));
    const id = pick('guid') || link || pick('title');
    items.push({
      id: id,
      title: pick('title'),
      link: link,
      desc: pick('description') || pick('summary') || pick('content')
    });
  }
  return items.filter((x) => x.link || x.title);
}

/** 关键词 → 新闻 RSS 地址（Bing 优先，Google 兜底） */
function newsFeeds(keyword) {
  const q = encodeURIComponent(keyword);
  return [
    'https://www.bing.com/news/search?q=' + q + '&format=rss',
    'https://news.google.com/rss/search?q=' + q + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans'
  ];
}

/** 抓一类关键词新闻：Bing 优先；空则试 Google */
async function fetchKeywordItems(keyword, max) {
  for (const url of newsFeeds(keyword)) {
    try {
      const xml = await fetchText(url);
      const items = parseFeed(xml).slice(0, max);
      if (items.length) {
        log('  关键词源命中：' + url.slice(0, 60) + '… 共 ' + items.length + ' 条');
        return items;
      }
    } catch (e) {
      log('  关键词源失败：' + url.slice(0, 50) + '… ' + e.message);
    }
  }
  return [];
}

async function apiPost(pathname, payload) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  return { ok: res.ok, status: res.status, json };
}

/** 一条内容 → 卡片 */
async function makeCard(title, text, url) {
  const body = (title ? title + '\n' : '') + String(text || '');
  if (body.trim().length < 20) return null;
  const r = await apiPost('/api/analyze', { text: body.slice(0, 6000), url: url || '' });
  if (r.ok && r.json && r.json.ok && r.json.card) return r.json.card;
  return null;
}

async function pushQmsg(key, text) {
  try {
    const res = await fetch('https://qmsg.zendee.cn/send/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ msg: text }).toString()
    });
    const t = await res.text();
    log('Qmsg 推送：HTTP ' + res.status + ' ' + t.slice(0, 120));
    return res.ok;
  } catch (e) {
    log('Qmsg 推送失败：' + e.message);
    return false;
  }
}

function pushSmtp(cfg, to, subject, text) {
  return new Promise((resolve) => {
    const from = cfg.user;
    const body = text.replace(/\r?\n/g, '\r\n');
    const eml = [
      'From: ' + from,
      'To: ' + to,
      'Subject: =?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body
    ].join('\r\n');
    const tmp = path.join(DATA_DIR, '.digest-mail.eml');
    fs.writeFileSync(tmp, eml, 'utf8');
    const args = [
      '--silent', '--show-error',
      '--url', cfg.url || 'smtps://smtp.qq.com:465',
      '--ssl-reqd',
      '--user', from + ':' + cfg.pass,
      '--mail-from', from,
      '--mail-rcpt', to,
      '--upload-file', tmp
    ];
    execFile('curl', args, { timeout: 60000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
      if (err) {
        log('SMTP 推送失败：' + (stderr || err.message).toString().slice(0, 200));
        resolve(false);
      } else {
        log('SMTP 推送成功 → ' + to);
        resolve(true);
      }
    });
  });
}

async function main() {
  const cfg = loadJson(CONFIG_FILE, null);
  if (!cfg) {
    log('没有配置 ' + CONFIG_FILE + '，退出');
    return;
  }
  const FORCE = process.env.ZHIXU_DIGEST_FORCE === '1';
  const state = loadJson(STATE_FILE, { seen: {} });
  const now = new Date();
  const localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

  if (!FORCE) {
    if (cfg.enabled === false) { log('自动抓取已关闭，退出'); return; }
    const t = String(cfg.time || '08:00');
    const parts = t.split(':').map(Number);
    const target = new Date(now);
    target.setHours(isNaN(parts[0]) ? 8 : parts[0], isNaN(parts[1]) ? 0 : parts[1], 0, 0);
    if (now < target) { log('未到运行时间 ' + t + '，退出'); return; }
    if (state.lastRunDate === localDate) { log('今天已运行过，退出'); return; }
  }

  const sources = Array.isArray(cfg.sources) ? cfg.sources : [];
  if (!sources.length) {
    log('配置里没有 sources，退出');
    return;
  }
  const maxPerSource = Number(cfg.maxPerSource || 5);
  const lines = [];
  let newCount = 0;

  for (const src of sources) {
    const name = src.name || src.url || '来源';
    try {
      if (src.type === 'rss') {
        log('抓 RSS：' + name);
        const xml = await fetchText(src.url);
        const items = parseFeed(xml).slice(0, maxPerSource);
        const seen = new Set(state.seen[src.url] || []);
        for (const it of items) {
          const key = it.id || it.link;
          if (!key || seen.has(key)) continue;
          const card = await makeCard(it.title, it.desc, it.link);
          if (!card) continue;
          const inbox = await apiPost('/api/inbox', {
            url: it.link || src.url,
            from: '每日汇总 · ' + name,
            title: card.title,
            text: card.summary,
            card: card
          });
          if (inbox.ok) {
            seen.add(key);
            newCount++;
            lines.push('· ' + card.title + (card.summary ? ' —— ' + card.summary : ''));
          }
        }
        state.seen[src.url] = Array.from(seen).slice(-500);
      } else if (src.type === 'link') {
        log('抓链接：' + name);
        const r = await apiPost('/api/resolve', { url: src.url });
        if (!r.ok || !r.json || !r.json.ok || r.json.blocked) {
          log('  跳过（读不到正文）：' + ((r.json && r.json.note) || r.status));
          continue;
        }
        const fp = (r.json.title || '') + '|' + String(r.json.text || '').length;
        const seen = new Set(state.seen[src.url] || []);
        if (seen.has(fp)) { log('  无更新'); continue; }
        const card = await makeCard(r.json.title, r.json.text, src.url);
        if (!card) { log('  AI 提炼失败'); continue; }
        const inbox = await apiPost('/api/inbox', {
          url: src.url,
          from: '每日汇总 · ' + name,
          title: card.title,
          text: card.summary,
          card: card
        });
        if (inbox.ok) {
          seen.add(fp);
          newCount++;
          lines.push('· ' + card.title + (card.summary ? ' —— ' + card.summary : ''));
        }
        state.seen[src.url] = Array.from(seen).slice(-50);
      } else if (src.type === 'keyword') {
        const kw = src.keyword || name;
        log('抓关键词：' + kw);
        const items = await fetchKeywordItems(kw, maxPerSource);
        const stateKey = 'kw:' + kw;
        const seen = new Set(state.seen[stateKey] || []);
        for (const it of items) {
          const key = it.id || it.link;
          if (!key || seen.has(key)) continue;
          const card = await makeCard(it.title, it.desc, it.link);
          if (!card) { log('  AI 提炼失败：' + it.title); continue; }
          const inbox = await apiPost('/api/inbox', {
            url: it.link || src.url || '',
            from: '每日汇总 · ' + name,
            title: card.title,
            text: card.summary,
            card: card
          });
          if (inbox.ok) {
            seen.add(key);
            newCount++;
            lines.push('· ' + card.title + (card.summary ? ' —— ' + card.summary : ''));
          }
        }
        state.seen[stateKey] = Array.from(seen).slice(-500);
      }
    } catch (e) {
      log('来源失败 ' + name + '：' + e.message);
    }
  }

  saveJson(STATE_FILE, state);

  const stamp = new Date().toISOString().slice(0, 10);
  const digest = [
    '# 知序每日汇总 · ' + stamp,
    '',
    newCount ? '今天新增 ' + newCount + ' 条：' : '今天没有新内容。',
    ...lines,
    '',
    '打开 ' + (cfg.webUrl || 'http://47.86.32.77:8080/') + ' → 收件箱 → 点「读取并归档」即可入库。'
  ].join('\n');

  fs.writeFileSync(LAST_FILE, digest, 'utf8');
  log('汇总完成，新增 ' + newCount + ' 条，已写 ' + LAST_FILE);

  // 记录运行状态（供网页面板读取）
  state.lastRunAt = new Date().toISOString();
  state.lastRunDate = localDate;
  state.lastResult = {
    mode: FORCE ? 'manual' : 'scheduled',
    added: newCount,
    lines: lines.slice(0, 12),
    digest: digest.slice(0, 6000)
  };
  state.runningAt = '';
  saveJson(STATE_FILE, state);

  // 推送
  const notify = cfg.notify || {};
  const short = lines.length
    ? '【知序每日汇总 ' + stamp + '】新增 ' + newCount + ' 条\n' + lines.slice(0, 8).join('\n') + '\n详情见知序收件箱'
    : '【知序每日汇总 ' + stamp + '】今天没有新内容';
  if (notify.qmsgKey) await pushQmsg(notify.qmsgKey, short);
  else if (notify.smtp && notify.smtp.user && notify.smtp.pass && notify.emailTo) {
    await pushSmtp(notify.smtp, notify.emailTo, '知序每日汇总 ' + stamp, digest);
  } else {
    log('未配置推送渠道（qmsgKey 或 smtp），只在网页收件箱可见');
  }
}

main().catch((e) => {
  log('异常：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
