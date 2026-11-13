# 知序 · 链接分享与 QQ 接入

> 目标：把「在小红书/浏览器里看到的链接」不折腾地送进知序的收集框。
> 这里有三条路径，按「从简单到折腾」排序。

---

## 0. 先说结论：能不能“接管一个 QQ”？

**技术上可以，但我不建议、也不会代为接管你的 QQ 账号。**

- 可用的开源路线是 **OneBot 协议 + QQNT 第三方实现**（NapCat / Lagrange / LLOneBot 等）：在本地登录一个**新的 QQ 小号**，把收到的消息通过 WebSocket 交给一个桥程序。
- 我**不能**替你登录：需要你本人扫码/短信验证；我也没有你的账号密码，更不应该索取。
- 这类第三方协议**不符合腾讯官方客户端协议**，存在账号被限制/冻结/封禁的风险，**必须用小号**，不要用主号。
- 因此本项目提供的是**可选的本地桥**：你自己登录 QQ 小号，桥只负责把私聊里的链接 POST 到知序收件箱。不登录、不自动加好友、不自动发消息（除非你显式开启回执）。

如果你想用，请按下面第 3 节做；不接 QQ 也完全不影响知序的链接导入（第 1、2 节）。

---

## 1. 最简单：粘贴链接 + 「读取链接」

适用：电脑浏览器。

1. 启动 `server.py`；
2. 在收集页的「帖子链接」里粘贴 URL，点 **读取链接**；
3. 服务端会抓取页面的 `og:title/og:description` 和正文，填入文本框；
4. 你确认/修改后点「理成知识卡片」。

限制：

- 公开页面可读；小红书等需要登录/反爬的页面可能只拿到标题/简介，此时会提示「平台限制，请手动粘贴文字」，链接仍保留为来源；
- 服务端只接受 http/https，且会拒绝本机/内网地址（防 SSRF）；
- 抓取依赖目标网站，失败是常态，**正文永远可手改**。

接口：

```http
POST /api/resolve
{"url":"https://..."}
→ {"ok":true,"title":"...","description":"...","text":"...","blocked":false}
```

---

## 2. 手机分享：PWA Share Target（Android Chrome）

知序已经带 `manifest.webmanifest`，声明了：

```json
"share_target": {
  "action": "/share",
  "method": "GET",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

使用步骤：

1. 用 **Android Chrome** 打开 `http://<电脑局域网IP>:8788`（或部署到 HTTPS 后打开在线地址）；
2. 菜单 →「添加到主屏幕」/「安装应用」；
3. 在小红书里点分享 → 选择「知序」；
4. 知序会带着 `?url=...` 打开，自动读取链接并填入收集框。

注意：

- Share Target 需要 **HTTPS 或 localhost**，并且浏览器支持（Android Chrome 最稳；iOS Safari 不支持）；
- 局域网 IP 是 http，可能无法安装/分享；正式使用建议部署 HTTPS；
- 第一次安装后需要刷新/重开一次，Service Worker 才生效。

手动等价方式：任何能打开 URL 的地方，用 `http://127.0.0.1:8788/?url=<encoded>` 也能触发同一流程。

---

## 3. QQ 分享：小号 + OneBot 桥

### 3.1 选型

