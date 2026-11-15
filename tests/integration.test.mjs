/**
 * 端到端集成测试：本地抓取助手 + 线上 API
 * 运行：node tests/integration.test.mjs
 *
 * 前置：
 *   - 本地助手已启动（integrations/xhs/xhs_helper.mjs）且已登录小红书
 *   - 线上站点可访问
 */
const HELPER = 'http://127.0.0.1:8790';
const SITE = 'https://zhixu-note.netlify.app';

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

async function postJson(url, payload, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* ignore */ }
    return { status: res.status, json };
  } finally { clearTimeout(timer); }
}

async function getJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally { clearTimeout(timer); }
}

const onlyFlag = process.argv[2] || 'all';

(async () => {
  // 1) 助手健康
  if (onlyFlag === 'all' || onlyFlag === 'helper') {
    const h = await getJson(HELPER + '/health').catch(() => null);
    const helperUp = Boolean(h && h.json && h.json.ok);
    ok('本地助手在线', helperUp, helperUp ? h.json.name : '未启动');
    if (!helperUp) {
      console.log('\n提示：先运行 node integrations/xhs/xhs_helper.mjs');
    } else {
      const s = await postJson(HELPER + '/search', { site: 'xiaohongshu', keyword: '西安交通大学', limit: 3, sort: 'popular' });
      const items = (s.json && s.json.items) || [];
      ok('搜索接口返回结果', Boolean(s.json && s.json.ok) && items.length > 0, items.length + ' 条');
      if (items.length) {
        ok('结果标题非空', items.filter((x) => x.title).length >= 1, items[0].title);
        ok('结果带 xsec_token', items.some((x) => x.hasToken), String(items[0].hasToken));
        ok('结果按热度排序', items.length < 2 || Number(String(items[0].likes).replace(/\D/g, '') || 0) >= Number(String(items[1].likes).replace(/\D/g, '') || 0), items.map((x) => x.likes).join(' / '));

        const r = await postJson(HELPER + '/resolve', { url: items[0].url });
        ok('笔记正文可读（含 token）', Boolean(r.json && r.json.ok) && r.json.text.length > 10, (r.json && r.json.title) + ' / ' + (r.json && r.json.text.length) + ' 字');
        ok('正文不含 300031 错误', !(r.json && r.json.text || '').includes('300031'));

        const cm = await postJson(HELPER + '/comments', { url: items[0].url, limit: 3 }, 150000);
        ok('评论接口可用', Boolean(cm.json && cm.json.ok) && (cm.json.items || []).length > 0, cm.json ? (cm.json.total + ' 条') : '');
        if (cm.json && cm.json.items && cm.json.items.length) {
          ok('评论字段完整', Boolean(cm.json.items[0].text), (cm.json.items[0].likes || '?') + ' 赞');
        }
      }
    }
  }

  // 2) 线上 API
  if (onlyFlag === 'all' || onlyFlag === 'api') {
    const h = await getJson(SITE + '/api/health').catch(() => null);
    ok('线上 /api/health 正常', Boolean(h && h.json && h.json.ok), h && h.json ? h.json.mode : '');
    ok('AI 已启用', Boolean(h && h.json && h.json.mode === 'spark'));
    ok('链接读取已启用', Boolean(h && h.json && h.json.resolve === true));

    const a = await postJson(SITE + '/api/analyze', {
      text: '真正重要的东西，用眼睛是看不见的。它提醒我很多价值不在表面：一段关系里的耐心、一次失败的复盘、一个没人看见的坚持。所以要判断一件事，先问它真正重要的部分是什么。',
      url: 'https://book.douban.com/subject/1084336/'
    });
    ok('线上 AI 提炼可用', Boolean(a.json && a.json.ok && a.json.card), a.json && a.json.card ? a.json.card.title : '');
    ok('卡片含 core', Boolean(a.json && a.json.card && a.json.card.core), a.json && a.json.card ? a.json.card.core : '');
    ok('卡片要点 1-5 条', Boolean(a.json && a.json.card && a.json.card.points && a.json.card.points.length >= 1 && a.json.card.points.length <= 5));

    const bad = await postJson(SITE + '/api/analyze', { text: '太短' });
    ok('短文本被拒绝', bad.status === 400, 'HTTP ' + bad.status);

    const ask = await postJson(SITE + '/api/ask', {
      question: '我存的内容里有哪些整理笔记的方法？',
      cards: [{ title: '测试卡片·笔记方法', summary: '这张卡片讲如何整理笔记：先抓结论，再列要点。', points: ['先写一句话结论', '再列 3 条要点'], category: '学习与效率', topic: '笔记方法' }]
    });
    ok('线上知识库问答可用', Boolean(ask.json && ask.json.ok && ask.json.answer), ask.json && ask.json.answer ? String(ask.json.answer).slice(0, 24) : '');

    const syncCode = 'test-sync-' + Date.now();
    const push = await postJson(SITE + '/api/sync', {
      action: 'push',
      code: syncCode,
      data: { version: 1, cards: [{ id: 'sync-test', title: '同步测试卡片', summary: 'x', points: [], category: '测试', topic: '同步' }] }
    });
    ok('云同步上传', Boolean(push.json && push.json.ok), push.json ? push.json.count + ' 张' : '');
    const pull = await postJson(SITE + '/api/sync', { action: 'pull', code: syncCode });
    const pulled = pull.json && pull.json.data && pull.json.data.cards && pull.json.data.cards[0];
    ok('云同步拉取一致', Boolean(pull.json && pull.json.ok && pulled && pulled.title === '同步测试卡片'), pulled ? pulled.title : '');
  }

  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
