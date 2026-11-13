# 知序 · MCP Server

把知序的「搜索 / 抓正文 / AI 提炼」暴露成 [MCP](https://modelcontextprotocol.io) 工具，任何支持 MCP 的 AI 客户端都能直接调用：

- Claude Desktop
- DeepSeek Harness（DSH）
- Cline / Continue / Zed 等

> 同类项目参考：[liaogx/xiaohongshu-mcp](https://github.com/liaogx/xiaohongshu-mcp)、[xyj2570/xhs-mcp](https://github.com/xyj2570/xhs-mcp)、[BaxterL/dsh-xhs-search](https://github.com/BaxterL/dsh-xhs-search)（CDP + 隔离浏览器 + DOM 提取）。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `zhixu_search` | 在小红书/知乎按关键词搜索，返回标题、作者、点赞、带 `xsec_token` 的可读链接 |
| `zhixu_resolve` | 读取链接正文（小红书/知乎/B站/微博/抖音/通用网页） |
| `zhixu_analyze` | 文本 → 知识卡片（标题/摘要/要点/标签/分类/主题/核心短语） |
| `zhixu_status` | 检查抓取助手与 AI 服务是否可用 |

## 前置

1. **抓取助手**：`node integrations/xhs/xhs_helper.mjs`（默认 `http://127.0.0.1:8790`，首次登录一次）
2. **AI 提炼**：本地 `app/server.py`（`http://127.0.0.1:8788`）或线上 `https://zhixu-note.netlify.app`（自动回退）

## 客户端配置

### Claude Desktop（`claude_desktop_config.json`）

```json
{
  "mcpServers": {
    "zhixu": {
      "command": "node",
      "args": ["D:\\桌面\\教学agent\\温酱\\integrations\\mcp\\zhixu-mcp.mjs"],
      "env": {
        "ZHIXU_HELPER": "http://127.0.0.1:8790",
        "ZHIXU_API": "http://127.0.0.1:8788"
      }
    }
  }
}
```

### DSH / 其他 MCP 客户端

命令：`node <项目路径>/integrations/mcp/zhixu-mcp.mjs`
传输：stdio
协议：MCP over stdio（Content-Length 分帧）

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `ZHIXU_HELPER` | `http://127.0.0.1:8790` | 本地抓取助手 |
| `ZHIXU_API` | `http://127.0.0.1:8788` | 知序 API（失败自动回退线上） |

## 测试

```powershell
cd "D:\桌面\教学agent\温酱"
node tests/mcp.test.mjs        # 15 项：协议 + 4 个工具（会真实搜索/抓取/提炼）
node tests/integration.test.mjs# 14 项：助手 + 线上 API
```

## 注意

- 搜索需要助手已登录对应站点；未登录会返回 `{ needLogin: true }`
- 只在本机可用（助手只监听 127.0.0.1）
- 个人整理用途，不要高频批量抓取


## 更新（2026-11-14）

- 新增工具 `zhixu_comments`：抓小红书笔记评论区（按赞排序）
- 测试：`node tests/mcp.test.mjs` → 17 项（协议 + 5 个工具真实调用）
