/**
 * 知序 · 多平台登录抓取助手（本地）
 *
 * 一个独立的浏览器登录态，抓取需要登录/反爬的页面，供知序网页调用。
 * 支持：小红书 / 知乎 / 微博 / 抖音 / B站 / 通用网页。
 *
 * 思路同 MediaCrawler、xiaohongshu-mcp 等开源项目（持久化浏览器上下文 + 扫码登录），
 * 但不引入 Playwright、不 fork 项目：直接用系统 Edge + CDP（Node 22 内置 WebSocket），零依赖。
 *
 * 运行：
 *   node integrations/xhs/xhs_helper.mjs
 *   或双击 integrations/xhs/start-xhs-helper.bat
 *
 * 环境变量：
 *   XHS_HELPER_PORT   本地端口，默认 8790
 *   XHS_CDP_PORT      Edge 调试端口，默认 9333
 *   XHS_EDGE_PATH     Edge 可执行文件路径（默认自动探测）
 *   XHS_PROFILE_DIR   登录态目录，默认 integrations/xhs/.profile
 *
 * 安全：
 *   - 只监听 127.0.0.1，不对外网开放
 *   - .profile 里是各站点登录 cookie，不要分享/提交仓库（已 gitignore）
 *   - 仅供个人整理自己看得到的内容，不要高频批量抓取
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.XHS_HELPER_PORT || 8790);
const CDP_PORT = Number(process.env.XHS_CDP_PORT || 9333);
const PROFILE = process.env.XHS_PROFILE_DIR || path.join(HERE, '.profile');

const BROWSER_CANDIDATES = [
  process.env.XHS_EDGE_PATH,
  // Windows
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // macOS
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Linux
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
].filter(Boolean);

function findBrowser() {
  for (const p of BROWSER_CANDIDATES) if (fs.existsSync(p)) return p;
  return '';
}

/**
 * 页面内执行：按站点挑选择器，提取标题/正文/作者/标签/图片
 * 注意：这段字符串会被 CDP 注入页面，内部只用单引号，避免和外壳反引号冲突。
 */
const EXTRACT_JS = `(() => {
  const host = location.hostname.replace(/^www\\./, '');
  const txt = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const pick = (sels) => {
    for (const s of sels) { const v = txt(document.querySelector(s)); if (v) return v; }
    return '';
  };
  const meta = (name) => {
    const el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el ? (el.getAttribute('content') || '') : '';
  };
  const bodyText = (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ');
  let site = host;
  let title = '';
  let desc = '';
  let author = '';
  let tags = [];

  if (/(^|\\.)xiaohongshu\\.com$/.test(host) || /(^|\\.)xhslink\\.cn$/.test(host)) {
    site = '小红书';
    title = pick(['#detail-title', '.note-content .title', 'h1.title']) || meta('og:title') || document.title;
    desc = pick(['#detail-desc', '.note-content .desc', '.note-text', '.desc']) || meta('description') || '';
    author = pick(['.author-wrapper .name', '.author .name', '.username', '.author-container .name']);
    tags = [...document.querySelectorAll('#detail-desc a, .note-text a')].map((a) => txt(a)).filter((t) => t && t.length <= 20);
  } else if (/(^|\\.)zhihu\\.com$/.test(host)) {
    site = '知乎';
    title = pick(['h1.QuestionHeader-title', 'h1.Post-Title', 'h1.AppHeader-title', '.QuestionHeader-title']) || meta('og:title') || document.title;
    desc = pick(['.Post-RichText', '.RichText.ztext', '.QuestionRichText', '.RichText']);
    author = pick(['.AuthorInfo-name', '.UserLink-link', '.AuthorInfo-nameText']);
    tags = [...document.querySelectorAll('.QuestionTopic .Tag-content, .Tag .Tag-content, .ContentItem-tag a')].map((a) => txt(a)).filter(Boolean);
  } else if (/(^|\\.)weibo\\.(com|cn)$/.test(host)) {
    site = '微博';
    title = pick(['.detail_wbtext', '.WB_text', 'h1']) || meta('og:title') || document.title;
    desc = pick(['.detail_wbtext', '.WB_text', '.wbpro-feed-content', '.Feed_wrap']);
    author = pick(['.ProfileHeader_name', '.ProfileHeader_info a', '.detail_wbtext a', '.name']);
    tags = [...document.querySelectorAll('.woo-topic, a[href*="q="]')].map((a) => txt(a)).filter((t) => t && t.length <= 20);
  } else if (/(^|\\.)douyin\\.com$/.test(host)) {
    site = '抖音';
    title = meta('og:title') || document.title;
    desc = pick(['.video-desc', '.desc', '[data-e2e="video-desc"]']);
    author = pick(['[data-e2e="user-name"]', '.author-name']);
    tags = [...document.querySelectorAll('[data-e2e="video-desc"] a, .video-tag')].map((a) => txt(a)).filter(Boolean);
  } else if (/(^|\\.)bilibili\\.com$/.test(host)) {
    site = 'B 站';
    title = pick(['h1.video-title', 'h1[title]']) || meta('og:title') || document.title;
    desc = pick(['.desc-info-text', '.video-desc', '.basic-desc-info']);
    author = pick(['.up-name', '.username']);
    tags = [...document.querySelectorAll('.tag a, .video-tag')].map((a) => txt(a)).filter(Boolean);
  } else {
    site = '网页';
    title = meta('og:title') || document.title;
    desc = pick(['article', 'main', '.article', '.post', '.content', '#content']);
    if (!desc) desc = meta('description') || '';
    author = meta('author');
  }

  tags = [...new Set(tags)].slice(0, 10);
  const text = [title, desc].filter(Boolean).join('\\n').slice(0, 6000);
  const loginWall = /登录后查看|扫码登录|手机号登录|请先登录|登录知乎|登录微博/.test(bodyText) && !desc;
  return {
    site,
    title,
    desc,
    author,
    tags,
    text: text || bodyText.slice(0, 6000),
    bodyText: bodyText.slice(0, 3000),
    loginWall,
    url: location.href,
    images: [...document.querySelectorAll('img')].map((i) => i.src).filter(Boolean).slice(0, 6)
  };
})()`;

