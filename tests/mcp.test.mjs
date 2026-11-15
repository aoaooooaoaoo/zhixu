/**
 * MCP 协议测试：拉起 zhixu-mcp.mjs，走 initialize / tools/list / tools/call
 * 运行：node tests/mcp.test.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'integrations', 'mcp', 'zhixu-mcp.mjs');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', (c) => { /* 日志忽略 */ });

let buf = Buffer.alloc(0);
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep < 0) break;
    const header = buf.slice(0, sep).toString('utf8');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) { buf = buf.slice(sep + 4); continue; }
    const len = Number(m[1]);
    if (buf.length < sep + 4 + len) break;
    const body = buf.slice(sep + 4, sep + 4 + len).toString('utf8');
    buf = buf.slice(sep + 4 + len);
    try {
      const msg = JSON.parse(body);
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg); }
    } catch (e) { /* ignore */ }
  }
});

function rpc(method, params, timeoutMs = 150000) {
  const id = nextId++;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  child.stdin.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\r\n\r\n' + body);
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, timeoutMs);
  });
}

function textOf(res) {
  try { return JSON.parse(res.result.content[0].text); } catch (e) { return null; }
}

(async () => {
  try {
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } }, 15000);
    ok('initialize 返回 serverInfo', init.result && init.result.serverInfo && init.result.serverInfo.name === 'zhixu-mcp', JSON.stringify(init.result && init.result.serverInfo));
    ok('initialize 声明 tools 能力', init.result && init.result.capabilities && Boolean(init.result.capabilities.tools));

    const list = await rpc('tools/list', {}, 15000);
    const names = ((list.result && list.result.tools) || []).map((t) => t.name);
    ok('tools/list 返回 5 个工具', names.length === 5, names.join(','));
    ok('包含 zhixu_search', names.indexOf('zhixu_search') >= 0);
    ok('包含 zhixu_resolve', names.indexOf('zhixu_resolve') >= 0);
    ok('包含 zhixu_analyze', names.indexOf('zhixu_analyze') >= 0);
    ok('包含 zhixu_status', names.indexOf('zhixu_status') >= 0);
    ok('包含 zhixu_comments', names.indexOf('zhixu_comments') >= 0);

    const status = await rpc('tools/call', { name: 'zhixu_status', arguments: {} }, 30000);
    const st = textOf(status);
    ok('zhixu_status 可调用', st && st.ok === true);
    ok('线上 API 可用', st && st.api && st.api.ok === true, st && st.api ? st.api.mode : 'n/a');

    const search = await rpc('tools/call', { name: 'zhixu_search', arguments: { site: 'xiaohongshu', keyword: '西安交通大学', limit: 3 } }, 150000);
    const sr = textOf(search);
    ok('zhixu_search 返回结果', sr && sr.ok === true && Array.isArray(sr.items) && sr.items.length > 0, sr && (sr.count + ' 条'));
    if (sr && sr.items && sr.items.length) {
      ok('搜索结果带标题', Boolean(sr.items[0].title));
      ok('搜索结果带 xsec_token', Boolean(sr.items[0].hasToken));
    }

    const first = sr && sr.items && sr.items[0];
    if (first && first.url) {
      const res = await rpc('tools/call', { name: 'zhixu_resolve', arguments: { url: first.url } }, 90000);
      const rr = textOf(res);
      ok('zhixu_resolve 可读正文', rr && rr.ok === true && rr.textLen > 0, rr && (rr.title + ' / ' + rr.textLen + ' 字'));

      const cm = await rpc('tools/call', { name: 'zhixu_comments', arguments: { url: first.url, limit: 3 } }, 150000);
      const cr = textOf(cm);
      ok('zhixu_comments 返回评论', cr && cr.ok === true && Array.isArray(cr.items) && cr.items.length > 0, cr && (cr.total + ' 条'));
    } else {
      ok('zhixu_resolve 可读正文', false, '没有可测 URL');
      ok('zhixu_comments 返回评论', false, '没有可测 URL');
    }

    const an = await rpc('tools/call', {
      name: 'zhixu_analyze',
      arguments: { text: '真正重要的东西，用眼睛是看不见的。它提醒我很多价值不在表面：一段关系里的耐心、一次失败的复盘、一个没人看见的坚持。', url: 'https://zhixu-note.netlify.app' }
    }, 120000);
    const ar = textOf(an);
    ok('zhixu_analyze 返回卡片', ar && ar.ok === true && ar.card && ar.card.title, ar && ar.card ? ar.card.title : '');
    if (ar && ar.card) ok('卡片含 core 核心短语', Boolean(ar.card.core), ar.card.core);
  } catch (e) {
    fail++;
    console.log('FAIL 异常：' + e.message);
  }

  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  child.kill();
  process.exit(fail ? 1 : 0);
})();
