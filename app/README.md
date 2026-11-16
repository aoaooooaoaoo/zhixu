# 知序 MVP · 网页原型

> 把小红书里刷到的好内容，理成带来源的知识卡片，并长成一棵可互动的知识树。

## 快速开始

### 方式 A：直接打开（本地演示）

双击 `index.html`，或在浏览器打开它。

- 不需要安装、不需要联网、不需要 key；
- 使用**本地规则**提炼卡片（关键词分类 + 抽取式摘要）；
- 数据保存在浏览器 `localStorage`，可在「设置 → 导出」备份。

也可以直接打开 `../docs/知序MVP-单页版.html`（CSS/JS/图标全部内联，单文件可分享）。

### 方式 B：启动本地服务（推荐，可接真 AI）

```powershell
cd "D:\桌面\教学agent\温酱\app"
D:\python\python.exe server.py
```

然后打开 <http://127.0.0.1:8788>。

服务会读取以下任一处的 key（不会写进前端）：

1. 环境变量 `WJ_LLM_API_KEY` / `WJ_LLM_BASE_URL` / `WJ_LLM_MODEL`
2. 本目录 `.env`（键名同上）
3. 复用 `核反应堆物理agent/apps/api/.env` 里的 `RP_LLM_*`（只读）

未配置 key 时，页面自动退回本地演示；配置成功后顶栏会显示「AI 已连接」。

## 三个页面

| 页面 | 做什么 |
|---|---|
| **01 收集** | 粘贴文字 / 粘贴链接读取 / 手机分享 / QQ 收件箱 → AI 提炼标题/摘要/要点/标签/来源 → 人工确认 → 保存 |
| **02 知识库** | 分类（大点）→ 主题（小点）→ 卡片；搜索、筛选、删除、导入/导出 |
| **03 思维导图** | 选知识大点/主题 → 生成可交互导图；相似卡片自动合并；点合并节点看来源、差异、合并原因；导出 SVG |

## 分享链接怎么进来

1. **电脑**：把链接粘到「帖子链接」，点 **读取链接**（需要 `server.py`）；
2. **浏览器扩展**：在已登录的小红书页面点「发送到知序」，正文直接进收件箱（见 [`../integrations/browser-extension/README.md`](../integrations/browser-extension/README.md)）；
3. **手机 PWA**：Android Chrome 安装后，从小红书分享给「知序」（`/share?url=...`）；
4. **QQ**：用新 QQ 小号 + NapCat/OneBot，运行 `../integrations/qq/qq_bridge.mjs`，私聊链接会自动进「分享收件箱」。
   - 风险/步骤见 [`../integrations/qq/README.md`](../integrations/qq/README.md)；
   - 小红书登录墙页面读不到正文时会提示手动粘贴，原链接保留为来源。

## 文件结构

```
app/
├── index.html          # 页面骨架
├── styles.css          # 设计系统（奶油纸张 + 陶土橙）
├── app.js              # 状态、AI 解析、链接读取、收件箱、导图渲染
├── server.py           # 静态服务 + 可选 AI/链接读取/收件箱 API（Python 标准库）
├── manifest.webmanifest# PWA，含 Android Share Target
├── sw.js               # Service Worker（离线壳 + 分享目标）
├── icon-192/512.png    # PWA 图标
└── README.md
```

- 零构建、零 npm 依赖：`index.html` 用普通 `<script>` 引入 `app.js`，可直接 `file://` 打开。
- 导图用原生 SVG：树布局、贝塞尔连线、拖拽平移、滚轮缩放、折叠、导出。
- 本地存储 key：`zhixu.mvp.v1`（首次会从旧 `wenjiang.mvp.v1` 迁移一次）。

## 数据与隐私

- 默认所有数据只存在当前浏览器；「设置 → 导出/导入」可搬家。
- 真 AI 模式下，粘贴的文本会发送到所配置的模型服务（星火）；不会保存到其他服务器。
- 「读取链接」由本地 `server.py` 抓取目标公开网页；链接不会上传到第三方服务（除非目标站点本身要求）。
- QQ 桥、收件箱都只在本机运行；收件箱文件在 `app/data/inbox.json`。
- 卡片保留来源字段；不保存整页 HTML、不抓取私密内容。

## 已知限制

- 小红书等需要登录/反爬的页面，直接读取正文会失败；会提示手动粘贴，原链接保留；
- PWA 分享目标需要 Android Chrome + HTTPS/localhost，iOS 不支持；
- QQ 桥依赖第三方协议（NapCat/OneBot），有账号风控风险，只能用小号；
- 本地规则模式的分词/分类是轻量启发式，复杂内容建议开真 AI；
- 合并阈值基于字符相似度 + 主题加成，适合演示；生产版会换 embedding + LLM 判断；
- 单用户、无登录、无云同步；
- 移动端是响应式网页 + PWA，未做独立 App。

## 截图

`../docs/shots/`：`home.png`、`library.png`、`map.png`、`share-link.png`、`inbox.png`、`mobile-500.png`。

## 相关文档

- 产品方案：[`../docs/01-产品方案.md`](../docs/01-产品方案.md)
- GitHub 同类项目调研：[`../docs/02-GitHub同类项目调研.md`](../docs/02-GitHub同类项目调研.md)
- 链接分享与 QQ 接入：[`../docs/03-链接分享与QQ接入.md`](../docs/03-链接分享与QQ接入.md)
- 浏览器采集插件：[`../docs/06-浏览器采集插件.md`](../docs/06-浏览器采集插件.md)
- 原始策划案：`../MVP使用(1).docx`（未改动）
