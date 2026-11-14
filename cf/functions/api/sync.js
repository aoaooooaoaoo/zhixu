/**
 * 知序 · 云同步（Cloudflare Pages Functions + KV）
 * 路由：/api/sync
 * 需要 KV 绑定 ZHIXU_KV；数据按账号隔离：d:<sha256(用户名小写)>
 */
import { json, readJson } from '../../lib/http.js';
import { sha256Hex } from '../../lib/crypto.js';

const kv = (env) => env.ZHIXU_KV || null;
const dataKey = async (username) => 'd:' + (await sha256Hex(String(username).toLowerCase())).slice(0, 40);
const sessionKey = async (token) => 's:' + (await sha256Hex(String(token))).slice(0, 40);

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
  if (!store) return json({ ok: false, error: '云同步未配置（需要绑定 KV：ZHIXU_KV）' }, 501);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: '请求体不是合法 JSON' }, 400);

  const action = String(body.action || '').trim();
  const token = String(body.token || '').trim();
  if (['push', 'pull', 'info'].indexOf(action) < 0) return json({ ok: false, error: 'action 必须是 push/pull/info' }, 400);

  const sess = await readSession(store, token);
  if (!sess) return json({ ok: false, error: '请先登录账号再云同步' }, 401);

  const key = await dataKey(sess.username);
  try {
    if (action === 'push') {
      const data = body.data;
      if (!data || !Array.isArray(data.cards)) return json({ ok: false, error: 'data.cards 必须是数组' }, 400);
      const payload = { data, updatedAt: new Date().toISOString(), count: data.cards.length, username: sess.username };
      await store.put(key, JSON.stringify(payload));
      return json({ ok: true, updatedAt: payload.updatedAt, count: payload.count, username: sess.username });
    }
    if (action === 'pull') {
      const raw = await store.get(key);
      if (!raw) return json({ ok: true, data: null, username: sess.username, note: '云端还没有数据，先点「上传」' });
      const v = JSON.parse(raw);
      return json({ ok: true, data: v.data, updatedAt: v.updatedAt, count: v.count, username: sess.username });
    }
    const meta = await store.getWithMetadata(key).catch(() => null);
    return json({ ok: true, exists: Boolean(meta && meta.value), username: sess.username });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
