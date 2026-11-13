#!/usr/bin/env node
/**
 * 知序小程序 · 上线预检（doctor）
 *
 * 用法：
 *   node scripts/doctor.js            # 人类可读报告
 *   node scripts/doctor.js --strict   # 有阻塞项时退出码 1（可用于 CI）
 *   node scripts/doctor.js --json     # 机器可读
 *
 * 只读检查，不修改任何文件。
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MP_ROOT = path.join(ROOT, 'miniprogram');
const CF_ROOT = path.join(ROOT, 'cloudfunctions');
const BUDGET_BYTES = 2 * 1024 * 1024; // 主包 2MB 上限

const issues = [];
function add(level, code, msg, hint) {
  issues.push({ level, code, msg, hint: hint || '' });
}
const pass = (code, msg) => issues.push({ level: 'pass', code, msg, hint: '' });
const warn = (code, msg, hint) => add('warn', code, msg, hint);
const fail = (code, msg, hint) => add('fail', code, msg, hint);

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/* ---------- 1. 关键文件 ---------- */
const MUST = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/app.wxss',
  'miniprogram/config.js',
  'miniprogram/sitemap.json',
  'miniprogram/utils/model.js',
  'miniprogram/utils/rules.js',
  'miniprogram/utils/merge.js',
  'miniprogram/utils/store.js',
  'miniprogram/utils/ai.js',
  'cloudfunctions/analyze/index.js',
  'cloudfunctions/resolve/index.js',
  'cloudfunctions/inbox/index.js'
];
const missing = MUST.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) fail('file.missing', '缺少关键文件：' + missing.join('、'));
else pass('file.missing', '关键文件齐全（' + MUST.length + ' 个）');

/* ---------- 2. JSON / JS 语法 ---------- */
const files = walk(ROOT).filter(f => !f.includes('node_modules'));
let jsonBad = 0;
let jsBad = 0;
for (const f of files) {
  if (f.endsWith('.json')) {
    try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {
      jsonBad++; fail('syntax.json', 'JSON 解析失败：' + path.relative(ROOT, f) + ' :: ' + e.message);
    }
  }
  if (f.endsWith('.js')) {
    const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) {
      jsBad++;
      fail('syntax.js', 'JS 语法错误：' + path.relative(ROOT, f) + ' :: ' + String(r.stderr || '').split('\n')[0]);
    }
  }
}
if (!jsonBad && !jsBad) pass('syntax', 'JSON/JS 语法全部通过（扫描 ' + files.length + ' 个文件）');

/* ---------- 3. WXML 标签配对 ---------- */
// WXML 里自闭合只有 `/>` 一种写法；`<canvas></canvas>` 这类是正常闭合标签，
// 不能因为它是内置组件就当成自闭合，否则会误报。
let wxmlBad = 0;
for (const f of files.filter(x => x.endsWith('.wxml'))) {
  const src = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const re = /<\/?([a-zA-Z-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  let bad = '';
  while ((m = re.exec(src))) {
    const full = m[0];
    const tag = m[1];
    const selfClosed = m[3] === '/';
    if (full.startsWith('</')) {
      const top = stack.pop();
      if (top !== tag) { bad = '期望 </' + top + '> 却是 </' + tag + '>'; break; }
    } else if (!selfClosed) {
      stack.push(tag);
    }
  }
  if (bad || stack.length) {
    wxmlBad++;
    fail('wxml', 'WXML 结构异常：' + path.relative(ROOT, f) + ' :: ' + (bad || ('未闭合 ' + stack.join(','))));
  }
}
if (!wxmlBad) pass('wxml', 'WXML 标签配对正常');

/* ---------- 4. 页面四件套 ---------- */
try {
  const app = JSON.parse(fs.readFileSync(path.join(MP_ROOT, 'app.json'), 'utf8'));
  const missPage = [];
  for (const p of app.pages || []) {
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
      if (!fs.existsSync(path.join(MP_ROOT, p + ext))) missPage.push(p + ext);
    }
  }
  if (missPage.length) fail('page.missing', '页面文件缺失：' + missPage.join('、'));
  else pass('page.missing', '页面四件套齐全（' + (app.pages || []).length + ' 个页面）');

  const tabPages = ((app.tabBar || {}).list || []).map(t => t.pagePath);
  const notInPages = tabPages.filter(p => (app.pages || []).indexOf(p) < 0);
  if (notInPages.length) fail('tabbar', 'tabBar 页面不在 pages 里：' + notInPages.join('、'));
  else pass('tabbar', 'tabBar 配置正常（' + tabPages.length + ' 个 tab）');
} catch (e) {
  fail('app.json', 'app.json 读不出来：' + e.message);
}

/* ---------- 5. AppID 状态 ---------- */
let appid = '';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
  appid = String(cfg.appid || '');
  if (!appid) fail('appid', 'project.config.json 没有 appid');
  else if (appid === 'touristappid') fail('appid', 'AppID 还是游客模式占位值 touristappid，无法上传/发布', '注册小程序后在公众平台「开发管理 → 开发设置」复制 AppID，然后运行：node scripts/setup.js --appid wx你的AppID');
  else if (!/^wx[0-9a-f]{16}$/i.test(appid)) warn('appid', 'AppID 格式看起来不像标准小程序 AppID：' + appid);
  else pass('appid', 'AppID 已填写：' + appid);
} catch (e) {
  fail('appid', 'project.config.json 解析失败：' + e.message);
}

