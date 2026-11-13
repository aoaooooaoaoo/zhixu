/**
 * 知序桌面版 · 本地服务
 *
 * 作用：
 *   1. 在本机提供 http://127.0.0.1:8789 的静态服务（内容来自 web/dist）
 *   2. 把 /api/* 反向代理到线上 Functions（AI 提炼 / 健康检查），这样桌面版也有真 AI
 *
 * 为什么这样做：
 *   - 桌面版有自己的 origin（127.0.0.1:8789），localStorage 与网页版隔离，数据独立
 *   - 不需要 Electron / 安装包，双击启动脚本即可，用系统 Edge/Chrome 的应用窗口
 *
 * 环境变量：
 *   ZHIXU_DESKTOP_PORT   端口，默认 8789
 *   ZHIXU_API_ORIGIN     代理目标，默认 https://zhixu-note.netlify.app
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'web', 'dist');
const PORT = Number(process.env.ZHIXU_DESKTOP_PORT || 8789);
const API_ORIGIN = (process.env.ZHIXU_API_ORIGIN || 'https://zhixu-note.netlify.app').replace(/\/+$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const target = path.join(DIST, rel);
  if (!target.startsWith(DIST)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(target) && fs.statSync(target).isFile()) { sendFile(res, target); return; }
  // SPA 兜底
  const index = path.join(DIST, 'index.html');
  if (fs.existsSync(index)) { sendFile(res, index); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('dist 不存在，请先运行 node web/build.js');
}

function proxyApi(req, res) {
  const u = new URL(API_ORIGIN);
  const targetPath = req.url || '/';
  const upstream = https.request({
    hostname: u.hostname,
    port: u.port || 443,
    path: targetPath,
    method: req.method,
    headers: Object.assign({}, req.headers, { host: u.hostname })
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '代理失败：' + e.message }));
  });
  req.pipe(upstream);
}

/* ---------------------------------------------------------------- 本地函数（离线可用） */
const FUNCTIONS_DIR = path.join(ROOT, 'web', 'functions');

function loadHandler(name) {
  if (!/^[a-z0-9_-]+$/i.test(name)) return null;
  const file = path.join(FUNCTIONS_DIR, name + '.js');
  if (!fs.existsSync(file)) return null;
  try {
    const mod = require(file);
    return typeof mod.handler === 'function' ? mod.handler : null;
  } catch (e) {
    console.error('[desktop] 函数加载失败 ' + name + '：' + e.message);
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => resolve(buf));
    req.on('error', () => resolve(''));
  });
}

async function handleApi(req, res) {
  const name = (req.url || '').split('?')[0].replace(/^\/api\//, '').replace(/\/+$/, '');
  // 默认只把「新功能」放本地（auth/sync）；AI/解析等仍走线上函数，保证在线状态可用
  const localNames = (process.env.ZHIXU_LOCAL_API_NAMES || 'auth,sync').split(',').map((s) => s.trim());
  if (localNames.indexOf(name) < 0) return false;
  const handler = loadHandler(name);
  if (!handler) return false;

  // 需要联网的聚合接口（resolve/analyze/ask）优先走本地实现；本地没有就代理线上
  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
  const qs = (req.url || '').split('?')[1] || '';
  const queryStringParameters = {};
  if (qs) {
    for (const [k, v] of new URLSearchParams(qs)) queryStringParameters[k] = v;
  }
  const event = {
    httpMethod: req.method,
    path: (req.url || '').split('?')[0],
    headers: req.headers,
    body: body,
    isBase64Encoded: false,
    queryStringParameters: queryStringParameters
  };
  try {
    const result = await handler(event);
    res.writeHead(result.statusCode || 200, result.headers || { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(result.body || '');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
  return true;
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('[desktop] 找不到 web/dist，请先运行：node web/build.js --clean');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  if ((req.url || '').startsWith('/api/')) {
    const handled = await handleApi(req, res);
    if (handled) return;
    proxyApi(req, res);
    return;
  }
  if (req.url === '/__health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, mode: 'desktop', port: PORT, api: API_ORIGIN }));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[desktop] 知序桌面版：http://127.0.0.1:' + PORT);
  console.log('[desktop] AI 代理：' + API_ORIGIN + '/api/*');
});
