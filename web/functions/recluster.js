/**
 * 知序 · AI 重新归纳分类（VPS / Netlify 通用函数）
 * 路由：/api/recluster
 *
 * 输入：{ cards: [{id,title,summary,points,tags,category,topic}], categories: ["已有分类"...] }
 * 输出：{ ok, assignments: [{id, category}], newCategories: ["新分类"...], mode }
 *
 * 规则：优先复用已有分类；已有分类不够用时允许新建（≤12 字），并单独列在 newCategories 里。
 */
const TIMEOUT_MS = 60000;

function buildMessages(cards, categories) {
  const list = cards.slice(0, 80).map((c, i) => {
    const tags = Array.isArray(c.tags) ? c.tags.slice(0, 4).join('/') : '';
    return '[' + (i + 1) + '] id=' + c.id + ' | 现分类：' + (c.category || '') + ' | 标题：' + (c.title || '') +
      ' | 摘要：' + String(c.summary || '').slice(0, 120) + (tags ? ' | 标签：' + tags : '');
  }).join('\n');

  const system = '你是「知序」的知识库整理助手，任务是把卡片重新归类。' +
    '规则：' +
    '1) 优先复用已有分类；' +
    '2) 现有分类太宽泛或不够用时，允许新建更贴切的分类（每个 ≤12 字，例如「宠物养护」「科研与论文」「汽车保养」），不要硬塞进「健康与生活」「学习与效率」这类大桶；' +
    '3) 分类要稳定、可复用，不要按单张卡片起名；' +
    '4) 只输出 JSON，不要 markdown。';
  const user = '已有分类：' + (categories || []).join('、') +
    '\n\n卡片列表：\n' + list +
    '\n\n请输出 JSON：{"assignments":[{"id":"卡片id","category":"分类名"}],"newCategories":["本次新建的分类名"]}' +
    '\n要求：assignments 覆盖所有卡片；newCategories 只列本次真正新增的分类。';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function parseJson(content) {
  let s = String(content || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON');
  return JSON.parse(s.slice(start, end + 1));
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const done = (code, payload) => ({ statusCode: code, headers, body: JSON.stringify(payload) });

  if (event.httpMethod !== 'POST') return done(405, { ok: false, error: '只支持 POST' });

  let cards = [];
  let categories = [];
  try {
    const body = JSON.parse(event.body || '{}');
    cards = Array.isArray(body.cards) ? body.cards.filter((c) => c && c.id) : [];
    categories = Array.isArray(body.categories) ? body.categories.map(String).slice(0, 40) : [];
  } catch (e) {
    return done(400, { ok: false, error: '请求体不是合法 JSON' });
  }
  if (!cards.length) return done(400, { ok: false, error: '没有卡片可整理' });

  const key = process.env.WJ_LLM_API_KEY || process.env.RP_LLM_API_KEY;
  const base = (process.env.WJ_LLM_BASE_URL || process.env.RP_LLM_BASE_URL || 'https://maas-api.cn-huabei-1.xf-yun.com/v2').replace(/\/+$/, '');
  const model = process.env.WJ_LLM_MODEL || process.env.RP_LLM_MODEL || 'spark-x2.6-4b';
  if (!key) return done(503, { ok: false, error: '未配置模型 key' });

  let extra = {};
  try {
    if (process.env.WJ_LLM_EXTRA_BODY) extra = JSON.parse(process.env.WJ_LLM_EXTRA_BODY);
  } catch (e) { extra = {}; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(Object.assign({
        model,
        messages: buildMessages(cards, categories),
        temperature: 0.2,
        stream: false
      }, extra))
    });
    if (!res.ok) {
      const detail = await res.text();
      return done(502, { ok: false, error: '模型接口 HTTP ' + res.status, detail: String(detail).slice(0, 300) });
    }
    const payload = await res.json();
    const content = (((payload.choices || [])[0] || {}).message || {}).content || '';
    const parsed = parseJson(content);
    const assignments = (parsed.assignments || [])
      .filter((a) => a && a.id && a.category)
      .map((a) => ({ id: String(a.id), category: String(a.category).trim().slice(0, 12) }));
    const newCategories = (parsed.newCategories || [])
      .map((x) => String(x).trim().slice(0, 12))
      .filter(Boolean);
    return done(200, { ok: true, mode: 'spark', assignments, newCategories });
  } catch (err) {
    return done(500, { ok: false, error: String((err && err.message) || err) });
  } finally {
    clearTimeout(timer);
  }
};
