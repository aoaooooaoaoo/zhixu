# 知序网页版 · 部署与能力说明

## 线上地址

**https://zhixu-note.netlify.app**

- 托管：Netlify（免费版）
- 项目后台：https://app.netlify.com/projects/zhixu-note
- 状态：Public（任何人可访问）
- 后端：Netlify Functions（`functions/`），负责链接读取与可选 AI

## 目录说明

| 文件 | 作用 |
|---|---|
| `build.js` | 从 `../app` 打包出纯静态站点到 `dist/` |
| `dist/` | 静态产物（本工具生成，可删可重建） |
| `functions/` | Netlify Functions：`resolve.js`（读链接）、`health.js`（能力探测）、`analyze.js`（AI，可选） |
| `netlify.toml` | 发布目录、函数目录、`/api/*` 重定向 |
| `deploy-web.js` | 用 Netlify API + Token 部署（纯静态，不含函数） |
| `zhixu-web.zip` | Drop 用压缩包（纯静态） |

## 链接读取：支持哪些、不支持哪些

前端会把链接自动识别成下面几类，**不再一律尝试抓取**：

| 类型 | 能力 | 说明 |
|---|---|---|
| 微信公众号 | ✅ 自动读取 | 从 `#js_content` 提取正文 |
| 豆瓣 | ✅ 自动读取 | 日记 / 书影评正文 |
| 简书 | ✅ 自动读取 | 文章正文 |
| B 站 | ✅ 自动读取 | 标题与视频简介 |
| 掘金 | ✅ 自动读取 | 技术文章正文 |
| CSDN | ✅ 自动读取 | 多数可读，偶发反爬 |
| 少数派 / 36 氪 | ✅ 自动读取 | 文章 / 资讯正文 |
| GitHub | ✅ 自动读取 | README / Issue |
| 普通网页 | ✅ 自动读取 | og/meta + 正文提取 |
| 小红书 | ✋ 手动粘贴 | 登录墙 + 反爬；链接仍保存为来源 |
| 知乎 | ✋ 手动粘贴 | 未登录常读不到 |
| 微博 | ✋ 手动粘贴 | 需登录 |
| 抖音 | ✋ 手动粘贴 | 视频页文字极少 |

> 结论：**「从链接分析」对公众号、博客、资讯、技术站是真正可用的**；小红书这类强反爬站点，产品层面就走「手动粘贴 + 链接留作来源」，不再伪装成能自动读。

## 部署（含云函数）

纯静态拖拽（Drop）**不含函数**；带后端要用 CLI：

```powershell
cd "D:\桌面\教学agent\温酱\web"
node build.js --clean

$env:NETLIFY_AUTH_TOKEN = "你的 Netlify Token"
$env:npm_config_registry = "https://registry.npmmirror.com"   # 国内网络建议
npx --yes netlify-cli@latest deploy --prod --dir=dist --functions=functions `
  --site=3914eab9-2d8f-4ac6-bbcd-fa1e4cfc498f `
  --message "update"
```

- Token：Netlify → User settings → Applications → Personal access tokens
- 站点 ID 见项目 API 或 `netlify sites:list`

## 可选：开启真 AI

1. Netlify → Site configuration → Environment variables 添加：
   - `WJ_LLM_API_KEY`（必填）
   - `WJ_LLM_BASE_URL` / `WJ_LLM_MODEL`（选填）
2. 重新部署（或 Functions → 重新发布）
3. 刷新页面，顶栏会变成「AI 已连接」

> 没配 key 时 `analyze` 返回 503，前端自动退回本地规则，功能不受影响。

## 本地开发

```powershell
# 只跑静态
cd "D:\桌面\教学agent\温酱\web"; npx serve dist

# 带函数（需要 netlify-cli）
npx netlify-cli dev --dir=dist --functions=functions
```

## 更新流程（改完代码）

```powershell
cd "D:\桌面\教学agent\温酱\web"
node build.js --clean
# 重新部署（上面两条命令）
```

## 数据说明

