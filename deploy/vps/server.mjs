/**
 * 知序 · VPS 服务（公网版）
 *
 * - 静态托管 ./dist
 * - /api/* 交给 ./functions 下的处理器（resolve / analyze / ask / auth / sync）
 * - auth/sync 用本地文件存储（代替 Netlify Blobs），通过 node_modules/@netlify/blobs 兼容层实现
 *
 * 环境变量（自动读取同目录 .env）：
 *   PORT / PORT2 / HOST  默认 127.0.0.1:8090；PORT2 为备用公网端口
 *   WJ_LLM_API_KEY       星火 key（必需，否则 AI 功能不可用）
 *   WJ_LLM_BASE_URL / WJ_LLM_MODEL / WJ_LLM_EXTRA_BODY
 *   ZHIXU_RATE_PER_HOUR  每 IP 每小时 AI 调用上限，默认 60
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const FUNCTIONS_DIR = path.join(HERE, 'functions');

// 读取 .env（先读，再取端口）
const envFile = path.join(HERE, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.PORT || 8090);
const PORT2 = Number(process.env.PORT2 || 0);
const HOST = process.env.HOST || '127.0.0.1';
const RATE = Number(process.env.ZHIXU_RATE_PER_HOUR || 60);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const handlers = {};
function loadHandler(name) {
  if (handlers[name] !== undefined) return handlers[name];
  if (!/^[a-z0-9_-]+$/i.test(name)) return (handlers[name] = null);
  const file = path.join(FUNCTIONS_DIR, name + '.js');
  if (!fs.existsSync(file)) return (handlers[name] = null);
  try {
    const mod = require(file);
    handlers[name] = typeof mod.handler === 'function' ? mod.handler : null;
  } catch (e) {
    console.error('[zhixu] 加载 ' + name + ' 失败: ' + e.message);
    handlers[name] = null;
  }
  return handlers[name];
}

const rateMap = new Map();
function allowed(ip) {
  const now = Date.now();
  const rec = rateMap.get(ip);
  if (!rec || rec.resetAt < now) {
    rateMap.set(ip, { count: 1, resetAt: now + 3600 * 1000 });
    return true;
  }
  if (rec.count >= RATE) return false;
  rec.count += 1;
  return true;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function sendFile(res, file) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => resolve(buf));
    req.on('error', () => resolve(''));
  });
}

async function handleApi(req, res, name) {
  const handler = loadHandler(name);
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '接口不存在' }));
    return;
  }

  if (['analyze', 'ask', 'resolve'].includes(name) && !allowed(clientIp(req))) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '访问太频繁，请稍后再试' }));
    return;
  }

  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
  const qs = (req.url || '').split('?')[1] || '';
  const queryStringParameters = {};
  if (qs) for (const [k, v] of new URLSearchParams(qs)) queryStringParameters[k] = v;

  const event = {
    httpMethod: req.method,
    path: (req.url || '').split('?')[0],
    headers: req.headers,
    body,
    isBase64Encoded: false,
    queryStringParameters
  };

  try {
    const result = await handler(event);
    res.writeHead(result.statusCode || 200, result.headers || { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(result.body || '');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
}

function handleRequest(req, res) {
  const url = req.url || '/';

  if (url.startsWith('/api/')) {
    const name = url.split('?')[0].replace(/^\/api\//, '').replace(/\/+$/, '');
    handleApi(req, res, name);
    return;
  }

  if (url === '/__health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, mode: 'vps', port: PORT }));
    return;
  }

  let rel = decodeURIComponent(url.split('?')[0]);
  if (rel === '/') rel = 'index.html';
  const file = path.join(DIST, rel.replace(/^\/+/, ''));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) { sendFile(res, file); return; }

  const index = path.join(DIST, 'index.html');
  if (fs.existsSync(index)) { sendFile(res, index); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('dist 未部署');
}

const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log('[zhixu] 监听 ' + HOST + ':' + PORT + '，静态目录 ' + DIST);
});

if (PORT2 && PORT2 !== PORT) {
  const server2 = http.createServer(handleRequest);
  server2.listen(PORT2, HOST, () => {
    console.log('[zhixu] 备用端口监听 ' + HOST + ':' + PORT2);
  });
}
