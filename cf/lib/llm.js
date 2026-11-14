/** 大模型调用（星火 MaaS，OpenAI 兼容），与 Netlify 版同样的环境变量与提示词 */

const TIMEOUT_MS = 55000;

const CATEGORY_HINT = '护肤与美妆、学习与效率、职场与成长、健康与生活、穿搭与风格、美食与旅行、理财与搞钱、家居与收纳、数码与工具、情绪与关系；放不进去时可以用「新知识 · 关键词」';

export function llmConfig(env) {
  return {
    key: (env && (env.WJ_LLM_API_KEY || env.RP_LLM_API_KEY)) || '',
    base: ((env && (env.WJ_LLM_BASE_URL || env.RP_LLM_BASE_URL)) || 'https://maas-api.cn-huabei-1.xf-yun.com/v2').replace(/\/+$/, ''),
    model: (env && (env.WJ_LLM_MODEL || env.RP_LLM_MODEL)) || 'spark-x2.6-4b'
  };
}

export function parseExtra(env) {
  try {
    return env && env.WJ_LLM_EXTRA_BODY ? JSON.parse(env.WJ_LLM_EXTRA_BODY) : {};
  } catch (e) {
    return {};
  }
}

export async function llmChat(env, messages, opts) {
  const cfg = llmConfig(env);
  if (!cfg.key) return { ok: false, status: 503, error: '未配置模型 key（WJ_LLM_API_KEY）' };
  const extra = parseExtra(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cfg.base + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify(Object.assign({
        model: cfg.model,
        messages,
        temperature: (opts && opts.temperature) != null ? opts.temperature : 0.2,
        stream: false
      }, extra))
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, status: 502, error: '模型接口 HTTP ' + res.status, detail: String(detail).slice(0, 300) };
    }
    const payload = await res.json();
    const content = (((payload.choices || [])[0] || {}).message || {}).content || '';
    return { ok: true, content };
  } catch (err) {
    return { ok: false, status: 500, error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

export function buildAnalyzeMessages(text, url) {
  const system = '你是「知序」，一个帮用户把小红书/网页笔记提炼成知识卡片的助手。' +
    '只做提炼，不扩写、不编造。输出严格 JSON（不要 markdown 代码块），字段：' +
    '{"title": "不超过30字的标题", "summary": "80-120字的一句话摘要", ' +
    '"points": ["3-4条可执行要点，每条不超过60字"], ' +
    '"tags": ["3-5个短标签"], ' +
    '"category": "从这些分类里选一个：' + CATEGORY_HINT + '", ' +
    '"topic": "这个分类下的具体主题，不超过12字", ' +
    '"core": "不超过10字的核心短语（名词短语，概括这张卡片的核心内容）", ' +
    '"quote": "原文里最值得保留的一句，不超过60字"}。' +
    'category 必须尽量复用已有分类；只有完全无法归入时才新建「新知识 · 关键词」。' +
    '标题要具体（写清对象与结论），不要用「核心内容」「知识梳理」「内容简介」这类空泛说法；core 用名词短语，同样不要写「核心内容」。';
  const user = '原文：\n' + String(text || '').slice(0, 6000) +
    '\n\n原帖链接（可能为空）：' + (url || '无') + '\n请输出 JSON。';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function parseJsonCard(content) {
  let s = String(content || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON');
  const card = JSON.parse(s.slice(start, end + 1));
  ['title', 'summary', 'category', 'topic'].forEach((k) => { card[k] = String(card[k] || '').trim(); });
  card.points = (card.points || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
  card.tags = (card.tags || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
  card.quote = String(card.quote || '').trim();
  card.core = String(card.core || '').trim().slice(0, 12);
  if (!card.title || !card.summary) throw new Error('模型返回的卡片字段不完整');
  return card;
}

export function buildAskMessages(question, cards) {
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
