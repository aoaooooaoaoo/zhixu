# 知序 · GitHub 同类项目调研

> 调研时间：2026-11-11；star 数为当时 GitHub API 返回值，仅作量级参考。
> 已下载的参考材料在 `../reference/`，只用于阅读产品结构与交互，不直接复制代码。
> **License 提醒**：标 AGPL-3.0 的项目，代码不能直接搬进闭源产品；MIT 项目可使用但需保留版权声明。本原型为原创实现。

---

## 1. 结论先行

1. **「AI 把链接/笔记变成卡片」不是空白赛道**：Karakeep、MindCard、Inwit 都在做，但多数停在「收藏/卡片/问答」，很少把「**合并重复观点并解释差异**」作为核心。
2. **「知识树 + 思维导图」已有成熟实现**：MindCard 的知识拓扑、Markmap / Mind Elixir 的交互与布局可以直接借鉴；但它们的树多为「分类/标签」，不是「用户看得懂、能纠正的谱系」。
3. **知序的差异点**：不是收藏工具，也不是聊天机器人，而是 **「收集 → 谱系 → 合并式导图」** 这条学习闭环；重点在「合并的可解释性」和「来源保留」。
4. **必须补的能力**：浏览器剪藏/分享入口（M2）、语义相似度（embedding）、复习机制（M3）；MVP 先不碰抓取。

---

## 2. 项目对照

