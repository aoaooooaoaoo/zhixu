# 知序 · 多平台登录抓取助手

本地小服务：用一个**独立的浏览器登录态**抓取需要登录/反爬的页面，供知序网页调用。

支持：**小红书 / 知乎 / 微博 / 抖音 / B站 / 通用网页**。

> 思路来自成熟开源项目（[MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)、[xiaohongshu-mcp](https://github.com/liaogx/xiaohongshu-mcp)、[xhs-mcp-tool](https://pypi.org/project/xhs-mcp-tool/)）：它们都用「持久化浏览器上下文 + 扫码登录」来拿需要登录的内容。
> 本实现不引入 Playwright / 不 fork 项目，直接用**系统 Edge + CDP**（Node 22 内置 WebSocket），零依赖。

## 启动

```powershell
cd "D:\桌面\教学agent\温酱"
node integrations/xhs/xhs_helper.mjs
```

或双击 `integrations/xhs/start-xhs-helper.bat`。

首次启动会弹出一个**独立的 Edge 窗口**（配置目录 `integrations/xhs/.profile`，和日常浏览器隔离）：

- 公开内容大多不登录也能读（小红书笔记页、知乎回答、B站视频页）
- 需要登录的内容（小红书搜索、部分知乎/微博内容）：在弹窗里登录一次，之后不用重复

## 知序网页怎么用

1. 保持助手窗口开着（服务地址 `http://127.0.0.1:8790`）
2. 打开 <https://zhixu-note.netlify.app> → 收集页
3. 粘贴链接 → 点「读取链接」
4. 状态会显示「已用登录窗口读取：标题 · @作者」，正文自动填入

网页上的「**登录窗口**」按钮会按当前链接的站点打开对应的登录页。

## 支持情况（实测）

| 站点 | 不回登录 | 说明 |
|---|---|---|
| 小红书笔记 | ✅ | 标题/正文/作者/标签（约 750 字） |
| 知乎问题/回答 | ✅ | 首个回答正文（约 3000 字） |
| B 站视频 | ✅ | 标题/UP 主（简介较短） |
| 通用网页 | ✅ | og/meta + 正文 |
| 微博 / 抖音 | 需登录 | 点「登录窗口」登录后再读 |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{ok, browser, port, profile, sites}` |
| POST | `/login` `{site}` | 打开对应站点登录页（site: xiaohongshu/zhihu/weibo/douyin/bilibili） |
| POST | `/resolve` `{url}` | 打开该 URL，提取标题/正文/作者/标签/图片 |

返回示例：

```json
{
  "ok": true, "blocked": false, "site": "知乎",
  "title": "如何正确使用知乎？",
  "author": "知乎用户",
  "tags": ["...", "..."],
  "text": "标题\n正文…",
  "url": "https://www.zhihu.com/question/..."
}
```

## 安全与边界

- 只监听 `127.0.0.1`，不对外网开放；网页通过 `http://127.0.0.1:8790` 访问（浏览器把 loopback 视为可信来源，HTTPS 页面也能调）
- `.profile/` 里是各站点登录 cookie：**不要分享、不要提交仓库**（已在 `.gitignore` 忽略）
- 只用于整理你自己账号能看到的内容；**不要高频批量抓取**，避免账号风控
- 关闭助手：Ctrl+C；浏览器窗口可以留着（下次启动复用登录态）
- **只在运行助手的这台电脑生效**：手机上打开知序访问不到 127.0.0.1，会回退到服务端/手动粘贴

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `XHS_HELPER_PORT` | 8790 | 本地 HTTP 端口 |
| `XHS_CDP_PORT` | 9333 | Edge 调试端口 |
| `XHS_EDGE_PATH` | 自动探测 | Edge/Chrome 路径 |
| `XHS_PROFILE_DIR` | `.profile` | 登录态目录 |


---

## 搜索结果批量导入（2026-11-14）

助手新增 `POST /search`，配合知序网页的「批量导入」：

```
POST /search { "site": "xiaohongshu" | "zhihu", "keyword": "西安交通大学", "limit": 10, "sort": "default|popular|latest" }
→ { ok, ready, items: [{ url, title, author, likes, noteId, hasToken }] }
```

要点（踩坑记录）：

1. **必须保留 `xsec_token`**：搜索结果卡片里真正可用的是 `a.cover` 的 `href=/search_result/<id>?xsec_token=...`。
   只拿 `/explore/<id>` 去打开会撞 **300031 安全限制**（参考 [xiaohongshu-search](https://github.com/excalibursssooo/xiaohongshu-search)）。
   助手会把链接规整成 `/explore/<id>?xsec_token=...&xsec_source=pc_search`。
2. **不能只看卡片数量判断加载完成**：首页推荐流也是同样的 `section.note-item` DOM。必须等搜索框里的值等于关键词，并且卡片标题出现关键词相关词。
3. **滚动会回收 DOM**：列表是虚拟滚动，滚一下标题会短暂变空。做法是「边滚边累积 + 按 noteId 合并」，而不是滚完再取一次快照。
4. **排序参数**：小红书 `sort=popularity_descending`（最热）/ `time_descending`（最新）。

网页端流程：批量导入 → 选站点/关键词/排序/条数 → 搜索 → 勾选 → 「导入选中」→ 逐条抓正文 → AI 提炼 → 存入知识库（卡片带 core 核心短语）。

> 注意：网页标签页必须在前台（Chrome 会节流后台标签页的请求与定时器）。


## 评论采集（2026-11-14）

助手新增 `POST /comments`：

```
POST /comments { "url": "小红书笔记链接", "limit": 10 }
→ { ok, total, items: [{ author, text, date, likes, isAuthor }] }
```

- 打开笔记页 → 滚动加载评论（页面 + 笔记滚动容器）→ 提取 `.comment-item`
- 按点赞数降序，去重（作者+内容），最多返回 30 条
- 网页端「抓评论」→ 弹窗预览 → 「并入正文」把评论拼到原文后面再交给 AI
- MCP 工具：`zhixu_comments`
