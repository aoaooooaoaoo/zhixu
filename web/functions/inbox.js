/**
 * 知序 · 分享收件箱（VPS 版）
 * 路由：/api/inbox
 *
 *   GET                → { ok, items: [...] }
 *   POST {url, from, title, text, card}  → { ok, item }
 *   DELETE ?id=<id>    → { ok }
 *
 * 数据保存在程序目录的 data/inbox.json（最多 100 条）。
 * 如果设置了环境变量 WJ_INBOX_TOKEN，POST/DELETE 需要请求头 X-Inbox-Token。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.ZHIXU_DATA_DIR || path.join(__dirname, '..', 'data');
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');
const INBOX_TOKEN = process.env.WJ_INBOX_TOKEN || '';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Inbox-Token'
};

function done(code, payload) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(payload) };
}

function load() {
  try {
    if (!fs.existsSync(INBOX_FILE)) return [];
    const arr = JSON.parse(fs.readFileSync(INBOX_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function save(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INBOX_FILE, JSON.stringify(items.slice(-100), null, 2), 'utf8');
}

function authorized(event) {
  if (!INBOX_TOKEN) return true;
  const h = event.headers || {};
  const v = h['x-inbox-token'] || h['X-Inbox-Token'] || '';
  return v === INBOX_TOKEN;
}

exports.handler = async function (event) {
  const method = event.httpMethod || 'GET';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  if (method === 'GET') {
    return done(200, { ok: true, items: load() });
  }

  if (method === 'POST') {
    if (!authorized(event)) return done(401, { ok: false, error: 'inbox token 不正确' });
    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return done(400, { ok: false, error: '请求体不是合法 JSON' });
    }
    const url = String(body.url || '').trim();
    if (!url) return done(400, { ok: false, error: '缺少 url' });

    const items = load();
    const item = {
      id: crypto.randomBytes(8).toString('hex'),
      url: url,
      from: String(body.from || '').slice(0, 80),
      title: String(body.title || '').slice(0, 200),
      text: String(body.text || '').slice(0, 6000),
      card: body.card && typeof body.card === 'object' ? body.card : undefined,
      createdAt: new Date().toISOString()
    };
    items.push(item);
    save(items);
    return done(200, { ok: true, item: item, total: items.length });
  }

  if (method === 'DELETE') {
    if (!authorized(event)) return done(401, { ok: false, error: 'inbox token 不正确' });
    const qs = event.queryStringParameters || {};
    const id = String(qs.id || '').trim();
    const items = load();
    const kept = id ? items.filter((x) => x.id !== id) : [];
    save(kept);
    return done(200, { ok: true, removed: items.length - kept.length });
  }

  return done(405, { ok: false, error: '只支持 GET/POST/DELETE' });
};
