#!/usr/bin/env node
/**
 * 知序网页版 · 静态部署打包
 *
 * 从 ../app（网页原型）复制出一份**纯静态**产物到 ./dist：
 *   - 只保留浏览器需要的文件（排除 server.py / 日志 / 本机收件箱数据 / Python 缓存）
 *   - 自动写入 Netlify / Vercel / Cloudflare Pages 需要的配置
 *
 * 用法：
 *   node build.js            # 打包
 *   node build.js --clean    # 先清空 dist 再打包（仅当 dist 是本工具生成的）
 */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SRC = path.resolve(HERE, '..', 'app');
const DIST = path.join(HERE, 'dist');
const MARKER = path.join(DIST, '.zhixu-build');

// 只复制这些（白名单，避免把服务端文件/隐私数据带上去）
const INCLUDE = [
  'index.html',
  'app.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) rmrf(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('❌ 找不到网页版目录：' + SRC);
    process.exit(1);
  }

  const clean = process.argv.includes('--clean');
  if (fs.existsSync(DIST)) {
    if (clean) {
      if (!fs.existsSync(MARKER)) {
        console.error('❌ dist 目录不是本工具生成的（缺少 .zhixu-build 标记），拒绝清空。');
        console.error('   如果确认要覆盖，请手动删掉：' + DIST);
        process.exit(1);
      }
      rmrf(DIST);
    }
  }
  ensureDir(DIST);

  const copied = [];
  const missing = [];
  for (const name of INCLUDE) {
    const from = path.join(SRC, name);
    if (!fs.existsSync(from)) { missing.push(name); continue; }
    fs.copyFileSync(from, path.join(DIST, name));
    copied.push(name);
  }
  if (missing.length) {
    console.error('❌ 缺少源文件：' + missing.join('、'));
    process.exit(1);
  }

  // 构建标记（不写本机绝对路径，方便把 dist 拷到别的机器）
  fs.writeFileSync(MARKER, JSON.stringify({
    builtAt: new Date().toISOString(),
    source: 'app/',
    note: '由 web/build.js 生成，可随时删除重建'
  }, null, 2), 'utf8');

  // ---------- 托管配置 ----------
  // Netlify: 发布目录 = 仓库根（这里就是 dist 自身）
  fs.writeFileSync(path.join(DIST, 'netlify.toml'), [
    '[build]',
    '  publish = "."',
    '',
    '[[headers]]',
    '  for = "/*"',
    '  [headers.values]',
    '    X-Content-Type-Options = "nosniff"',
    '    Referrer-Policy = "no-referrer"',
    '',
    '[[headers]]',
    '  for = "/*.js"',
    '  [headers.values]',
    '    Cache-Control = "public, max-age=3600"',
    '',
    '[[headers]]',
    '  for = "/sw.js"',
    '  [headers.values]',
    '    Cache-Control = "no-cache"'
  ].join('\n'), 'utf8');

  // Vercel
  fs.writeFileSync(path.join(DIST, 'vercel.json'), JSON.stringify({
    version: 2,
    headers: [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] }
    ]
  }, null, 2), 'utf8');

  // Cloudflare Pages / Netlify 都认 _headers
  fs.writeFileSync(path.join(DIST, '_headers'), [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '/sw.js',
    '  Cache-Control: no-cache',
    '/app.js',
    '  Cache-Control: no-cache',
    '/styles.css',
    '  Cache-Control: no-cache',
    '/',
    '  Cache-Control: no-cache'
  ].join('\n'), 'utf8');

  // Cloudflare Pages 单页应用兜底（本项目是 hash 路由，其实用不上，保险起见）
  fs.writeFileSync(path.join(DIST, '_redirects'), '', 'utf8');

  // 搜索引擎
  fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');

  // ---------- 体积统计 ----------
  let bytes = 0;
  for (const name of fs.readdirSync(DIST)) bytes += fs.statSync(path.join(DIST, name)).size;
  const kb = (bytes / 1024).toFixed(1);

  console.log('\n✅ 静态包已生成：' + DIST);
  console.log('   文件：' + copied.join('、'));
  console.log('   额外写入：netlify.toml / vercel.json / _headers / _redirects / robots.txt');
  console.log('   总体积：' + kb + ' KB');
  console.log('\n说明：');
  console.log('   · 这是纯静态版：收集/知识库/思维导图 + 本地规则提炼 全部可用');
  console.log('   · 「读取链接」「云端 AI」需要后端，静态托管下会自动降级为本地模式');
  console.log('   · 数据存在浏览器 localStorage，换域名等于换一套数据（可导出/导入 JSON 迁移）');
  console.log('\n下一步：见 web/README.md，或直接把这个 dist 目录拖进任意静态托管。\n');
}

main();
