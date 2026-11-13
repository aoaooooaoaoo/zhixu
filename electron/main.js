/**
 * 知序 Electron 主进程
 * - 启动内嵌本地服务（dist + /api 代理）
 * - 打开应用窗口
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { startServer } = require('./app-server');

let win = null;
let server = null;
let helperChild = null;
const PORT = 8789;
const HELPER_PORT = 8790;

function helperAlive() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:' + HELPER_PORT + '/health', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function ensureHelper() {
  if (await helperAlive()) return;
  const helperPath = path.join(__dirname, 'helper', 'xhs_helper.mjs');
  if (!require('fs').existsSync(helperPath)) return;
  // Electron 可执行文件以 Node 模式跑脚本（与系统 node 行为一致）
  helperChild = spawn(process.execPath, [helperPath], {
    env: Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      XHS_PROFILE_DIR: path.join(app.getPath('userData'), 'xhs-profile')
    }),
    stdio: 'ignore'
  });
  helperChild.on('exit', () => { helperChild = null; });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: '知序',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#fbf6ee',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadURL('http://127.0.0.1:' + PORT);
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    server = await startServer({ port: PORT, dist: path.join(__dirname, 'dist') });
    await ensureHelper();
    createWindow();
  } catch (e) {
    console.error('启动失败：', e);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (helperChild) { try { helperChild.kill(); } catch (e) { /* ignore */ } }
  if (server) { try { server.close(); } catch (e) { /* ignore */ } }
  app.quit();
});
