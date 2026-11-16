/**
 * 知序 · AI 卡片提炼（Netlify Function，可选）
 * 路由：/api/analyze
 *
 * 有模型 key（环境变量）时走真 AI；没有则返回 503，前端自动退回本地规则。
 * key 只存在服务端环境变量，绝不下发到浏览器。
 *
 * 环境变量（Netlify → Site configuration → Environment variables）：
 *   WJ_LLM_API_KEY    必填
 *   WJ_LLM_BASE_URL   选填，默认星火 MaaS 地址
 *   WJ_LLM_MODEL      选填，默认 spark-x2.6-4b
 */

const TIMEOUT_MS = 55000;
const DEFAULT_CATEGORIES = ['护肤与美妆', '学习与效率', '职场与成长', '健康与生活', '穿搭与风格', '美食与旅行', '理财与搞钱', '家居与收纳', '数码与工具', '情绪与关系'];

/**
 * categories：调用方（前端）传进来的当前分类列表；为空时用默认列表。
 * AI 优先复用已有分类；都不合适时允许新建分类（≤12 字），并返回 isNewCategory: true。
 */
function buildMessages(text, url, categories) {
  const cats = (Array.isArray(categories) && categories.length ? categories : DEFAULT_CATEGORIES)
    .map(function (x) { return String(x).trim(); })
    .filter(Boolean)
    .slice(0, 40);
  const system = '你是「知序」，一个帮用户把小红书/网页笔记提炼成知识卡片的助手。' +
    '只做提炼，不扩写、不编造。输出严格 JSON（不要 markdown 代码块），字段：' +
    '{"title": "不超过30字的标题", "summary": "80-120字的一句话摘要", ' +
    '"points": ["3-4条可执行要点，每条不超过60字"], ' +
    '"tags": ["3-5个短标签"], ' +
    '"category": "优先从已有分类里选一个；确实都不合适时新建一个分类（不超过12字）", ' +
    '"isNewCategory": true 或 false（category 是否为新建分类）, ' +
    '"topic": "这个分类下的具体主题，不超过12字", ' +
    '"core": "不超过10字的核心短语（名词短语，概括这张卡片的核心内容）", ' +
    '"quote": "原文里最值得保留的一句，不超过60字"}。' +
    '已有分类（优先复用，只有真的放不进去才新建）：' + cats.join('、') + '。' +
    '注意：上面这些分类都比较宽泛。如果内容属于一个明确、可复用的专门领域（例如宠物养护、汽车、编程、法律、考研、摄影、健身、烹饪等），' +
    '而已有分类只是勉强相关，请新建这个专门分类（category 用新分类名，isNewCategory 设为 true），不要硬塞进「健康与生活」「学习与效率」这类大桶。' +
    '只有当内容确实属于已有分类覆盖的主题时，才复用已有分类（isNewCategory 为 false）。' +
    '新建分类时要简短、可复用（比如「科研与论文」「宠物养护」），不要用「新知识 · 关键词」这种临时命名。' +
    '标题要具体（写清对象与结论），不要用「核心内容」「知识梳理」「内容简介」这类空泛说法；core 用名词短语，同样不要写「核心内容」。';
  const user = '原文：\n' + String(text || '').slice(0, 6000) +
    '\n\n原帖链接（可能为空）：' + (url || '无') + '\n请输出 JSON。';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function parseJsonCard(content) {
  let s = String(content || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON');
  const card = JSON.parse(s.slice(start, end + 1));
  ['title', 'summary', 'category', 'topic'].forEach(function (k) {
    card[k] = String(card[k] || '').trim();
  });
  card.points = (card.points || []).map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 5);
  card.tags = (card.tags || []).map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 6);
  card.quote = String(card.quote || '').trim();
  card.core = String(card.core || '').trim().slice(0, 12);
  card.isNewCategory = card.isNewCategory === true;
  if (!card.title || !card.summary) throw new Error('模型返回的卡片字段不完整');
  return card;
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const done = function (code, payload) {
    return { statusCode: code, headers: headers, body: JSON.stringify(payload) };
  };

  if (event.httpMethod !== 'POST') return done(405, { ok: false, error: '只支持 POST' });

  let text = '';
  let url = '';
  let categories = [];
  try {
    const body = JSON.parse(event.body || '{}');
    text = String(body.text || '');
    url = String(body.url || '');
    if (Array.isArray(body.categories)) {
      categories = body.categories.map(function (x) { return String(x || '').trim(); }).filter(Boolean).slice(0, 40);
    }
  } catch (e) {
    return done(400, { ok: false, error: '请求体不是合法 JSON' });
  }
  if (text.trim().length < 12) return done(400, { ok: false, error: '内容太短，至少 12 个字' });

  const key = process.env.WJ_LLM_API_KEY || process.env.RP_LLM_API_KEY;
  const base = (process.env.WJ_LLM_BASE_URL || process.env.RP_LLM_BASE_URL || 'https://maas-api.cn-huabei-1.xf-yun.com/v2').replace(/\/+$/, '');
  const model = process.env.WJ_LLM_MODEL || process.env.RP_LLM_MODEL || 'spark-x2.6-4b';

  if (!key) {
    return done(503, {
      ok: false,
      error: '未配置模型 key',
      hint: 'Netlify → Site configuration → Environment variables 添加 WJ_LLM_API_KEY 后重新部署'
    });
  }

  let extra = {};
  try {
    if (process.env.WJ_LLM_EXTRA_BODY) extra = JSON.parse(process.env.WJ_LLM_EXTRA_BODY);
  } catch (e) { extra = {}; }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(Object.assign({
        model: model,
        messages: buildMessages(text, url, categories),
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
    const card = parseJsonCard(content);
    return done(200, { ok: true, mode: 'spark', card: card });
  } catch (err) {
    return done(500, { ok: false, error: String((err && err.message) || err) });
  } finally {
    clearTimeout(timer);
  }
};