| 项目 | 作用 | 说明 |
|---|---|---|
| [NapCatQQ](https://github.com/NapNeko/NapCatQQ) | QQNT 的 OneBot 11 实现 | 目前最常用的本地 QQ 机器人底座；扫码登录 |
| [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) | 另一套 NTQQ 协议实现 | C#；可作为替代 |
| [OneBot 11](https://onebot.dev/) | 聊天机器人协议标准 | 桥只依赖这个协议，不绑定具体实现 |
| [NoneBot2](https://github.com/nonebot/nonebot2) | Python 机器人框架 | 想要更复杂插件/命令时使用；本项目没引入 |
| [dsh-qq-onebot-bridge](https://github.com/cheesehaqi/dsh-qq-onebot-bridge) | QQ ↔ Agent 的完整桥 | 功能很全（白名单/限流/风控/控制台），可参考或直接用；本项目只需要它的 1% |

参考 README 已下载到 `../../reference/qq/`。

### 3.2 准备

1. 注册一个**新的 QQ 小号**（不要用主号）；
2. Windows 安装 QQNT + NapCatQQ；
3. 用新号扫码登录 NapCat（WebUI 的「扫码登录」；二维码会过期，失败就刷新）；
4. 在 NapCat 的 OneBot 11 配置里开启 **WebSocket 服务器**，端口例如 `3001`，设置一个 `access_token`；
5. 启动知序：`cd app && D:\python\python.exe server.py`；
6. 可选：给知序设置收件箱 token（环境变量 `WJ_INBOX_TOKEN=...`），桥端用同一个值。

> 实战注意（2026-11）：
> - **安装路径用纯英文**（如 `D:\NapCat`），中文路径会让 QQ 子进程以 `v2:-8` 退出；
> - NapCat 启动需要**管理员权限**（UAC 点「是」），并建议设置 `NAPCAT_QQ_DATA_DIR` 隔离数据目录；
> - 如果桌面版 QQ 正在运行，先退出它（单实例/共享数据目录会冲突）。
> - 本机已安装到 `D:\NapCat`，可用 `D:\NapCat\start-zhixu-napcat.bat` 启动。

先跑一次只读环境检查：

```powershell
D:\python\python.exe integrations\qq\check_qq_env.py
```

它会列出：QQ 是否在运行（只看进程，不碰它）、NapCat 是否安装、OneBot 端口是否监听、Node 版本、知序是否启动。

### 3.3 启动桥

```powershell
cd "D:\桌面\教学agent\温酱\integrations\qq"

$env:QQ_WS_URL="ws://127.0.0.1:3001"
$env:QQ_ACCESS_TOKEN="你的 OneBot token"
$env:QQ_ALLOWED_USERS="你自己的主 QQ 号"   # 只允许你给机器人发链接
$env:ZHIXU_INBOX_URL="http://127.0.0.1:8788/api/inbox"
$env:ZHIXU_INBOX_TOKEN=""                 # 服务端没设就留空
$env:QQ_REPLY="1"                         # 收到后回一句，可选

node qq_bridge.mjs
```

桥做的事：

1. 连接本地 OneBot WebSocket；
2. 只处理**私聊**消息（避免群聊刷屏）；
3. 从文本里提取 `http(s)://` 链接；
4. POST 到知序 `/api/inbox`；
5. 网页顶栏的收件箱图标出现数字，点开 →「读取并归档」。

不连 QQ 也能先验证桥的提取/投递逻辑：

```powershell
node integrations\qq\test_bridge.mjs
# 期望：[PASS] qq_bridge: textOf / urlsOf / deliver / 去重 / token 头
```

### 3.4 手机上的完整路径

```
小红书 → 分享 → 复制链接 → 发给 QQ 小号（私聊）
        → 桥把链接投递到知序
        → 打开知序网页 → 收件箱 → 读取并归档
```

如果知序部署在另一台机器/公网，把 `ZHIXU_INBOX_URL` 改成对应地址，并注意不要暴露无鉴权的收件箱。

### 3.5 风险与边界（务必读）

- **账号风险**：第三方协议不是官方接口，可能被风控/封号；只用小号，降低频率，不要做群发/营销。
- **合规**：只处理你主动发来的链接；不抓取私密内容、不自动加好友、不自动建群。
- **安全**：OneBot 端口只监听 `127.0.0.1`；知序收件箱默认只绑定本机；如需远程，必须加 token/反代鉴权。
- **可靠性**：NapCat 升级/QQ 版本变化可能导致协议失效；桥会自动重连，但协议层坏了要更新 NapCat。
- **不做的**：不代替你登录、不保存 QQ 密码、不读取聊天记录以外的内容、不自动回复（除非 `QQ_REPLY=1`）。

---

## 4. 知序收件箱 API（给桥/自动化用）

```http
GET /api/inbox
→ {"ok":true,"items":[{"id":"...","url":"...","from":"QQ · 昵称","createdAt":"..."}]}

POST /api/inbox
Content-Type: application/json
X-Inbox-Token: <可选>
{"url":"https://...","from":"QQ · 昵称","title":"可选"}

DELETE /api/inbox?id=<id>
```

数据存在 `app/data/inbox.json`，只在本机；最多保留 100 条。网页每 8 秒拉一次。

---

## 5. 后续可以怎么升级

- **链接解析**：现在只抓公开网页；小红书正文抓取需要登录态，建议走「分享文字/剪贴板」而不是硬爬；
- **QQ 桥**：可换成 NoneBot2 / dsh-qq-onebot-bridge，获得白名单、限流、命令、回执等完整能力；
- **多端**：把收件箱搬到服务端数据库，手机/电脑共用；再加用户鉴权；
- **官方通道**：QQ 官方机器人 API 对个人开发者限制较多，且不支持读取普通私聊链接；本项目选择本地桥是权衡后的方案。

---

## 6. 新版行为（2026-11-14）：抓正文 → AI 提炼 → 回摘要卡

`qq_bridge.mjs` 不再只是「把链接丢进收件箱」，而是走完整链路：

1. `/api/resolve` 抓正文（公众号 / 豆瓣 / 普通网页可读；小红书、知乎等视页面开放程度，读不到会给明确提示）
2. `/api/analyze` 用星火模型提炼成卡片（标题 / 摘要 / 要点 / 标签 / 分类 / 主题 / **核心短语 core**）
3. 私聊里直接回一张摘要卡
4. 收件箱条目带上 `card` 字段；网页端点「读取并归档」直接进确认页，**不会二次调用 AI**

开关：

| 环境变量 | 作用 |
|---|---|
| `QQ_SUMMARY=0` | 退回只投递链接，不抓取不提炼 |
| `QQ_REPLY_FULL=1` | 回复时带上前 3 条要点（默认只回标题+摘要） |
| `ZHIXU_BASE` | 知序服务地址，默认 http://127.0.0.1:8788 |

前提：知序服务端能调用模型（`app/.env` 或环境变量 `WJ_LLM_*` / `RP_LLM_*`）。
