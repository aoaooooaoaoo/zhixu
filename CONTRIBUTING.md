# 贡献指南

本项目为个人参赛作品，仍欢迎以 Issue / PR 形式反馈问题或建议。

## 提交前检查

1. `node tests/portability.test.mjs` 通过（不依赖外部服务的可移植性测试）。
2. 不提交任何真实密钥：`.env`、`cf/.dev.vars`、`deploy/vps/env.production` 均已被忽略。
3. 不提交 `node_modules/`、`dist/`、`deploy/vps/_pkg/`、`electron/release/` 等产物。
4. 中文注释说明业务原因，代码遵循 `.editorconfig`。

## 提交信息格式

```text
feat(app): 新增分类管理面板
fix(web): 修正 analyze 接口超时处理
test: 补充 MCP 工具断言
docs: 更新部署说明
chore: 升级依赖版本
```

## 分支

- `main`：可运行、可部署的稳定版本。
- 功能分支：`feat/<简短描述>`，合并前跑通测试。
