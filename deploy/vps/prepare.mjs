/**
 * 组装 VPS 部署包：deploy/vps/dist + functions + blobs 兼容层 + .env
 * 产出 deploy/zhixu-vps.tar.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PKG = path.join(HERE, '_pkg');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const n of fs.readdirSync(p)) {
    const cur = path.join(p, n);
    if (fs.lstatSync(cur).isDirectory()) rmrf(cur);
    else fs.unlinkSync(cur);
  }
  fs.rmdirSync(p);
}

function copy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n);
    const d = path.join(dst, n);
    if (fs.lstatSync(s).isDirectory()) copy(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 1. dist
const DIST_SRC = path.join(ROOT, 'web', 'dist');
if (!fs.existsSync(DIST_SRC)) { console.error('缺 web/dist'); process.exit(1); }
rmrf(PKG);
copy(DIST_SRC, path.join(PKG, 'dist'));

// 2. functions（只带运行需要的 5 个）
const FN_SRC = path.join(ROOT, 'web', 'functions');
const FN_DST = path.join(PKG, 'functions');
fs.mkdirSync(FN_DST, { recursive: true });
for (const name of ['resolve.js', 'analyze.js', 'ask.js', 'auth.js', 'sync.js', 'health.js', 'inbox.js', 'recluster.js', 'digest.js']) {
  const s = path.join(FN_SRC, name);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(FN_DST, name));
}

// 3. server + blobs 兼容层
fs.copyFileSync(path.join(HERE, 'server.mjs'), path.join(PKG, 'server.mjs'));
copy(path.join(HERE, 'blobs-shim'), path.join(PKG, 'node_modules', '@netlify', 'blobs'));

// 4. package.json（说明无外部依赖；不要 type:module，functions 是 CJS）
fs.writeFileSync(path.join(PKG, 'package.json'), JSON.stringify({
  name: 'zhixu-vps',
  version: '1.0.0',
  private: true,
  main: 'server.mjs'
}, null, 2));

console.log('已组装 ' + PKG);
