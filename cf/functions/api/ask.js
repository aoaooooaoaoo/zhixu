import { json, readJson } from '../../lib/http.js';
import { llmChat, buildAskMessages } from '../../lib/llm.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ ok: false, error: '只支持 POST' }, 405);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: '请求体不是合法 JSON' }, 400);

  const question = String(body.question || '').trim();
  const cards = Array.isArray(body.cards) ? body.cards.slice(0, 10) : [];
  if (question.length < 2) return json({ ok: false, error: '问题太短' }, 400);
  if (!cards.length) return json({ ok: false, error: '没有可用的知识卡片' }, 400);

  const r = await llmChat(env, buildAskMessages(question, cards), { temperature: 0.3 });
  if (!r.ok) return json({ ok: false, error: r.error, detail: r.detail }, r.status);
  if (!String(r.content).trim()) return json({ ok: false, error: '模型返回为空' }, 500);
  return json({ ok: true, mode: 'spark', answer: String(r.content).trim(), used: cards.length });
}
