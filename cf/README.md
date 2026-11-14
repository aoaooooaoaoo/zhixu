# 知序 · Cloudflare Pages 部署

把知序（静态站 + `/api/*` 函数）部署到 Cloudflare Pages，免费额度对部署次数友好（500 次构建/月、预览部署不限），无需备案即可用 `*.pages.dev` 域名。

## 目录结构

```
cf/
├─ functions/api/       Pages Functions（ESM，onRequest）
│   ├─ health.js        健康检查
│   ├─ resolve.js       链接读取
│   ├─ analyze.js       AI 提炼
│   ├─ ask.js           知识库问答
│   ├─ auth.js          账号（需要 KV）
│   └─ sync.js          云同步（需要 KV）
├─ lib/                 共享库（extract / llm / crypto / http）
├─ prepare.mjs          复制 web/dist → cf/dist 并写 _routes.json
├─ wrangler.toml
└─ .dev.vars            本地开发变量（已 gitignore）
```

## 本地验证（不需要账号）

```powershell
cd cf
npm install
npm run dev        # http://127.0.0.1:8788
```

`--kv ZHIXU_KV` 会建本地 KV，所以账号/云同步也能本地测。

测试：

```powershell
node tests/cf.test.mjs     # 12 项：健康/首页/resolve/analyze/ask/注册/绑定QQ/同步
```

## 上线步骤（需要你自己的 Cloudflare 账号，免费）

1. 注册并登录 <https://dash.cloudflare.com/sign-up>

2. 命令行登录（会弹浏览器授权）：

```powershell
cd cf
npx wrangler login
```

3. 创建 KV（账号/云同步需要）：

```powershell
npx wrangler kv namespace create ZHIXU_KV
```

把输出的 `id` 填进 `wrangler.toml` 的 `[[kv_namespaces]]`。

4. 配置模型 key（密钥，不写进代码）：

```powershell
npx wrangler pages secret put WJ_LLM_API_KEY --project-name zhixu
# 可选：
npx wrangler pages secret put WJ_LLM_MODEL --project-name zhixu
npx wrangler pages secret put WJ_LLM_BASE_URL --project-name zhixu
npx wrangler pages secret put WJ_LLM_EXTRA_BODY --project-name zhixu
```

5. 部署：

```powershell
npm run deploy
```

首次部署会创建项目，输出形如 `https://zhixu.pages.dev`。

6. 验证：

```
https://zhixu.pages.dev/api/health      → {"ok":true,"mode":"spark",...}
https://zhixu.pages.dev/                → 知序首页
```

## 与 Netlify 版的差异

| 能力 | Netlify 版 | Cloudflare 版 |
|---|---|---|
| 静态托管 | ✅ | ✅（不限部署次数，500 构建/月） |
| 链接读取 / AI 提炼 / 问答 | ✅ | ✅（逻辑一致） |
| 账号 + 云同步 | Netlify Blobs | **Cloudflare KV**（需绑定） |
| 部署凭据 | 部署 token | 本地 `wrangler login` |
| 自定义域名 | 需要 DNS | 免费子域名 + 可绑自有域名 |

## 注意

- 免费版 Functions 每天 10 万请求，个人用足够
- KV 免费额度：10 万次读/天、1000 次写/天，账号+同步够用
- `.dev.vars` 里有 key，**不要提交**
- 环境变量（`[vars]`）只放非敏感值；key 用 `pages secret put`
