/**
 * 知序 · 云同步（账号制，Netlify Blobs）
 * 路由：/api/sync
 *
 * 用法（需先登录拿到 token，见 /api/auth）：
 *   POST { action: 'push', token, data: { version, cards, settings } }
 *   POST { action: 'pull', token }
 *   POST { action: 'info', token }
 *
 * 数据按账号隔离：key = 'data-' + sha256(用户名)
 */
const crypto = require('node:crypto');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function stores() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: 'zhixu-users', consistency: 'strong' };
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || '';
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || '';
  if (siteID) opts.siteID = siteID;
  if (token) opts.token = token;
  return {
    data: getStore(Object.assign({}, opts, { name: 'zhixu-sync' })),
    sessions: getStore(Object.assign({}, opts, { name: 'zhixu-sessions' }))
  };
}

async function readSession(sessions, token) {
  if (!token || String(token).length < 16) return null;
  const key = 's-' + sha(token).slice(0, 40);
  const rec = await sessions.get(key, { type: 'json' }).catch(() => null);
  if (!rec || !rec.username || !rec.expiresAt || rec.expiresAt < Date.now()) return null;
  return rec;
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const done = (code, payload) => ({ statusCode: code, headers, body: JSON.stringify(payload) });

  if (event.httpMethod !== 'POST') return done(405, { ok: false, error: '只支持 POST' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return done(400, { ok: false, error: '请求体不是合法 JSON' }); }

  const action = String(body.action || '').trim();
  const token = String(body.token || '').trim();
  if (['push', 'pull', 'info'].indexOf(action) < 0) return done(400, { ok: false, error: 'action 必须是 push/pull/info' });

  let s;
  try {
    s = stores();
  } catch (e) {
    return done(500, { ok: false, error: '云存储不可用：' + String(e.message || e) });
  }

  const sess = await readSession(s.sessions, token);
  if (!sess) return done(401, { ok: false, error: '请先登录账号再云同步' });

  const key = 'data-' + sha(sess.username.toLowerCase()).slice(0, 40);

  try {
    if (action === 'push') {
      const data = body.data;
      if (!data || !Array.isArray(data.cards)) return done(400, { ok: false, error: 'data.cards 必须是数组' });
      const payload = { data: data, updatedAt: new Date().toISOString(), count: data.cards.length, username: sess.username };
      await s.data.setJSON(key, payload);
      return done(200, { ok: true, updatedAt: payload.updatedAt, count: payload.count, username: sess.username });
    }

    if (action === 'pull') {
      const v = await s.data.get(key, { type: 'json' }).catch(() => null);
      if (!v) return done(200, { ok: true, data: null, username: sess.username, note: '云端还没有数据，先点「上传」' });
      return done(200, { ok: true, data: v.data, updatedAt: v.updatedAt, count: v.count, username: sess.username });
    }

    const meta = await s.data.getMetadata(key).catch(() => null);
    return done(200, { ok: true, exists: Boolean(meta), meta: meta || null, username: sess.username });
  } catch (e) {
    return done(500, { ok: false, error: String((e && e.message) || e) });
  }
};
