# {{VAULT_NAME}}

这是一个 Agent-first、Obsidian-compatible 的本地 LLM Wiki。

从 [VAULT.md](VAULT.md) 开始浏览。长期知识、来源、证据、领域配置和演进日志都保存在本目录；Agent Skill、Harness 配置、缓存与 Session 状态应位于独立 Binding Workspace。

## 人工使用

1. 用 Obsidian 或任意 Markdown 编辑器打开本目录。
2. 把待处理资料放入 `sources/inbox/`，或使用 `llm-wiki register-source` 注册。
3. 从绑定工作区启动 Codex、Claude Code 或 OpenClaw，并要求其使用 `llm-wiki` Skill。
4. 通过 Git 或其他版本控制审查和恢复变更。