/**
 * 搜索结果页：收集卡片（保留完整 href，小红书要注意保留 xsec_token，否则打开会撞 300031）
 */
const SEARCH_JS = `(() => {
  const host = location.hostname;
  const cards = [];
  if (/(^|\\.)xiaohongshu\\.com$/.test(host)) {
    for (const sec of document.querySelectorAll('section.note-item')) {
      const id = sec.getAttribute('data-note-id') || '';
      const cover = sec.querySelector('a.cover, a[href*="xsec_token"]');
      const href = cover ? (cover.getAttribute('href') || '') : '';
      const tokenMatch = href.match(/xsec_token=([^&]+)/);
      const token = tokenMatch ? tokenMatch[1] : '';
      const idMatch = href.match(/(?:explore|search_result)\\/([a-f0-9]{24})/);
      const noteId = id || (idMatch ? idMatch[1] : '');
      const url = noteId
        ? 'https://www.xiaohongshu.com/explore/' + noteId + (token ? '?xsec_token=' + token + '&xsec_source=pc_search' : '')
        : (href ? new URL(href, location.href).href : '');
      const titleEl = sec.querySelector('.footer .title, .title');
      const img = sec.querySelector('img');
      const title = (titleEl && titleEl.innerText ? titleEl.innerText.trim() : '') || (img && img.alt ? img.alt.trim() : '');
      const authorEl = sec.querySelector('.author .name, .author-wrapper .name');
      const likeEl = sec.querySelector('.like-wrapper .count');
      cards.push({
        url,
        noteId,
        hasToken: Boolean(token),
        title,
        author: (authorEl && authorEl.innerText || '').trim(),
        likes: (likeEl && likeEl.innerText || '').trim()
      });
    }
  } else if (/(^|\\.)zhihu\\.com$/.test(host)) {
    for (const c of document.querySelectorAll('.SearchResult-Card, .Card.SearchResult-Card')) {
      const a = c.querySelector('.ContentItem-title a, h2 a, a[href*="/question/"], a[href*="/p/"]');
      if (!a) continue;
      const titleEl = c.querySelector('.ContentItem-title');
      const excerptEl = c.querySelector('.RichText, .SearchItem-meta');
      cards.push({
        url: (() => { try { return new URL(a.getAttribute('href'), location.href).href; } catch (e) { return a.getAttribute('href'); } })(),
        title: (titleEl && titleEl.innerText || a.innerText || '').trim(),
        author: '',
        likes: '',
        excerpt: (excerptEl && excerptEl.innerText || '').trim().slice(0, 120)
      });
    }
  }
  const seen = new Set();
  const unique = cards.filter((c) => {
    const key = c.noteId || c.url;
    if (!key || seen.has(key)) return false;
    // 占位/异常卡片：既没有标题也没有 token，导入也没意义
    if (!c.title && !c.hasToken) return false;
    if (!c.title && !c.excerpt) return false;
    seen.add(key);
    return true;
  });
  const bodyText = document.body ? document.body.innerText : '';
  const loginWall = /登录后查看|扫码登录|手机号登录|登录知乎|请先登录/.test(bodyText) && unique.length === 0;
  return { cards: unique.slice(0, 40), loginWall, url: location.href };
})()`;

