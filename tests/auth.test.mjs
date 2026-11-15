/**
 * 账号 + 云同步测试（打本地桌面服务，不依赖线上部署）
 *
 * 前置：
 *   ZHIXU_DESKTOP_PORT=8799 node desktop/server.mjs
 *   （需要环境变量 NETLIFY_BLOBS_TOKEN / NETLIFY_BLOBS_SITE_ID 才能写入 Blobs）
 *
 * 运行：
 *   node tests/auth.test.mjs
 *   ZHIXU_TEST_BASE=http://127.0.0.1:8799 node tests/auth.test.mjs
 */
const BASE = (process.env.ZHIXU_TEST_BASE || 'http://127.0.0.1:8799').replace(/\/+$/, '');
const USER = 'test_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const PASS = 'pass1234';

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

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
  const health = await fetch(BASE + '/__health').then((r) => r.json()).catch(() => null);
  ok('本地服务在线', Boolean(health && health.ok), health ? health.mode : '未启动');
  if (!health || !health.ok) {
    console.log('\n提示：先启动本地服务：ZHIXU_DESKTOP_PORT=8799 node desktop/server.mjs');
    process.exit(1);
  }

  const reg = await post('/api/auth', { action: 'register', username: USER, password: PASS });
  ok('注册成功', reg.status === 200 && reg.json && reg.json.ok, reg.json && reg.json.error);
  ok('返回 token', Boolean(reg.json && reg.json.token));
  const token = reg.json && reg.json.token;

  const dup = await post('/api/auth', { action: 'register', username: USER, password: PASS });
  ok('重复用户名被拒', dup.status === 409);

  const login = await post('/api/auth', { action: 'login', username: USER, password: PASS });
  ok('登录成功', login.status === 200 && login.json && login.json.ok);
  const token2 = login.json && login.json.token;

  const badLogin = await post('/api/auth', { action: 'login', username: USER, password: 'wrongpass' });
  ok('错误密码被拒', badLogin.status === 401);

  const me = await post('/api/auth', { action: 'me', token: token2 });
  ok('me 返回用户', me.status === 200 && me.json && me.json.ok && me.json.user.username === USER, me.json && me.json.user && me.json.user.username);

  const bind = await post('/api/auth', { action: 'bind-qq', token: token2, qq: '123456789' });
  ok('绑定接收 QQ', bind.status === 200 && bind.json && bind.json.ok && bind.json.user.qq === '123456789', bind.json && bind.json.user && bind.json.user.qq);

  const badQQ = await post('/api/auth', { action: 'bind-qq', token: token2, qq: 'abc' });
  ok('非法 QQ 被拒', badQQ.status === 400);

  const push = await post('/api/sync', { action: 'push', token: token2, data: { version: 1, cards: [{ id: 'c1', title: '账号同步测试', summary: 's', points: [] }] } });
  ok('账号云同步上传', push.status === 200 && push.json && push.json.ok, push.json && push.json.count + ' 张');

  const pull = await post('/api/sync', { action: 'pull', token: token2 });
  ok('账号云同步拉取', pull.status === 200 && pull.json && pull.json.ok && pull.json.data && pull.json.data.cards[0].title === '账号同步测试');

  const noToken = await post('/api/sync', { action: 'pull', token: 'invalid-token-xxxx' });
  ok('未登录同步被拒', noToken.status === 401);

  const logout = await post('/api/auth', { action: 'logout', token: token2 });
  ok('退出登录', logout.status === 200 && logout.json && logout.json.ok);
  const afterLogout = await post('/api/auth', { action: 'me', token: token2 });
  ok('退出后 token 失效', afterLogout.status === 401);

  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
