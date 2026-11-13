// 云函数 analyze：文本 → 知识卡片
// LLM key 只放在云开发控制台的「云函数 → 配置 → 环境变量」，绝不下发到小程序前端。
//
// 环境变量：
//   WJ_LLM_API_KEY   必填
//   WJ_LLM_BASE_URL  选填，默认 https://maas-api.cn-huabei-1.xf-yun.com/v2
//   WJ_LLM_MODEL     选填，默认 spark-x2.6-4b
//   WJ_LLM_EXTRA_BODY 选填，JSON 字符串，会合并进请求体
//
// ⚠️ 部署后请到控制台把本函数超时时间调到 60 秒（默认 3 秒不够模型返回）。

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CATEGORY_HINT = '护肤与美妆、学习与效率、职场与成长、健康与生活、穿搭与风格、美食与旅行、理财与搞钱、家居与收纳、数码与工具、情绪与关系；放不进去时可以用「新知识 · 关键词」';

function buildPrompt(text, url) {
  const system = '你是「知序」，一个帮用户把小红书/网页笔记提炼成知识卡片的助手。' +
    '只做提炼，不扩写、不编造。输出严格 JSON（不要 markdown 代码块），字段：' +
    '{"title": "不超过30字的标题", "summary": "80-120字的一句话摘要", ' +
    '"points": ["3-4条可执行要点，每条不超过60字"], ' +
    '"tags": ["3-5个短标签"], ' +
    '"category": "从这些分类里选一个：' + CATEGORY_HINT + '", ' +
    '"topic": "这个分类下的具体主题，不超过12字", ' +
    '"quote": "原文里最值得保留的一句，不超过60字"}。' +
    'category 必须尽量复用已有分类；只有完全无法归入时才新建「新知识 · 关键词」。';
  const user = '原文：\n' + String(text || '').slice(0, 6000) +
    '\n\n原帖链接（可能为空）：' + (url || '无') + '\n请输出 JSON。';
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
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
  if (!card.title || !card.summary) throw new Error('模型返回的卡片字段不完整');
  return card;
}

function postJson(urlStr, headers, body, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(new Error('模型地址不合法：' + urlStr));
      return;
    }
    const lib = u.protocol === 'http:' ? require('http') : https;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    }, function (res) {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 55000, function () {
      req.destroy(new Error('模型请求超时'));
    });
    req.write(body);
    req.end();
  });
}

exports.main = async function (event) {
  const text = String((event && event.text) || '');
  const url = String((event && event.url) || '');
  if (text.trim().length < 12) {
    return { ok: false, error: '内容太短，至少 12 个字' };
  }

  const key = process.env.WJ_LLM_API_KEY || process.env.RP_LLM_API_KEY;
  const base = process.env.WJ_LLM_BASE_URL || process.env.RP_LLM_BASE_URL || 'https://maas-api.cn-huabei-1.xf-yun.com/v2';
  const model = process.env.WJ_LLM_MODEL || process.env.RP_LLM_MODEL || 'spark-x2.6-4b';

  if (!key) {
    return { ok: false, error: '云函数未配置 WJ_LLM_API_KEY', mode: 'local' };
  }

  let extra = {};
  if (process.env.WJ_LLM_EXTRA_BODY) {
    try { extra = JSON.parse(process.env.WJ_LLM_EXTRA_BODY); } catch (e) { extra = {}; }
  }

  const payload = Object.assign({
    model: model,
    messages: buildPrompt(text, url),
    temperature: 0.2,
    stream: false
  }, extra);

  try {
    const res = await postJson(
      base.replace(/\/+$/, '') + '/chat/completions',
      { Authorization: 'Bearer ' + key },
      JSON.stringify(payload),
      55000
    );
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: '模型接口 HTTP ' + res.status, detail: String(res.body || '').slice(0, 300) };
    }
    const json = JSON.parse(res.body);
    const content = (((json.choices || [])[0] || {}).message || {}).content || '';
    const card = parseJsonCard(content);
    return { ok: true, mode: 'spark', card: card };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
};
