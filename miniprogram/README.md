# 知序 · 微信小程序（原生 + 云开发）

这是网页版 `../app/` 的原生小程序重写版：同样三个页面（收集 / 知识库 / 思维导图），
数据模型、本地规则提炼、相似度合并、导图树布局都按网页版 1:1 移植，**导入导出 JSON 可互通**。

## 先看这两个文件

- 部署 / 备案 / 审核全流程：[`部署指南.md`](./部署指南.md)
- 部署时唯一要改的配置：[`miniprogram/config.js`](./miniprogram/config.js)

## 本地跑起来

1. 微信开发者工具 → 导入项目 → 选这个 `miniprogram` 目录
2. AppID 先填 `touristappid`（游客模式）也能看界面
3. 不配云开发时是**纯本地模式**：规则提炼 + 本地存储，功能完整可用
4. 要接真 AI：开通云开发 → 填 `config.js` 里的 `CLOUD_ENV` → `USE_CLOUD: true` → 部署 `cloudfunctions/*`

## 目录

```
miniprogram/
├── project.config.json     # appid / 目录结构
├── 上线工具.md             # ★ 预检/填配置/上传/预览 怎么用
├── 部署指南.md             # 注册→备案→审核→发布 全流程
├── 审核材料包.md           # ★ 后台要填的文字，直接复制
├── scripts/
│   ├── doctor.js           # 上线预检（10 类问题）
│   ├── setup.js            # 一键写 AppID / 云环境（自动备份）
│   └── upload.js           # miniprogram-ci 上传 / 生成预览码
├── cloudfunctions/
│   ├── analyze/            # 文本 → 卡片（LLM，key 在云端环境变量）
│   ├── resolve/            # 链接 → 正文（含 SSRF 防护）
│   └── inbox/              # 分享收件箱（云数据库，小程序端 UI 二期接）
└── miniprogram/
    ├── app.js / app.json / app.wxss
    ├── config.js           # ★ 只改这里
    ├── utils/
    │   ├── model.js        # 卡片结构、分类定义、工具函数
    │   ├── rules.js        # 本地规则提炼（离线兜底）
    │   ├── merge.js        # 相似度 + 合并 + 树布局
    │   ├── store.js        # 本地存储 / CRUD / 导入导出
    │   └── ai.js           # 云函数调用 + 降级
    └── pages/
        ├── collect/        # 01 收集
        ├── library/        # 02 知识库
        └── map/            # 03 思维导图（canvas 2d）
```

## 与网页版的差异

| 项 | 网页版 | 小程序版 |
|---|---|---|
| 存储 | localStorage | wx.setStorageSync（key 相同：`zhixu.mvp.v1`） |
| AI | 本地 server.py 代理 | 云函数 `analyze`（key 在云端） |
| 链接读取 | server.py 抓取 | 云函数 `resolve` |
| 导图 | 原生 SVG | canvas 2d（同样的树布局与合并算法，重画） |
| 导入导出 | 文件下载/上传 | 剪贴板 JSON |
| 收件箱 | 网页轮询 `/api/inbox` | 云函数 `inbox` 已就绪，小程序端 UI 二期接 |
| 设置弹窗 | 有 | 精简：分类/阈值在导图页，数据在知识库页 |

## 已验证

- 全部 JS/JSON 通过语法校验，页面四件套齐全，require 路径正确
- 33 项核心逻辑冒烟测试全部通过（规则提炼、相似度合并、树布局、导入导出、CRUD、短文本守卫）
- 未做：微信开发者工具内的实际编译与真机预览（需要你的 AppID；本机已装开发者工具，可随时打开验证）
