# Harness Boundaries

## Binding Workspace 中允许出现

- `.agents/skills/llm-wiki/`：Codex 项目技能；
- `.claude/skills/llm-wiki/`：Claude Code 项目技能；
- `skills/llm-wiki/`：OpenClaw Workspace 技能；
- `AGENTS.md`、`CLAUDE.md`：薄启动说明；
- `.llm-wiki-binding/binding.json`：Vault 路径和已安装 Harness；
- `.llm-wiki-binding/runtime/`：缓存、搜索索引、临时计划、锁和 Session 衍生状态；
- `vault`：可选的外部 Vault 符号链接。

## Vault 中禁止出现

- Harness 私有配置、认证信息或 Session ID；
- Codex Thread、Claude Session、OpenClaw SQLite；
- 可重建的 Embedding、BM25、向量或全文索引；
- 临时计划、锁文件、工具调用转储；
- 仅某个 Agent 能解释的状态。

## 绑定可替换

删除 Binding Workspace 后，Vault 必须：

- 所有 Markdown 和来源仍可读；
- 所有内部链接仍以 Vault 自身为基准；
- 可重新绑定到另一 Agent；
- 不需要恢复旧 Session 才能继续维护。

若 Agent 工具需要额外目录权限，应在启动参数或工具自身配置中授予，不要把权限状态写入 Vault。
