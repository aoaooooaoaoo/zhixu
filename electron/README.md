# 知序 · Electron 桌面版（安装包）

把网页版打包成 Windows 可执行程序，双击即用，**不依赖系统浏览器**。

## 产物

`release/` 目录：

| 文件 | 说明 |
|---|---|
| `Zhixu-portable-1.0.0.exe` | **便携版**（约 71 MB），双击即运行，无需安装 |
| `win-unpacked/知序.exe` | 解包版（约 180 MB），整个目录拷走即可用 |

启动脚本：`启动知序.bat`（会先清掉 `ELECTRON_RUN_AS_NODE` 再启动，避免被某些开发环境干扰）

## 构建

```powershell
cd electron
$env:npm_config_registry='https://registry.npmmirror.com'
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run build        # 便携版
# npm run build:dir  # 只要解包目录（更快）
```

构建前会自动把 `web/dist` 复制到 `electron/dist`。

## 它做了什么

- 主进程内嵌一个本地 HTTP 服务（端口 8789），托管打包进去的 `dist`
- `/api/*` 反向代理到线上 Functions（AI 提炼、问答、云同步都能用）
- 打开一个 1280×860 的独立窗口，无浏览器地址栏

## 已验证

- 解包版 `知序.exe` 启动成功：窗口标题「知序 · 把刷到的碎片，理成自己的知识」，`/__health` 返回 `mode=electron`
- 便携版 `Zhixu-portable-1.0.0.exe` 启动成功（首次解压约 20–30 秒）
- 冒烟测试后已结束测试进程

## 已知限制

- 未做代码签名：Windows SmartScreen 可能提示「未知发布者」，选「仍要运行」
- 默认 Electron 图标（未放自定义 icon）
- 抓取助手（小红书/知乎登录抓取）仍需要单独运行 `integrations/xhs/xhs_helper.mjs`，Electron 壳不自动启动它
- 想要安装程序（开始菜单/快捷方式）可把 target 改成 `nsis`；当前为便携版


## 更新（2026-11-14）

- **自动拉起抓取助手**：启动时检测 8790，未运行则用 Electron 自带 Node 模式拉起 `helper/xhs_helper.mjs`，
  登录态存到 `%APPDATA%/zhixu-desktop/xhs-profile`（已验证：窗口起来后 8790 自动可用）
- **自定义图标**：`build/icon.ico`（由 `app/icon-512.png` 生成）
  - 解包版 exe 用 rcedit 写入图标（已验证 rcedit exit=0）
  - 便携版 exe 的图标需要 electron-builder 内嵌，但本机缺 symlink 权限导致 winCodeSign 解压失败，
    因此便携版仍是默认 Electron 图标；**不要在打包后用 rcedit 处理便携版**（会截断文件，需重新打包）
- 打包产物已重建：`release/Zhixu-portable-1.0.0.exe`（70.8 MB）、`release/win-unpacked/知序.exe`
