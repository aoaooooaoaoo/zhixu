/**
 * 知序 QQ 桥的最小验证：不连 QQ，只验证「提取链接 + 投递收件箱」。
 * 运行：node integrations/qq/test_bridge.mjs
 */
import http from 'node:http';
import assert from 'node:assert/strict';

process.env.QQ_BRIDGE_NO_AUTOSTART = '1';
process.env.ZHIXU_INBOX_URL = 'http://127.0.0.1:8899/api/inbox';
process.env.ZHIXU_INBOX_TOKEN = 'test-token';

const { textOf, urlsOf, deliver } = await import('./qq_bridge.mjs');

let received = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    received = { url: req.url, token: req.headers['x-inbox-token'], body: JSON.parse(body || '{}') };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((resolve) => server.listen(8899, '127.0.0.1', resolve));

assert.equal(
  textOf({ raw_message: '看这个 https://example.com/a 和 https://example.com/b', message: [] }),
  '看这个 https://example.com/a 和 https://example.com/b'
);
assert.deepEqual(urlsOf('看 https://example.com/a，还有 https://b.example/x?q=1。'), [
  'https://example.com/a',
  'https://b.example/x?q=1',
]);
assert.deepEqual(urlsOf('没有链接'), []);
assert.deepEqual(urlsOf('https://example.com/a https://example.com/a'), ['https://example.com/a']);

const event = { user_id: 123, sender: { nickname: '测试' } };
assert.equal(await deliver('https://example.com/a', event), true);
assert.equal(received.url, '/api/inbox');
assert.equal(received.token, 'test-token');
assert.equal(received.body.url, 'https://example.com/a');
assert.equal(received.body.from, 'QQ · 测试');

// 一分钟内重复链接不重复投递
assert.equal(await deliver('https://example.com/a', event), false);

server.close();
console.log('[PASS] qq_bridge: textOf / urlsOf / deliver / 去重 / token 头');