/* ---------- 6. 云开发配置一致性 ---------- */
let cloudCfg = { env: '', useCloud: false };
try {
  const src = fs.readFileSync(path.join(MP_ROOT, 'config.js'), 'utf8');
  const envM = src.match(/CLOUD_ENV\s*:\s*['"]([^'"]*)['"]/);
  const useM = src.match(/USE_CLOUD\s*:\s*(true|false)/);
  cloudCfg.env = envM ? envM[1] : '';
  cloudCfg.useCloud = useM ? useM[1] === 'true' : false;

  if (cloudCfg.useCloud && !cloudCfg.env) {
    fail('cloud.config', 'USE_CLOUD 为 true 但 CLOUD_ENV 为空，运行时会初始化失败', 'node scripts/setup.js --env 你的环境ID');
  } else if (cloudCfg.useCloud && cloudCfg.env) {
    pass('cloud.config', '云开发已启用，环境：' + cloudCfg.env);
  } else {
    pass('cloud.config', '当前为纯本地模式（规则提炼 + 本地存储），可直接体验；要接真 AI 再运行 setup.js --env');
  }
} catch (e) {
  fail('cloud.config', 'config.js 读取失败：' + e.message);
}

/* ---------- 7. 云函数完整性 ---------- */
if (cloudCfg.useCloud) {
  const CF = ['analyze', 'resolve', 'inbox'];
  const cfIssues = [];
  for (const name of CF) {
    const dir = path.join(CF_ROOT, name);
    if (!fs.existsSync(path.join(dir, 'index.js'))) cfIssues.push(name + ' 缺 index.js');
    if (!fs.existsSync(path.join(dir, 'package.json'))) { cfIssues.push(name + ' 缺 package.json'); continue; }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (!pkg.dependencies || !pkg.dependencies['wx-server-sdk']) cfIssues.push(name + ' 没声明 wx-server-sdk');
    } catch (e) { cfIssues.push(name + ' package.json 解析失败'); }
  }
  if (cfIssues.length) fail('cloud.function', '云函数问题：' + cfIssues.join('；'));
  else pass('cloud.function', '云函数 analyze/resolve/inbox 结构完整');
  warn('cloud.timeout', '部署云函数后记得把 analyze 超时改成 60 秒（默认 3 秒模型来不及返回）', '云开发控制台 → 云函数 → analyze → 配置 → 超时时间');
} else {
  pass('cloud.function', '纯本地模式，暂不需要部署云函数（代码已就绪）');
}

/* ---------- 8. 包体积 ---------- */
let bytes = 0;
for (const f of walk(MP_ROOT)) bytes += fs.statSync(f).size;
const mb = bytes / 1024 / 1024;
if (mb > 2) fail('bundle.size', '主包 ' + mb.toFixed(2) + ' MB，超过 2MB 上限', '把图片/大文件放云存储或分包');
else if (mb > 1.5) warn('bundle.size', '主包 ' + mb.toFixed(2) + ' MB，接近 2MB 上限');
else pass('bundle.size', '主包体积 ' + mb.toFixed(2) + ' MB（上限 2MB）');

/* ---------- 9. 敏感文件 ---------- */
const leaks = files.filter(f => /(^|[\\/])\.env$|private\.wx[0-9a-f]+\.key$/i.test(f) && !f.includes('node_modules'));
if (leaks.length) fail('secret', '项目里混入了密钥/环境文件：' + leaks.map(f => path.relative(ROOT, f)).join('、'), '删除并改用云开发控制台的环境变量');
else pass('secret', '没有发现明文密钥文件');

/* ---------- 10. 依赖 ---------- */
const hasCi = (function () {
  try { require.resolve('miniprogram-ci', { paths: [ROOT] }); return true; } catch (e) { return false; }
})();
if (hasCi) pass('ci', 'miniprogram-ci 已就绪，可上传代码');
else warn('ci', '还没装 miniprogram-ci（上传/预览要用）', 'cd "' + ROOT + '"; npm i miniprogram-ci --no-save');

/* ---------- 输出 ---------- */
const order = { fail: 0, warn: 1, pass: 2 };
issues.sort((a, b) => order[a.level] - order[b.level]);
const counts = issues.reduce((acc, i) => { acc[i.level]++; return acc; }, { fail: 0, warn: 0, pass: 0 });

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ counts, issues, appid, cloud: cloudCfg, sizeMB: Number(mb.toFixed(2)) }, null, 2));
} else {
  const icon = { fail: '❌', warn: '⚠️ ', pass: '✅' };
  console.log('\n知序小程序 · 上线预检\n' + '='.repeat(52));
  for (const i of issues) {
    console.log(icon[i.level] + ' ' + i.msg);
    if (i.hint && i.level !== 'pass') console.log('     → ' + i.hint);
  }
  console.log('='.repeat(52));
  console.log('通过 ' + counts.pass + ' 项 / 警告 ' + counts.warn + ' 项 / 阻塞 ' + counts.fail + ' 项');
  if (counts.fail) {
    console.log('\n下一步：先解决上面 ❌ 的项，再跑一次 node scripts/doctor.js');
  } else if (counts.warn) {
    console.log('\n没有阻塞项了，按提示把 ⚠️ 的项处理掉即可提交审核。');
  } else {
    console.log('\n全部就绪，可以执行：node scripts/upload.js --version 1.0.0 --desc "首个版本"');
  }
  console.log('');
}

if (process.argv.includes('--strict') && counts.fail) process.exit(1);
