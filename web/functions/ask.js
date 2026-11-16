/**
 * 知序 · 知识库问答（Netlify Function）
 * 路由：/api/ask
 *
 * 输入：{ question, cards: [{ title, summary, points, category, topic }] }
 * 输出：{ ok, answer, mode }
 *
 * 只根据传入的卡片回答，要求引用卡片标题；找不到就直说，不编造。
 */
const TIMEOUT_MS = 55000;

function buildMessages(question, cards) {
  const list = (cards || []).slice(0, 10).map((c, i) => {
    const points = Array.isArray(c.points) ? c.points.slice(0, 4).map((p) => '- ' + p).join('\n') : '';
    return `[${i + 1}] 「${c.title || '未命名'}」\n分类：${c.category || ''} › ${c.topic || ''}\n摘要：${(c.summary || '').slice(0, 300)}\n要点：\n${points}`;
  }).join('\n\n');

  const system = '你是「知序」的知识库助手。请只根据下面提供的知识卡片回答用户问题。' +
    '回答要求：1) 中文，简洁，3-6 句；2) 引用卡片时用「标题」标注来源；' +
    '3) 如果卡片里没有相关信息，直接说「现有卡片里没有找到相关内容」，不要编造；' +
    '4) 可以给出基于卡片的延伸建议，但要说明是推测。';
  const user = '知识卡片：\n' + (list || '（无）') + '\n\n问题：' + String(question || '').slice(0, 500);
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const done = (code, payload) => ({ statusCode: code, headers, body: JSON.stringify(payload) });

  if (event.httpMethod !== 'POST') return done(405, { ok: false, error: '只支持 POST' });

  let question = '';
  let cards = [];
  try {
    const body = JSON.parse(event.body || '{}');
    question = String(body.question || '').trim();
    cards = Array.isArray(body.cards) ? body.cards.slice(0, 10) : [];
  } catch (e) {
    return done(400, { ok: false, error: '请求体不是合法 JSON' });
  }
  if (question.length < 2) return done(400, { ok: false, error: '问题太短' });
  if (!cards.length) return done(400, { ok: false, error: '没有可用的知识卡片' });

  const key = process.env.WJ_LLM_API_KEY || process.env.RP_LLM_API_KEY;
  const base = (process.env.WJ_LLM_BASE_URL || process.env.RP_LLM_BASE_URL || 'https://maas-api.cn-huabei-1.xf-yun.com/v2').replace(/\/+$/, '');
  const model = process.env.WJ_LLM_MODEL || process.env.RP_LLM_MODEL || 'spark-x2.6-4b';
  if (!key) return done(503, { ok: false, error: '未配置模型 key' });

  let extra = {};
  try { if (process.env.WJ_LLM_EXTRA_BODY) extra = JSON.parse(process.env.WJ_LLM_EXTRA_BODY); } catch (e) { extra = {}; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(Object.assign({
        model: model,
        messages: buildMessages(question, cards),
        temperature: 0.3,
        stream: false
      }, extra))
    });
    if (!res.ok) {
      const detail = await res.text();
      return done(502, { ok: false, error: '模型接口 HTTP ' + res.status, detail: String(detail).slice(0, 200) });
    }
    const payload = await res.json();
    const answer = (((payload.choices || [])[0] || {}).message || {}).content || '';
    if (!answer.trim()) return done(500, { ok: false, error: '模型返回为空' });
    return done(200, { ok: true, mode: 'spark', answer: answer.trim(), used: cards.length });
  } catch (err) {
    return done(500, { ok: false, error: String((err && err.message) || err) });
  } finally {
    clearTimeout(timer);
  }
};
