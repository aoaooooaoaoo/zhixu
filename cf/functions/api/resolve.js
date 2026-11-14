import { json, readJson } from '../../lib/http.js';
import { resolveUrl } from '../../lib/extract.js';

export async function onRequest({ request }) {
  if (request.method !== 'POST') return json({ ok: false, error: '只支持 POST' }, 405);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: '请求体不是合法 JSON' }, 400);

  let url = String(body.url || '').trim();
  url = url.replace(/[，。！？、,.!?)）】]+$/, '');
  if (!/^https?:\/\//i.test(url)) return json({ ok: false, error: '只支持 http/https 链接', url }, 400);

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return json({ ok: false, error: '链接格式不对', url }, 400);
  }
  const { status, payload } = await resolveUrl(url);
  return json(payload, status);
}