| 项目 | Star / License | 它解决什么 | 可借鉴 | 与知序的差异 |
|---|---:|---|---|---|
| [MindCard](https://github.com/wanxiayushaonian/mindcard) | 3 / MIT | AI 知识卡片管理：卡片、RAG 对话、知识拓扑、对话分支、微信小程序、浏览器插件 | 卡片→拓扑的组织方式；浏览器剪藏；「Crystallize」把 AI 回答存成卡片；多端形态 | 更偏「卡片 + AI 对话平台」；没有「合并重复观点并解释差异」；体量大，不适合直接照搬 |
| [Karakeep](https://github.com/karakeep-app/karakeep)（原 Hoarder） | 30.4k / AGPL-3.0 | 自托管「收藏一切」：链接/笔记/图片/PDF，自动抓标题、摘要、标签、全文/语义搜索、插件、OCR | 链接元数据抓取；自动标签/摘要；浏览器插件；RSS/导入；列表与搜索 | 目标是「囤」，不是「学」；没有知识谱系和合并导图；AGPL 不适合直接抄代码 |
| [Khoj](https://github.com/khoj-ai/khoj) | 38.1k / AGPL-3.0 | 个人 AI 第二大脑：文档/网页问答、语义搜索、自定义 agent、自动化 | 来源引用；语义检索；多模型；把笔记变成可问答资产 | 以聊天/搜索为中心，没有卡片化与可视化谱系；部署重 |
| [Reor](https://github.com/reorproject/reor) | 8.5k / AGPL-3.0 | 本地优先的 AI 笔记：自动关联相关笔记、语义搜索、RAG 问答、Obsidian 式编辑器 | 「相关笔记」自动连接；本地模型/隐私优先；编辑体验 | 桌面端 + Markdown 文件；没有「提炼卡片/合并导图」；学习路径弱 |
| [Markmap](https://github.com/markmap/markmap) | 13.2k / MIT | Markdown → 可交互思维导图：折叠、缩放、平移、主题、SVG/PNG 导出 | 导图交互（折叠/缩放/平移）；布局与主题；SVG 导出 | 只是渲染器，不解决「卡片从哪来、怎么合并」 |
| [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) | 3.2k / MIT | 框架无关的思维导图核心：节点、拖拽、主题、快捷键 | 节点交互与键盘操作；导图数据结构 | 同上，偏编辑器；不处理来源与合并语义 |
| [Inwit](https://github.com/ximing/inwit) | 4 / AGPL-3.0 | AI 学习伴侣：扔进去内容，Agent 消化成卡片，按遗忘曲线催复习 | 「卡片 + 复习」闭环；学习节奏 | 偏记忆/复习；没有谱系与合并导图；产品还早期 |
| [Marginalia](https://github.com/ShrikantLambe/marginalia) | 0 / MIT | 安静的 AI 阅读清单：存 URL、出 TL;DR、搜索库/可信来源 | 极简的「存链接→摘要」流程；信息密度控制 | 只有阅读清单，没有知识结构；可作为 M2 链接入口参考 |

---

## 3. 逐项拆解

### 3.1 MindCard（最接近「卡片 + 拓扑」）

- **产品结构**：卡片、RAG 对话、知识拓扑、对话分支、工作区记忆、多端（Web/小程序/插件）。
- **值得学**：
  - 卡片字段：标题、内容、关键词、情绪、链接；
  - 「知识拓扑」自动聚类 + 层级树；
  - 浏览器插件把网页存成卡片；「Crystallize」把 AI 回答直接存为卡片；
  - 对话分支（Fork）用于深挖某个子话题。
- **不照搬**：全平台功能过重；以对话为中心，用户要先会「问」；没有合并去重。
- **对知序的启发**：M2 做浏览器剪藏；「AI 回答存成卡片」可作为后续功能；拓扑树可以借鉴可视化，但知序要更轻、更「学习」。

### 3.2 Karakeep（收藏一切）

- **产品结构**：链接/笔记/图片/PDF 收藏，自动抓取元数据，LLM 自动标签与摘要，全文+语义搜索，插件/移动端/OCR/RSS。
- **值得学**：抓取标题/描述/封面的兜底策略；自动标签；浏览器扩展的「一键存」；列表 + 搜索。
- **不照搬**：它的核心是「囤积与检索」，不是「学习与结构」；数据模型面向 bookmark，不是学习卡片。
- **对知序的启发**：M2 的链接入口可参考它的「抓元数据 + 自动标签」，但知序只保留提炼后的卡片与来源，不保存全文。

### 3.3 Khoj / Reor（AI 第二大脑）

- **值得学**：来源引用、语义检索、把个人语料变成可问答资产；Reor 的「自动发现相关笔记」可以变成知序的「相似卡片推荐」。
- **不照搬**：聊天/搜索是入口，学习路径与视觉结构弱；Khoj 部署复杂度高，Reor 是桌面应用。
- **对知序的启发**：M3 的「相关卡片」「问自己的知识库」可参考，但不要一开始就做聊天，先把「收集-谱系-导图」打穿。

### 3.4 Markmap / Mind Elixir（导图交互）

- **值得学**：折叠/缩放/平移的手感；布局与连线；SVG/PNG 导出；键盘操作。
- **不照搬**：它们解决「怎么画」，不解决「画什么、为什么合并」。
- **对知序的启发**：当前原型用原生 SVG 自己实现（零依赖、可控），后续节点多了可以换 Markmap/Mind Elixir（MIT）做渲染层，把「合并语义」留在自己的数据层。

### 3.5 Inwit / Marginalia（学习与阅读）

- **Inwit**：卡片 + 遗忘曲线，证明「收进来只是开始，复习才是留存」；知序 M3 可以加「到期卡片」。
- **Marginalia**：极简「存→摘要」，说明入口越短越好；知序的粘贴框已经尽量短，M2 要再短（一键剪藏）。

---

## 4. QQ 分享链接生态（补充调研）

用户问「能不能接管一个新 QQ 来收链接」。技术上可行的路线是 **OneBot 协议 + QQNT 第三方实现**，但**不建议代登录，也不应由我接管账号**。

| 项目 | 作用 | 与知序的关系 |
|---|---|---|
| [NapCatQQ](https://github.com/NapNeko/NapCatQQ) | QQNT 的 OneBot 11 实现，扫码登录 | 推荐底座；桥连接它的 WebSocket |
| [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) | 另一套 NTQQ 协议实现（C#） | 可作为 NapCat 的替代 |
| [OneBot 11](https://onebot.dev/) | 聊天机器人协议标准 | 知序桥只依赖协议，不绑定实现 |
| [NoneBot2](https://github.com/nonebot/nonebot2) | Python 异步机器人框架 | 想要插件/命令/多平台时的完整方案 |
| [dsh-qq-onebot-bridge](https://github.com/cheesehaqi/dsh-qq-onebot-bridge) | QQ ↔ DSH Agent 的完整桥 | 功能非常全（白名单/限流/风控/控制台），可读架构；本项目只写最小桥 |

判断：

- **能做**：小号 + NapCat + OneBot WebSocket + 一个 100 行的桥，就能把私聊链接转成 HTTP；
- **不该做**：代替用户扫码登录、保存 QQ 密码、自动加好友/群发；
- **风险**：第三方协议不符合腾讯官方协议，可能被限制/封号；必须用小号，降低频率；
- **知序的选择**：把它做成**可选、本地、自担风险**的插件，不用 QQ 也能正常收集内容。

参考 README 已下载到 `reference/qq/`。

---

## 5. 竞品没有解决好的三个问题（知序的机会）

1. **收藏 ≠ 学会**：大多数工具优化「存」，不优化「再回来」；知序用「谱系 + 导图」让回顾有结构。
2. **重复内容没人管**：同一话题刷到 10 篇，收藏夹只会更乱；知序显式合并、保留来源、展示差异。
3. **AI 结果不可纠正**：直接生成整棵树/整篇总结，用户只能接受；知序让 AI 出草稿、用户确认、合并可解释。

---

## 6. 已下载的参考材料

位置：`../reference/`

| 文件/目录 | 内容 | 用途 |
|---|---|---|
| `mindcard-README.md` / `mindcard-README_zh.md` | MindCard 英文/中文 README | 研究卡片、拓扑、RAG、插件能力 |
| `mindcard/` | MindCard 浅克隆源码 | 看目录结构、卡片数据模型、插件组织方式（只读参考） |
| `karakeep-README.md` | Karakeep README | 收藏/标签/搜索/插件能力 |
| `khoj-README.md` | Khoj README | 第二大脑与语义检索 |
| `reor-README.md` | Reor README | 本地优先与相关笔记 |
| `markmap-README.md` | Markmap README | Markdown → 导图、导出、交互 |
| `marginalia-README.md` | Marginalia README | 极简「存 URL → TL;DR」 |
| `npm/markmap-view-1.1.0/`、`npm/markmap-parse-1.1.0/` | Markmap 包（MIT） | 研究树解析与 SVG 渲染接口 |
| `npm/mind-elixir-6.0.0/` | Mind Elixir 包（MIT） | 研究导图节点/交互数据结构 |
| `qq/napcat-README.md`、`qq/lagrange-core-README.md`、`qq/nonebot2-README.md` | QQ 生态 README | 设计 OneBot 桥；只做本地最小实现 |
| `qq/dsh-qq-onebot-bridge-README.md` | 功能完整的 QQ ↔ Agent 桥 README | 看白名单/限流/风控/控制台的工程做法 |
| `github-meta.json` | 仓库 star/license/更新时间 | 调研时的量化快照 |

> 说明：`mindcard/` 是浅克隆，含上游 `.git` 与构建目录；仅作阅读，不参与知序构建，也不复制其代码。若后续直接使用 Markmap / Mind Elixir，需按 MIT 保留版权声明。

---

## 7. 对知序 MVP 的具体取舍

| 决策 | 结论 | 依据 |
|---|---|---|
| 先做粘贴文本，不做链接抓取 | ✅ | 合规与反爬风险；先验证提炼价值 |
| 分类/主题先规则+LLM，不做 embedding | ✅ MVP | 轻量可解释；M3 再上向量 |
| 合并用字符相似度 + 同主题加成 | ✅ MVP | 不引入模型也能解释；M3 换 embedding + LLM 判断 |
| 导图用原生 SVG | ✅ | 零依赖、可控；节点多再换库 |
| 不做登录/云同步 | ✅ MVP | 本地优先，降低隐私与部署成本 |
| M2 做浏览器剪藏 | 建议 | 参考 MindCard/Karakeep；这是使用频率的关键 |
| M3 做复习 | 建议 | Inwit 验证了「卡片 + 记忆曲线」的价值 |
| 不复制 AGPL 代码 | 必须 | 合规；只借鉴产品思路 |