- 数据存浏览器 `localStorage`，按域名隔离
- 换域名 = 一套新数据；旧站「设置 → 导出」→ 新站「设置 → 导入」
- 手机首次打开建议「添加到主屏幕」，PWA manifest 已配置

---

## 更新记录

### 2026-11-14 · 核心短语 + 星火 AI + QQ 摘要

- **AI 已接通**：站点环境变量注入星火（`WJ_LLM_API_KEY` / `BASE_URL` / `MODEL`），`/api/health` 返回 `mode:spark`，顶栏显示「AI 已连接」
- **卡片新增 `core` 字段**：AI 提炼时同时产出「不超过 10 字的核心短语」，思维导图节点用它做标签（老卡片自动从标题回退提炼），合并节点显示「共同标签 ×N」
- **链接读取策略调整**：小红书 / 知乎 / 微博 / 抖音不再直接拒绝，而是**先尝试读取**，读不到才提示手动粘贴
- **QQ 转发**：见 `../integrations/qq/README.md` 第 6 节，现在会「抓正文 → AI 提炼 → 回摘要卡 → 收件箱带 card 字段」

## 环境变量（Netlify → Site configuration）

```
WJ_LLM_API_KEY=你的星火 key
WJ_LLM_BASE_URL=https://maas-api.cn-huabei-1.xf-yun.com/v2
WJ_LLM_MODEL=spark-x2.6-4b
WJ_LLM_EXTRA_BODY={"thinking":{"type":"disabled"}}
```


### 2026-11-14 · 评论采集 + 知识库问答

- **评论采集**：收集页「抓评论」→ 抓取小红书笔记评论（按赞排序）→ 可「并入正文」让 AI 一起提炼；MCP 工具 `zhixu_comments`
- **知识库问答**：知识库页「问知识库」→ 选相关卡片（二元组匹配，最多 6 张）→ `/api/ask` 基于卡片回答并标注引用；找不到会直说
- 新增函数：`functions/ask.js`
- 测试：`tests/integration.test.mjs` 17 项、`tests/mcp.test.mjs` 17 项全过


### 2026-11-14 · 云同步（Netlify Blobs）

- 知识库页「云同步」→ 输入同步码 → 上传/合并
- 接口：`POST /api/sync`：
  - `{action:'push', code, data:{version, cards, settings}}` → `{ok, updatedAt, count}`
  - `{action:'pull', code}` → `{ok, data|null}`
- 存储：Netlify Blobs（store `zhixu-sync`），key = `sha256(同步码)` 前 32 位
- 凭据：函数通过环境变量 `NETLIFY_BLOBS_TOKEN` + `NETLIFY_BLOBS_SITE_ID` 显式配置（CLI 部署时 Blobs 不会自动注入）
- 依赖：`web/package.json` 里声明 `@netlify/blobs`
- 安全边界：知道同步码的人可读写该份数据；同步码至少 8 位，建议长随机串

启动器说明：页面的「合并」按卡片 id 去重，只补本地没有的，不删本地。


### 2026-11-14 · 账号体系 + QQ 绑定（替代同步码）

- `/api/auth`：register / login / me / bind-qq / logout
  - 密码 scrypt + 随机盐；会话 token 32 字节随机，服务端只存 SHA-256，30 天有效
  - 账号里可绑定「接收 QQ 号」（5-12 位数字），供 QQ 桥一对一转发
- `/api/sync` 改为**账号制**：`{action:'push'|'pull', token, data}`，数据按账号隔离（key = data-<sha256(用户名)>）
- 前端：顶栏账号按钮 → 登录/注册/绑定 QQ；知识库「云同步」按钮 → 上传/合并（未登录会引导登录）
- 测试：`node tests/auth.test.mjs`（14 项，打本地桌面服务）

> ⚠️ 部署状态：Netlify 账号额度超限（Account credit usage exceeded），新部署暂时被拒绝。
> 本地桌面版已内嵌 auth/sync 函数（`desktop/server.mjs` 只把 auth/sync 走本地，其余仍代理线上），因此账号功能现在在**桌面版可用**；线上要等额度恢复或换托管。
