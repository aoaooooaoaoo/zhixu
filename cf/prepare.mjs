/**
 * Cloudflare Pages 部署准备：把 web/dist 复制到 cf/dist，并写入 _routes.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'web', 'dist');
const DST = path.join(HERE, 'dist');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const name of fs.readdirSync(p)) {
    const cur = path.join(p, name);
    if (fs.lstatSync(cur).isDirectory()) rmrf(cur);
    else fs.unlinkSync(cur);
  }
  fs.rmdirSync(p);
}

function copy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.lstatSync(s).isDirectory()) copy(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(SRC)) {
  console.error('找不到 web/dist，请先运行：node web/build.js --clean');
  process.exit(1);
}
rmrf(DST);
copy(SRC, DST);

// 只把 /api/* 交给 Functions，其余走静态资源
fs.writeFileSync(path.join(DST, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2));
console.log('已准备 cf/dist（含 _routes.json）');