/**
 * 评论区提取：按点赞数排序取前 N 条
 */
const COMMENT_JS = `(() => {
  const txt = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const num = (s) => Number(String(s || '').replace(/[^0-9]/g, '')) || 0;
  const items = [...document.querySelectorAll('.comment-item')].map((it) => ({
    author: txt(it.querySelector('.author-wrapper .name, a.name, .author .name')),
    text: txt(it.querySelector('.content .note-text, .content')),
    date: txt(it.querySelector('.info .date')),
    likes: txt(it.querySelector('.interactions .like')),
    isAuthor: Boolean(it.querySelector('.author-wrapper .tag'))
  })).filter((c) => c.text && c.text.length >= 2);
  const seen = new Set();
  const unique = items.filter((c) => {
    const key = c.author + '|' + c.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => num(b.likes) - num(a.likes));
  return { items: unique.slice(0, 60), total: unique.length, url: location.href };
})()`;

/* ---------------------------------------------------------------- CDP 客户端 */
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('连接浏览器调试端口超时')), 8000);
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
      this.ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('浏览器调试端口连接失败')); });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch (e) { return; }
      if (!msg || typeof msg.id !== 'number') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
      else p.resolve(msg.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      try { this.ws.send(JSON.stringify(payload)); } catch (e) { this.pending.delete(id); reject(e); }
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 20000);
    });
  }

  close() { try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } }
}

/* ---------------------------------------------------------------- 浏览器管理 */
let cdp = null;

async function cdpVersion() {
  try {
    const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function ensureBrowser() {
  const existing = await cdpVersion();
  if (existing) return existing;
  const bin = findBrowser();
  if (!bin) throw new Error('找不到 Edge/Chrome，请设置 XHS_EDGE_PATH');
  fs.mkdirSync(PROFILE, { recursive: true });
  console.log('[helper] 启动浏览器（独立配置目录）：' + bin);
  const proc = spawn(bin, [
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + PROFILE,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    'https://www.xiaohongshu.com'
  ], { detached: true, stdio: 'ignore' });
  proc.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await cdpVersion();
    if (v) return v;
  }
  throw new Error('浏览器启动后调试端口仍未就绪');
}

async function getCdp() {
  const v = await ensureBrowser();
  if (!v.webSocketDebuggerUrl) throw new Error('调试端口没有返回 webSocketDebuggerUrl');
  if (!cdp) {
    cdp = new CDP(v.webSocketDebuggerUrl);
    await cdp.connect();
  }
  return cdp;
}

/* ---------------------------------------------------------------- 抓取 */
async function openAndExtract(url, timeoutMs = 25000) {
  const client = await getCdp();
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  let sessionId = '';
  try {
    ({ sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true }));
    await client.send('Page.enable', {}, sessionId);
    await client.send('Page.navigate', { url }, sessionId);

    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 900));
      try {
        const r = await client.send('Runtime.evaluate', { expression: EXTRACT_JS, returnByValue: true }, sessionId);
        const val = r && r.result ? r.result.value : null;
        if (val) {
          last = val;
          if (val.loginWall) break;
          if (val.title && val.title.length > 2 && (val.desc || val.bodyText.length > 80)) break;
        }
      } catch (e) { /* 页面跳转中，忽略 */ }
    }
    return last;
  } finally {
    try { await client.send('Target.closeTarget', { targetId }); } catch (e) { /* ignore */ }
  }
}

