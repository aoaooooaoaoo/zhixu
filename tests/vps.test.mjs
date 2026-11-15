const SITE = process.env.ZHIXU_TEST_SITE || 'http://47.86.32.77:8080';
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('PASS ' + n + (e ? '  [' + e + ']' : '')); } else { fail++; console.log('FAIL ' + n + (e ? '  [' + e + ']' : '')); } };

async function post(path, payload) {
  const res = await fetch(SITE + path, {
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
  const home = await fetch(SITE + '/');
  const html = await home.text();
  ok('公网首页可访问', home.ok && html.includes('知序'), 'HTTP ' + home.status);

  const js = await fetch(SITE + '/app.js');
  ok('静态资源 app.js', js.ok, 'HTTP ' + js.status);

  const h = await fetch(SITE + '/api/health').then((r) => r.json()).catch(() => null);
  ok('公网 /api/health', Boolean(h && h.ok), h && (h.mode + ' / ' + (h.name || '')));

  const ex = await post('/api/resolve', { url: 'https://example.com' });
  ok('resolve 可用', ex.status === 200 && ex.json && ex.json.ok, ex.json && ex.json.title);

  const an = await post('/api/analyze', {
    text: '真正重要的东西，用眼睛是看不见的。它提醒我很多价值不在表面：一段关系里的耐心、一次失败的复盘、一个没人看见的坚持。',
    url: 'https://book.douban.com/subject/1084336/'
  });
  ok('AI 提炼可用', an.status === 200 && an.json && an.json.ok && an.json.card, an.json && an.json.card && an.json.card.title);

  const user = 'vps_' + Date.now().toString(36);
  const reg = await post('/api/auth', { action: 'register', username: user, password: 'pass1234' });
  ok('注册可用', reg.status === 200 && reg.json && reg.json.ok, reg.json && reg.json.error);
  const token = reg.json && reg.json.token;

  const bind = await post('/api/auth', { action: 'bind-qq', token, qq: '123456789' });
  ok('绑定 QQ', bind.status === 200 && bind.json && bind.json.user.qq === '123456789');

  const push = await post('/api/sync', { action: 'push', token, data: { version: 1, cards: [{ id: 'v1', title: 'VPS 同步测试', summary: 's', points: [] }] } });
  ok('云同步上传', push.status === 200 && push.json && push.json.ok, push.json && push.json.count + ' 张');

  const pull = await post('/api/sync', { action: 'pull', token });
  ok('云同步拉取', pull.status === 200 && pull.json && pull.json.data && pull.json.data.cards[0].title === 'VPS 同步测试');

  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
