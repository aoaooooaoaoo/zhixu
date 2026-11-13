/**
 * 打包前：把 web/dist 复制到 electron/dist
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'web', 'dist');
const DST = path.join(__dirname, 'dist');

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
console.log('已复制 dist：' + DST);

// 一并打包抓取助手（Electron 启动时自动拉起）
const HELPER_SRC = path.resolve(__dirname, '..', 'integrations', 'xhs', 'xhs_helper.mjs');
const HELPER_DST = path.join(__dirname, 'helper');
if (fs.existsSync(HELPER_SRC)) {
  fs.mkdirSync(HELPER_DST, { recursive: true });
  fs.copyFileSync(HELPER_SRC, path.join(HELPER_DST, 'xhs_helper.mjs'));
  console.log('已复制抓取助手到 electron/helper');
} else {
  console.warn('未找到抓取助手，跳过');
}
