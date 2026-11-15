/**
 * 可移植性测试：确认「换一台机器」也能跑
 * 运行：node tests/portability.test.mjs
 *
 * 覆盖：
 *   - 部署产物里没有硬编码的 Windows 绝对路径
 *   - 抓取助手支持 Windows/macOS/Linux 浏览器
 *   - 助手/启动器路径基于文件位置（不依赖当前工作目录）
 *   - 桌面版本地服务能起、能代理 /api
 *   - 三平台启动脚本齐全
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'web', 'dist');
const HELPER = path.join(ROOT, 'integrations', 'xhs', 'xhs_helper.mjs');
const LAUNCH = path.join(ROOT, 'desktop', 'launch.mjs');
const SERVER = path.join(ROOT, 'desktop', 'server.mjs');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

(async () => {
  // 1) 部署产物无硬编码本地路径
  if (fs.existsSync(DIST)) {
    const textFiles = walk(DIST).filter((f) => /\.(html|js|css|json|webmanifest|txt|toml)$/.test(f));
    const bad = [];
    for (const f of textFiles) {
      const s = fs.readFileSync(f, 'utf8');
      if (/[A-Za-z]:\\\\/.test(s) || /C:\\\\Users/i.test(s) || /D:\\\\桌面/.test(s)) bad.push(path.relative(DIST, f));
    }
    ok('dist 无硬编码 Windows 路径', bad.length === 0, bad.join(',') || textFiles.length + ' 个文件');
  } else {
    ok('dist 存在', false, '先运行 node web/build.js');
  }

  // 2) 助手跨平台浏览器探测
  const helperSrc = fs.readFileSync(HELPER, 'utf8');
  ok('助手支持 Windows 浏览器', helperSrc.includes('Program Files') && helperSrc.includes('msedge.exe'));
  ok('助手支持 macOS 浏览器', helperSrc.includes('/Applications/Microsoft Edge.app'));
  ok('助手支持 Linux 浏览器', helperSrc.includes('/usr/bin/google-chrome'));
  ok('助手路径基于文件位置', helperSrc.includes('fileURLToPath(import.meta.url)') && !helperSrc.includes('process.cwd()'));

  // 3) 启动器路径不依赖 cwd
  const launchSrc = fs.readFileSync(LAUNCH, 'utf8');
  ok('桌面启动器路径基于文件位置', launchSrc.includes('fileURLToPath(import.meta.url)'));
  ok('三平台启动脚本齐全',
    fs.existsSync(path.join(ROOT, 'desktop', '知序.bat')) &&
    fs.existsSync(path.join(ROOT, 'desktop', 'zhixu.command')) &&
    fs.existsSync(path.join(ROOT, 'desktop', 'zhixu.sh')));

  // 4) 前端调用的是 loopback 助手
  const appSrc = fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8');
  ok('前端使用 127.0.0.1 助手地址', appSrc.includes("http://127.0.0.1:8790"));

  // 5) 桌面版本地服务 + /api 代理
  const PORT = 8799;
  const child = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, { ZHIXU_DESKTOP_PORT: String(PORT) }),
    stdio: 'ignore'
  });
  let up = false;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/__health');
      if (res.ok) { up = true; break; }
    } catch (e) { /* 还没起 */ }
  }
  ok('桌面版本地服务启动', up);

  if (up) {
    const home = await fetch('http://127.0.0.1:' + PORT + '/');
    const html = await home.text();
    ok('桌面版首页可访问', home.ok && html.includes('知序'));
    const js = await fetch('http://127.0.0.1:' + PORT + '/app.js');
    ok('静态资源可访问', js.ok);
    const api = await fetch('http://127.0.0.1:' + PORT + '/api/health');
    const apiJson = await api.json().catch(() => null);
    ok('桌面版 /api 代理正常', api.ok && apiJson && apiJson.ok, apiJson ? apiJson.mode : '');
  }
  try { child.kill(); } catch (e) { /* ignore */ }

  console.log('\n' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
