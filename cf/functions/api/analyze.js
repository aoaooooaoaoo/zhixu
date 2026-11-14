import { json, readJson } from '../../lib/http.js';
import { llmChat, buildAnalyzeMessages, parseJsonCard } from '../../lib/llm.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ ok: false, error: '只支持 POST' }, 405);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: '请求体不是合法 JSON' }, 400);

  const text = String(body.text || '');
  const url = String(body.url || '');
  if (text.trim().length < 12) return json({ ok: false, error: '内容太短，至少 12 个字' }, 400);

  const r = await llmChat(env, buildAnalyzeMessages(text, url), { temperature: 0.2 });
  if (!r.ok) {
    const payload = { ok: false, error: r.error };
    if (r.detail) payload.detail = r.detail;
    return json(payload, r.status || 500);
  }
  try {
    const card = parseJsonCard(r.content);
    return json({ ok: true, mode: 'spark', card });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}