async function openSearch(site, keyword, limit, sort) {
  const client = await getCdp();
  let targetUrl;
  if (site === 'zhihu') {
    targetUrl = 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(keyword);
  } else {
    targetUrl = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword) + '&source=web_explore_feed';
    if (sort === 'popular') targetUrl += '&sort=popularity_descending';
    else if (sort === 'latest') targetUrl += '&sort=time_descending';
  }
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  let sessionId = '';
  try {
    ({ sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true }));
    await client.send('Page.enable', {}, sessionId);
    await client.send('Page.navigate', { url: targetUrl }, sessionId);

    // 1) 等搜索真正就绪：搜索框里就是关键词，且已有卡片
    //    （首页推荐流也有 note-item，只看数量会抓错）
    let ready = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const st = await client.send('Runtime.evaluate', {
          expression: 'JSON.stringify({ sv: (document.querySelector("#search-input") || {}).value || "", n: document.querySelectorAll("section.note-item, .SearchResult-Card").length })',
          returnByValue: true
        }, sessionId);
        if (st && st.result && st.result.value) {
          const parsed = JSON.parse(st.result.value);
          if (parsed.n > 0 && (site === 'zhihu' || parsed.sv === keyword)) { ready = true; break; }
        }
      } catch (e) { /* 页面跳转中 */ }
    }
    await new Promise((r) => setTimeout(r, 2000));

    let __debugSnapshot = null;
    try {
      const d = await client.send('Runtime.evaluate', {
        expression: 'JSON.stringify((() => { const conts = {}; document.querySelectorAll("section.note-item").forEach((s) => { let p = s.parentElement, key = "?"; for (let i = 0; i < 4 && p; i++) { if (p.id || (p.className && typeof p.className === "string")) { key = (p.tagName + "." + String(p.className).split(" ").slice(0, 2).join(".") + "#" + (p.id || "")); break; } p = p.parentElement; } conts[key] = (conts[key] || 0) + 1; }); return { href: location.href, title: document.title, sv: (document.querySelector("#search-input") || {}).value || "", n: document.querySelectorAll("section.note-item").length, conts, first: [...document.querySelectorAll("section.note-item")].slice(0, 3).map((s) => (s.querySelector(".footer .title, .title") || {}).innerText || "") }; })())',
        returnByValue: true
      }, sessionId);
      if (d && d.result && d.result.value) __debugSnapshot = JSON.parse(d.result.value);
    } catch (e) { /* ignore */ }

    // 2) 边滚边累积（列表会回收 DOM 重渲染，单次快照不可靠）
    const merged = new Map();
    const maxRounds = site === 'zhihu' ? 3 : 6;
    for (let round = 0; round < maxRounds; round++) {
      try {
        const r = await client.send('Runtime.evaluate', { expression: SEARCH_JS, returnByValue: true }, sessionId);
        const val = r && r.result ? r.result.value : null;
        if (val && Array.isArray(val.cards)) {
          for (const it of val.cards) {
            const key = it.noteId || it.url;
            if (!key) continue;
            const prev = merged.get(key);
            if (!prev) merged.set(key, Object.assign({}, it));
            else {
              if (!prev.title && it.title) prev.title = it.title;
              if (!prev.author && it.author) prev.author = it.author;
              if (!prev.likes && it.likes) prev.likes = it.likes;
              if (it.hasToken) prev.hasToken = true;
            }
          }
        }
      } catch (e) { /* ignore */ }
      if (merged.size >= limit) break;
      try {
        await client.send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight)' }, sessionId);
      } catch (e) { /* ignore */ }
      await new Promise((r) => setTimeout(r, 1600));
    }

    let items = [...merged.values()];
    if (sort === 'popular') {
      const num = (v) => Number(String(v || '').replace(/[^0-9]/g, '')) || 0;
      items.sort((a, b) => num(b.likes) - num(a.likes));
    }
    items = items.slice(0, limit);
    return {
      ok: true,
      site,
      keyword,
      sort: sort || 'default',
      ready,
      debug: __debugSnapshot,
      loginWall: items.length === 0,
      items,
      url: targetUrl
    };
  } finally {
    try { await client.send('Target.closeTarget', { targetId }); } catch (e) { /* ignore */ }
  }
}

async function openComments(noteUrl, limit) {
  const client = await getCdp();
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  let sessionId = '';
  try {
    ({ sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true }));
    await client.send('Page.enable', {}, sessionId);
    await client.send('Page.navigate', { url: noteUrl }, sessionId);
    await new Promise((r) => setTimeout(r, 5000));

    // 滚动加载评论：先滚页面，再滚笔记滚动容器
    for (let i = 0; i < 6; i++) {
      try {
        await client.send('Runtime.evaluate', {
          expression: 'window.scrollTo(0, document.body.scrollHeight); const s = document.querySelector(".note-scroller, .note-container .scroller, .comments-container, .comment-list"); if (s) s.scrollTop = s.scrollHeight;'
        }, sessionId);
      } catch (e) { /* ignore */ }
      await new Promise((r) => setTimeout(r, 1300));
    }

    const r = await client.send('Runtime.evaluate', { expression: COMMENT_JS, returnByValue: true }, sessionId);
    const val = r && r.result ? r.result.value : null;
    if (!val) return { ok: false, error: '评论区没有返回数据' };
    return {
      ok: true,
      url: val.url || noteUrl,
      total: val.total || 0,
      items: (val.items || []).slice(0, Math.min(30, Math.max(1, Number(limit) || 10)))
    };
  } finally {
    try { await client.send('Target.closeTarget', { targetId }); } catch (e) { /* ignore */ }
  }
}

