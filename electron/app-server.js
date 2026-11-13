/**
 * 知序 Electron 桌面版 · 本地服务（内嵌版）
 * 托管打包进去的 dist，并把 /api/* 代理到线上 Functions。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

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

function sendFile(res, file) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function startServer(opts) {
  const port = (opts && opts.port) || 8789;
  const dist = (opts && opts.dist) || path.join(__dirname, 'dist');
  const apiOrigin = ((opts && opts.apiOrigin) || 'https://zhixu-note.netlify.app').replace(/\/+$/, '');
  const target = new URL(apiOrigin);

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url.startsWith('/api/')) {
      const upstream = https.request({
        hostname: target.hostname,
        port: target.port || 443,
        path: url,
        method: req.method,
        headers: Object.assign({}, req.headers, { host: target.hostname })
      }, (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      });
      upstream.on('error', (e) => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: '代理失败：' + e.message }));
      });
      req.pipe(upstream);
      return;
    }
    if (url === '/__health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, mode: 'electron', port }));
      return;
    }
    let rel = decodeURIComponent(url.split('?')[0]);
    if (rel === '/') rel = 'index.html';
    const file = path.join(dist, rel.replace(/^\/+/, ''));
    if (!file.startsWith(dist)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) { sendFile(res, file); return; }
    const index = path.join(dist, 'index.html');
    if (fs.existsSync(index)) { sendFile(res, index); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dist 不存在');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startServer };
