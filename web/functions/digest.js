/**
 * 知序 · 自动抓取配置与触发（VPS 版接口）
 * 路由：/api/digest
 *
 *   GET             → 当前配置 + 上次运行结果 + 下次运行时间（需要登录）
 *   POST {action:'save', config}  → 保存配置（关键词 / RSS / 链接 / 时间 / 开关）
 *   POST {action:'run'}           → 立即运行一次（后台执行，不阻塞请求）
 *
 * 安全：所有操作要求有效的登录 token（Authorization: Bearer <token> 或 body.token）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CONFIG_FILE = process.env.ZHIXU_DIGEST_CONFIG || path.join(__dirname, '..', 'config', 'digest.json');
const STATE_FILE = path.join(__dirname, '..', 'data', 'digest-state.json');
const DIGEST_SCRIPT = path.join(__dirname, '..', 'digest.mjs');
const BASE = process.env.ZHIXU_SELF_BASE || 'http://127.0.0.1';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Inbox-Token'
};

function done(code, payload) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(payload) };
}

function loadJson(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function getToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

async function requireLogin(event, body) {
  const token = getToken(event) || (body && String(body.token || '').trim()) || '';
  if (!token || token.length < 16) return { ok: false, error: '请先登录账号', code: 401 };
  try {
    const res = await fetch(BASE + '/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'me', token })
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) return { ok: false, error: '登录已过期，请重新登录', code: 401 };
    return { ok: true, user: j.user };
  } catch (e) {
    return { ok: false, error: '无法校验登录状态：' + e.message, code: 500 };
  }
}

function normalizeConfig(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const rawSources = Array.isArray(cfg.sources) ? cfg.sources.slice(0, 20) : [];
  const sources = [];
  for (const s of rawSources) {
    if (!s || typeof s !== 'object') continue;
    const type = String(s.type || '').trim();
    const name = String(s.name || '').trim().slice(0, 20);
    if (type === 'keyword') {
      const kw = String(s.keyword || '').trim().slice(0, 30);
      if (kw) sources.push({ type: 'keyword', name: name || kw, keyword: kw });
    } else if (type === 'rss' || type === 'link') {
      const url = String(s.url || '').trim();
      if (/^https?:\/\//i.test(url)) sources.push({ type, name: name || url.slice(0, 40), url });
    }
  }

  let time = String(cfg.time || '08:00').trim();
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) time = '08:00';
  else time = String(Number(m[1])).padStart(2, '0') + ':' + m[2];

  return {
    enabled: cfg.enabled !== false,
    time: time,
    maxPerSource: Math.max(1, Math.min(10, Number(cfg.maxPerSource) || 4)),
    sources: sources
  };
}

function nextRunAt(time) {
  const now = new Date();
  const parts = String(time || '08:00').split(':').map(Number);
  const target = new Date(now);
  target.setHours(parts[0] || 0, parts[1] || 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

exports.handler = async function (event) {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  let body = {};
  if (method === 'POST') {
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return done(400, { ok: false, error: '请求体不是合法 JSON' });
    }
  }

  const auth = await requireLogin(event, body);
  if (!auth.ok) return done(auth.code || 401, { ok: false, error: auth.error });

  const config = loadJson(CONFIG_FILE, { enabled: true, time: '08:00', maxPerSource: 4, sources: [], notify: {} });

  if (method === 'GET') {
    const state = loadJson(STATE_FILE, { seen: {} });
    const running = state.runningAt && Date.now() - new Date(state.runningAt).getTime() < 10 * 60 * 1000;
    return done(200, {
      ok: true,
      config: {
        enabled: config.enabled !== false,
        time: config.time || '08:00',
        maxPerSource: config.maxPerSource || 4,
        sources: Array.isArray(config.sources) ? config.sources : []
      },
      last: {
        at: state.lastRunAt || '',
        mode: state.lastResult ? state.lastResult.mode : '',
        added: state.lastResult ? state.lastResult.added : 0,
        lines: state.lastResult ? state.lastResult.lines : [],
        digest: state.lastResult ? state.lastResult.digest : ''
      },
      nextRunAt: nextRunAt(config.time || '08:00'),
      running: Boolean(running),
      push: {
        qmsg: Boolean(config.notify && config.notify.qmsgKey),
        smtp: Boolean(config.notify && config.notify.smtp && config.notify.smtp.user)
      }
    });
  }

  const action = String(body.action || '').trim();

  if (action === 'save') {
    const next = normalizeConfig(body.config || {});
    const merged = Object.assign({}, config, next);
    // 保留推送相关的密钥（前端不回传）
    merged.notify = config.notify || {};
    merged.webUrl = config.webUrl || 'http://47.86.32.77:8080/';
    saveJson(CONFIG_FILE, merged);
    return done(200, { ok: true, saved: true, config: next, nextRunAt: nextRunAt(next.time) });
  }

  if (action === 'run') {
    const state = loadJson(STATE_FILE, { seen: {} });
    if (state.runningAt && Date.now() - new Date(state.runningAt).getTime() < 10 * 60 * 1000) {
      return done(200, { ok: false, error: '正在运行中，请稍后再试', running: true });
    }
    if (!fs.existsSync(DIGEST_SCRIPT)) return done(500, { ok: false, error: '找不到 digest.mjs' });
    state.runningAt = new Date().toISOString();
    saveJson(STATE_FILE, state);
    try {
      const logFile = path.join(path.dirname(DIGEST_SCRIPT), 'data', 'digest.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const logFd = fs.openSync(logFile, 'a');
      const child = spawn(process.execPath, [DIGEST_SCRIPT], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: Object.assign({}, process.env, { ZHIXU_DIGEST_FORCE: '1' }),
        cwd: path.dirname(DIGEST_SCRIPT)
      });
      child.unref();
    } catch (e) {
      state.runningAt = '';
      saveJson(STATE_FILE, state);
      return done(500, { ok: false, error: '启动失败：' + e.message });
    }
    return done(200, { ok: true, started: true, message: '已开始抓取，约 30-90 秒后出结果（可稍后刷新）' });
  }

  return done(400, { ok: false, error: 'action 必须是 save/run' });
};
