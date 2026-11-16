/**
 * 知序 · 账号体系（Netlify Blobs）
 * 路由：/api/auth
 *
 * actions:
 *   register  { username, password }        → 注册并登录
 *   login     { username, password }        → 登录，返回 token
 *   me        { token }                     → 当前用户信息（含绑定的 QQ）
 *   bind-qq   { token, qq }                 → 设置/解绑接收 QQ
 *   logout    { token }                     → 注销会话
 *
 * 安全说明：
 * - 密码用 scrypt + 随机盐哈希存储
 * - token 为 32 字节随机串，服务端只存其 SHA-256，30 天有效
 */
const crypto = require('node:crypto');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function stores() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: 'zhixu-users', consistency: 'strong' };
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || '';
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || '';
  if (siteID) opts.siteID = siteID;
  if (token) opts.token = token;
  return { users: getStore(opts), sessions: getStore(Object.assign({}, opts, { name: 'zhixu-sessions' })) };
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const userKey = (username) => 'u-' + sha(username.toLowerCase()).slice(0, 40);
const sessionKey = (token) => 's-' + sha(token).slice(0, 40);
const hashPassword = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');

function publicUser(rec) {
  return { username: rec.username, qq: rec.qq || '', createdAt: rec.createdAt, updatedAt: rec.updatedAt };
}

function validUsername(u) {
  return typeof u === 'string' && u.length >= 3 && u.length <= 24 && /^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(u);
}
function validPassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 64;
}
function validQQ(q) {
  return /^[1-9]\d{4,11}$/.test(String(q || ''));
}

async function issueSession(sessions, username) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await sessions.setJSON(sessionKey(raw), { username: username, expiresAt: expiresAt });
  return { token: raw, expiresAt: expiresAt };
}

async function readSession(sessions, token) {
  if (!token || String(token).length < 16) return null;
  const rec = await sessions.get(sessionKey(token), { type: 'json' }).catch(() => null);
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
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const token = String(body.token || '').trim();

  let s;
  try {
    s = stores();
  } catch (e) {
    return done(500, { ok: false, error: '账号存储不可用：' + String(e.message || e) });
  }

  try {
    if (action === 'register') {
      if (!validUsername(username)) return done(400, { ok: false, error: '用户名 3-24 位，仅字母/数字/下划线/中文' });
      if (!validPassword(password)) return done(400, { ok: false, error: '密码 6-64 位' });
      const key = userKey(username);
      const exists = await s.users.get(key).catch(() => null);
      if (exists) return done(409, { ok: false, error: '用户名已被占用' });
      const salt = crypto.randomBytes(16).toString('hex');
      const rec = {
        username: username,
        salt: salt,
        hash: hashPassword(password, salt),
        qq: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await s.users.setJSON(key, rec);
      const sess = await issueSession(s.sessions, username);
      return done(200, { ok: true, token: sess.token, expiresAt: sess.expiresAt, user: publicUser(rec) });
    }

    if (action === 'login') {
      if (!validUsername(username) || !validPassword(password)) return done(400, { ok: false, error: '用户名或密码格式不对' });
      const rec = await s.users.get(userKey(username), { type: 'json' }).catch(() => null);
      if (!rec) return done(401, { ok: false, error: '用户名或密码错误' });
      const expect = hashPassword(password, rec.salt);
      const a = Buffer.from(expect, 'hex');
      const b = Buffer.from(rec.hash, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return done(401, { ok: false, error: '用户名或密码错误' });
      const sess = await issueSession(s.sessions, rec.username);
      return done(200, { ok: true, token: sess.token, expiresAt: sess.expiresAt, user: publicUser(rec) });
    }

    if (action === 'me') {
      const sess = await readSession(s.sessions, token);
      if (!sess) return done(401, { ok: false, error: '登录已过期，请重新登录' });
      const rec = await s.users.get(userKey(sess.username), { type: 'json' }).catch(() => null);
      if (!rec) return done(401, { ok: false, error: '账号不存在' });
      return done(200, { ok: true, user: publicUser(rec) });
    }

    if (action === 'bind-qq') {
      const sess = await readSession(s.sessions, token);
      if (!sess) return done(401, { ok: false, error: '登录已过期，请重新登录' });
      const qq = String(body.qq || '').trim();
      if (qq && !validQQ(qq)) return done(400, { ok: false, error: 'QQ 号应为 5-12 位数字' });
      const key = userKey(sess.username);
      const rec = await s.users.get(key, { type: 'json' }).catch(() => null);
      if (!rec) return done(401, { ok: false, error: '账号不存在' });
      rec.qq = qq;
      rec.updatedAt = new Date().toISOString();
      await s.users.setJSON(key, rec);
      return done(200, { ok: true, user: publicUser(rec) });
    }

    if (action === 'logout') {
      if (token) await s.sessions.delete(sessionKey(token)).catch(() => {});
      return done(200, { ok: true });
    }

    return done(400, { ok: false, error: 'action 必须是 register/login/me/bind-qq/logout' });
  } catch (e) {
    return done(500, { ok: false, error: String((e && e.message) || e) });
  }
};
