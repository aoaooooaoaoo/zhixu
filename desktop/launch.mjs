/**
 * 知序桌面版 · 启动器
 *
 * 1) 启动本地服务（desktop/server.mjs，端口 8789）
 * 2) 如未运行，自动拉起本地抓取助手（integrations/xhs/xhs_helper.mjs）
 * 3) 用系统 Edge/Chrome 的「应用窗口」打开 http://127.0.0.1:8789
 *
 * 运行：node desktop/launch.mjs
 * 环境变量：
 *   ZHIXU_DESKTOP_PORT  桌面版端口（默认 8789）
 *   ZHIXU_NO_HELPER=1   不自动启动抓取助手
 *   ZHIXU_BROWSER       指定浏览器可执行文件路径
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.ZHIXU_DESKTOP_PORT || 8789);
const URL_BASE = 'http://127.0.0.1:' + PORT;
const PROFILE = path.join(HERE, '.profile');

const BROWSERS = [
  process.env.ZHIXU_BROWSER,
  process.env.XHS_EDGE_PATH,
  // Windows
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // macOS
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Linux
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

function findBrowser() {
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  return '';
}

async function waitHealth(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const children = [];

function cleanup() {
  for (const c of children) {
    try { c.kill(); } catch (e) { /* ignore */ }
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

(async () => {
  console.log('');
  console.log('  知序 · 桌面版');
  console.log('  ─────────────────────────────');

  // 1) 本地服务
  let serverUp = false;
  try {
    const res = await fetch(URL_BASE + '/__health');
    serverUp = res.ok;
  } catch (e) { serverUp = false; }

  if (!serverUp) {
    const server = spawn(process.execPath, [path.join(HERE, 'server.mjs')], { stdio: 'inherit' });
    children.push(server);
    if (!(await waitHealth(URL_BASE + '/__health', 15000))) {
      console.error('[desktop] 本地服务启动失败');
      cleanup();
      process.exit(1);
    }
  }
  console.log('[desktop] 本地服务就绪：' + URL_BASE);

  // 2) 抓取助手（可选）
  if (process.env.ZHIXU_NO_HELPER !== '1') {
    let helperUp = false;
    try {
      const res = await fetch('http://127.0.0.1:8790/health');
      helperUp = res.ok;
    } catch (e) { helperUp = false; }
    if (!helperUp) {
      console.log('[desktop] 启动本地抓取助手…');
      const helper = spawn(process.execPath, [path.join(ROOT, 'integrations', 'xhs', 'xhs_helper.mjs')], { stdio: 'ignore' });
      children.push(helper);
    } else {
      console.log('[desktop] 抓取助手已在运行');
    }
  }

  // 3) 应用窗口
  const browser = findBrowser();
  if (!browser) {
    console.error('[desktop] 找不到 Edge/Chrome，请设置 ZHIXU_BROWSER 指向浏览器可执行文件');
    console.log('[desktop] 你仍可手动打开：' + URL_BASE);
    return;
  }
  fs.mkdirSync(PROFILE, { recursive: true });
  console.log('[desktop] 打开应用窗口（' + path.basename(browser) + '）…');
  const win = spawn(browser, [
    '--app=' + URL_BASE,
    '--user-data-dir=' + PROFILE,
    '--window-size=1280,860',
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check'
  ], { stdio: 'ignore' });
  children.push(win);

  win.on('exit', () => {
    console.log('[desktop] 窗口已关闭，退出。');
    cleanup();
    process.exit(0);
  });
})();