async function openLogin(site) {
  const client = await getCdp();
  const target = site || 'https://www.xiaohongshu.com/explore';
  const { targetId } = await client.send('Target.createTarget', { url: target });
  try { await client.send('Target.activateTarget', { targetId }); } catch (e) { /* ignore */ }
  return targetId;
}

/* ---------------------------------------------------------------- HTTP 服务 */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, code, payload) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 1e6) { req.destroy(); reject(new Error('请求体过大')); }
    });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  if (url.pathname === '/health') {
    const v = await cdpVersion();
    json(res, 200, { ok: true, name: '知序 多平台抓取助手', browser: Boolean(v), port: PORT, profile: PROFILE, sites: ['小红书', '知乎', '微博', '抖音', 'B站', '通用网页'] });
    return;
  }

  if (url.pathname === '/login' && req.method === 'POST') {
    try {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { body = {}; }
      const site = String(body.site || '');
      const map = {
        xiaohongshu: 'https://www.xiaohongshu.com/explore',
        zhihu: 'https://www.zhihu.com/signin',
        weibo: 'https://weibo.com/login.php',
        douyin: 'https://www.douyin.com/',
        bilibili: 'https://passport.bilibili.com/login'
      };
      await openLogin(map[site] || site || map.xiaohongshu);
      json(res, 200, { ok: true, note: '已打开登录窗口，扫码/登录后重试即可（会话保存在本地配置目录）。' });
    } catch (e) {
      json(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (url.pathname === '/comments' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const target = String(body.url || '').trim();
      if (!/^https?:\/\//i.test(target)) { json(res, 400, { ok: false, error: '需要 http/https 链接' }); return; }
      const limit = Math.min(30, Math.max(1, Number(body.limit) || 10));
      const result = await openComments(target, limit);
      json(res, result.ok ? 200 : 500, result);
    } catch (e) {
      json(res, 500, { ok: false, error: String(e.message || e) });
    }
    return;
  }

  if (url.pathname === '/search' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const site = body.site === 'zhihu' ? 'zhihu' : 'xiaohongshu';
      const keyword = String(body.keyword || '').trim();
      if (!keyword) { json(res, 400, { ok: false, error: '需要关键词' }); return; }
      const limit = Math.min(20, Math.max(1, Number(body.limit) || 10));
      const result = await openSearch(site, keyword, limit, String(body.sort || 'default'));
      if (result.loginWall) {
        json(res, 200, {
          ok: false, blocked: true, loginWall: true,
          note: (site === 'zhihu' ? '知乎' : '小红书') + '搜索需要登录：请点「登录窗口」登录后重试。'
        });
        return;
      }
      json(res, 200, result);
    } catch (e) {
      json(res, 500, { ok: false, error: String(e.message || e) });
    }
    return;
  }

  if (url.pathname === '/resolve' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const target = String(body.url || '').trim();
      if (!/^https?:\/\//i.test(target)) {
        json(res, 400, { ok: false, error: '需要 http/https 链接' });
        return;
      }
      const data = await openAndExtract(target);
      if (!data) { json(res, 200, { ok: false, blocked: true, note: '页面加载超时，请重试或手动粘贴' }); return; }
      if (data.loginWall) {
        json(res, 200, {
          ok: false, blocked: true, loginWall: true,
          note: (data.site || '该站点') + ' 需要登录：请在打开的浏览器窗口里登录后重试。'
        });
        return;
      }
      json(res, 200, {
        ok: true,
        blocked: false,
        site: data.site || '网页',
        title: data.title,
        description: data.desc,
        author: data.author,
        tags: data.tags,
        images: data.images,
        text: data.text,
        url: data.url
      });
    } catch (e) {
      json(res, 500, { ok: false, error: String(e.message || e) });
    }
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('');
  console.log('  知序 · 多平台登录抓取助手');
  console.log('  ─────────────────────────────');
  console.log('  本地地址：http://127.0.0.1:' + PORT);
  console.log('  登录态目录：' + PROFILE);
  console.log('  支持：小红书 / 知乎 / 微博 / 抖音 / B站 / 通用网页');
  console.log('');
  console.log('  用法：知序网页里点「登录小红书/登录窗口」，或直接粘贴链接点「读取链接」。');
  console.log('  按 Ctrl+C 退出（浏览器窗口可留着）。');
  console.log('');
  try {
    await ensureBrowser();
    console.log('[helper] 浏览器已就绪（调试端口 ' + CDP_PORT + '）');
  } catch (e) {
    console.error('[helper] 浏览器启动失败：' + e.message);
  }
});
