/**
 * 知序 · 账号（Cloudflare Pages Functions + KV）
 * 路由：/api/auth
 *
 * KV 绑定：ZHIXU_KV（wrangler.toml 里配置）
 * key：
 *   u:<sha256(用户名小写)>  → 用户记录
 *   s:<sha256(token)>       → 会话（30 天）
 */
import { json, readJson } from '../../lib/http.js';
import { sha256Hex, randomHex, hashPassword, timingSafeEqual } from '../../lib/crypto.js';

const TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

const kv = (env) => env.ZHIXU_KV || null;
const userKey = async (username) => 'u:' + (await sha256Hex(String(username).toLowerCase())).slice(0, 40);
const sessionKey = async (token) => 's:' + (await sha256Hex(String(token))).slice(0, 40);

function publicUser(rec) {
  return { username: rec.username, qq: rec.qq || '', createdAt: rec.createdAt, updatedAt: rec.updatedAt };
}
const validUsername = (u) => typeof u === 'string' && u.length >= 3 && u.length <= 24 && /^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(u);
const validPassword = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 64;
const validQQ = (q) => /^[1-9]\d{4,11}$/.test(String(q || ''));

async function readSession(store, token) {
  if (!token || String(token).length < 16) return null;
  const raw = await store.get(await sessionKey(token));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    if (!rec.username || !rec.expiresAt || rec.expiresAt < Date.now()) return null;
    return rec;
  } catch (e) {
    return null;
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ ok: false, error: '只支持 POST' }, 405);
  const store = kv(env);
  if (!store) return json({ ok: false, error: '账号存储未配置（需要绑定 KV：ZHIXU_KV）' }, 501);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: '请求体不是合法 JSON' }, 400);

  const action = String(body.action || '').trim();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const token = String(body.token || '').trim();

  try {
    if (action === 'register') {
      if (!validUsername(username)) return json({ ok: false, error: '用户名 3-24 位，仅字母/数字/下划线/中文' }, 400);
      if (!validPassword(password)) return json({ ok: false, error: '密码 6-64 位' }, 400);
      const key = await userKey(username);
      if (await store.get(key)) return json({ ok: false, error: '用户名已被占用' }, 409);
      const salt = randomHex(16);
      const rec = {
        username, salt, hash: await hashPassword(password, salt), qq: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      await store.put(key, JSON.stringify(rec));
      const raw = randomHex(32);
      await store.put(await sessionKey(raw), JSON.stringify({ username, expiresAt: Date.now() + TOKEN_TTL_SEC * 1000 }), { expirationTtl: TOKEN_TTL_SEC });
      return json({ ok: true, token: raw, user: publicUser(rec) });
    }

    if (action === 'login') {
      if (!validUsername(username) || !validPassword(password)) return json({ ok: false, error: '用户名或密码格式不对' }, 400);
      const raw = await store.get(await userKey(username));
      if (!raw) return json({ ok: false, error: '用户名或密码错误' }, 401);
      const rec = JSON.parse(raw);
      const hash = await hashPassword(password, rec.salt);
      if (!timingSafeEqual(hash, rec.hash)) return json({ ok: false, error: '用户名或密码错误' }, 401);
      const tokenRaw = randomHex(32);
      await store.put(await sessionKey(tokenRaw), JSON.stringify({ username: rec.username, expiresAt: Date.now() + TOKEN_TTL_SEC * 1000 }), { expirationTtl: TOKEN_TTL_SEC });
      return json({ ok: true, token: tokenRaw, user: publicUser(rec) });
    }

    if (action === 'me') {
      const sess = await readSession(store, token);
      if (!sess) return json({ ok: false, error: '登录已过期，请重新登录' }, 401);
      const raw = await store.get(await userKey(sess.username));
      if (!raw) return json({ ok: false, error: '账号不存在' }, 401);
      return json({ ok: true, user: publicUser(JSON.parse(raw)) });
    }

    if (action === 'bind-qq') {
      const sess = await readSession(store, token);
      if (!sess) return json({ ok: false, error: '登录已过期，请重新登录' }, 401);
      const qq = String(body.qq || '').trim();
      if (qq && !validQQ(qq)) return json({ ok: false, error: 'QQ 号应为 5-12 位数字' }, 400);
      const key = await userKey(sess.username);
      const raw = await store.get(key);
      if (!raw) return json({ ok: false, error: '账号不存在' }, 401);
      const rec = JSON.parse(raw);
      rec.qq = qq;
      rec.updatedAt = new Date().toISOString();
      await store.put(key, JSON.stringify(rec));
      return json({ ok: true, user: publicUser(rec) });
    }

    if (action === 'logout') {
      if (token) await store.delete(await sessionKey(token));
      return json({ ok: true });
    }

    return json({ ok: false, error: 'action 必须是 register/login/me/bind-qq/logout' }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
