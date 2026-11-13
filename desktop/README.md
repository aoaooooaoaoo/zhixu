# 知序 · 桌面版（电脑端软件）

零依赖的轻量桌面壳：本地服务 + AI 代理 + 系统浏览器应用窗口，Windows / macOS / Linux 通用。

## 启动

| 系统 | 方式 |
|---|---|
| Windows | 双击 `desktop\知序.bat` |
| macOS | 双击 `desktop/zhixu.command`（首次：`chmod +x desktop/zhixu.command`） |
| Linux | `chmod +x desktop/zhixu.sh && ./desktop/zhixu.sh` |

或命令行：

```powershell
node desktop/launch.mjs
```

## 它做了什么

```
双击启动
  ├─ 本地服务 desktop/server.mjs   → http://127.0.0.1:8789（托管 web/dist）
  ├─ 自动拉起抓取助手（未运行时）  → http://127.0.0.1:8790（小红书/知乎等登录抓取）
  └─ 打开应用窗口（Edge/Chrome --app，独立 user-data-dir）
```

- **AI 仍可用**：本地服务把 `/api/*` 反向代理到线上 Functions（默认 `https://zhixu-note.netlify.app`）
- **数据独立**：桌面版 origin 是 `127.0.0.1:8789`，localStorage 与网页版互不影响
  - 需要迁移：网页版「设置 → 导出 JSON」→ 桌面版「设置 → 导入」
- **窗口独立**：`desktop/.profile` 是专用浏览器配置，不碰你日常浏览器的登录态

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `ZHIXU_DESKTOP_PORT` | 8789 | 桌面版端口 |
| `ZHIXU_API_ORIGIN` | `https://zhixu-note.netlify.app` | `/api` 代理目标 |
| `ZHIXU_NO_HELPER` | — | 设为 1 则不自动启动抓取助手 |
| `ZHIXU_BROWSER` | 自动探测 | 指定浏览器可执行文件 |

## 前置

- Node.js 22+
- 已构建静态包：`node web/build.js --clean`（或直接使用仓库里的 `web/dist`）
- 首次使用小红书/知乎抓取：助手窗口里登录一次

## 已知限制

- 桌面版是「浏览器应用窗口 + 本地服务」的轻量方案，不是安装包；卸载 = 删目录
- 关闭窗口后本地服务会随启动器退出；浏览器窗口若残留可手动关闭
- 需要安装包/自动更新时，可再包一层 Electron 或 Tauri（当前未做）


## 本地函数（离线可用）

桌面版会把 `/api/auth`、`/api/sync` 交给本地函数处理（`web/functions/*.js`），其余 `/api/*` 仍代理线上。

启动示例：

```powershell
$env:ZHIXU_DESKTOP_PORT='8799'
$env:NETLIFY_BLOBS_TOKEN='<netlify token>'
$env:NETLIFY_BLOBS_SITE_ID='<site id>'
node desktop/server.mjs
```

- 不设 Blobs 凭据时，账号/云同步会返回「账号存储不可用」，其余功能正常
- 测试：`node tests/auth.test.mjs`（默认打 8799）
