const BASE = 'http://127.0.0.1:8788';
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('PASS ' + n + (e ? '  [' + e + ']' : '')); } else { fail++; console.log('FAIL ' + n + (e ? '  [' + e + ']' : '')); } };

async function post(path, payload) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  return { status: res.status, json, text };
}

(async () => {
  const h = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  ok('health', Boolean(h && h.ok), h && h.mode + ' / auth=' + h.auth);

  const idx = await fetch(BASE + '/').then((r) => r.status);
  ok('静态首页', idx === 200);

  const ex = await post('/api/resolve', { url: 'https://example.com' });
  ok('resolve 普通网页', ex.status === 200 && ex.json && ex.json.ok, ex.json && ex.json.title);

  const db = await post('/api/resolve', { url: 'https://book.douban.com/subject/1084336/' });
  ok('resolve 豆瓣', db.status === 200 && db.json && db.json.text.length > 200, db.json && (db.json.title + ' / ' + db.json.text.length + ' 字'));

  const an = await post('/api/analyze', {
    text: '真正重要的东西，用眼睛是看不见的。它提醒我很多价值不在表面：一段关系里的耐心、一次失败的复盘、一个没人看见的坚持。',
    url: 'https://book.douban.com/subject/1084336/'
  });
  ok('analyze 出卡', an.status === 200 && an.json && an.json.ok && an.json.card, an.json && an.json.card && an.json.card.title);
  ok('卡片含 core', Boolean(an.json && an.json.card && an.json.card.core), an.json && an.json.card && an.json.card.core);

  const ask = await post('/api/ask', {
    question: '我存的内容里有什么关于小王子？',
    cards: [{ title: '小王子', summary: '关于爱与责任', points: ['用眼睛看不见'], category: '文学', topic: '经典' }]
  });
  ok('ask 问答', ask.status === 200 && ask.json && ask.json.ok && ask.json.answer, ask.json && String(ask.json.answer).slice(0, 20));

  const user = 'cf_' + Date.now().toString(36);
  const reg = await post('/api/auth', { action: 'register', username: user, password: 'pass1234' });
  ok('注册', reg.status === 200 && reg.json && reg.json.ok, reg.json && reg.json.error);
  const token = reg.json && reg.json.token;

  const bind = await post('/api/auth', { action: 'bind-qq', token, qq: '123456789' });
  ok('绑定 QQ', bind.status === 200 && bind.json && bind.json.user.qq === '123456789');

  const push = await post('/api/sync', { action: 'push', token, data: { version: 1, cards: [{ id: 'c1', title: 'CF 同步测试', summary: 's', points: [] }] } });
  ok('云同步上传', push.status === 200 && push.json && push.json.ok, push.json && push.json.count + ' 张');

  const pull = await post('/api/sync', { action: 'pull', token });
  ok('云同步拉取', pull.status === 200 && pull.json && pull.json.data && pull.json.data.cards[0].title === 'CF 同步测试');

  const bad = await post('/api/sync', { action: 'pull', token: 'bad-token-xxxxxx' });
  ok('未登录被拒', bad.status === 401);

  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
