## Why

当前安装器会写入 `AGENTS.md`、`SOUL.md`、`TOOLS.md` 等 workspace-root 文档，但内容偏向安装状态与工具列表，尚不足以把 `llmwiki` 稳定约束成一个会维护持久 wiki 的知识库代理。`archived/ideas/llm-wiki.md` 已明确了 raw/wiki/schema 三层、ingest/query/lint、index/log 等关键模式，应把这些任务语义沉淀进安装生成文档，减少新 workspace 初始化后的执行偏差。

## What Changes

- 更新安装器生成的 `AGENTS.md` 内容，使其更完整地描述 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、schema/guidance 文档之间的职责边界，以及 ingest、query、lint、写入日志、链接新页面、记录冲突和开放问题的操作纪律。
- 更新安装器生成的 `SOUL.md` 内容，使其表达 `llmwiki` 的核心使命：把原始资料增量编译成可复用、可链接、可演进的 wiki，而不是每次查询都从 raw source 重新拼装答案。
- 更新安装器生成的 `TOOLS.md` 内容，使工具说明从“工具列表”扩展为“什么时候用、怎样组合、哪些工具有写入风险、哪些工具适合检查/修复”的操作指南。
- 同步更新安装器生成的 `HEARTBEAT.md`，让 startup/execution/wrap-up checklist 与新的 ingest/query/lint 规则保持一致。
- 明确 `KB_ROOT` 是安装时指定的 `kb` directory 本身；其内部结构是 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`，工具路径如 `wiki/index.md`、`wiki/log.md` 是相对于 `KB_ROOT` 的路径；生成文档不得写死某次安装的绝对 `KB_ROOT`。
- 明确 schema/guidance layer 的职责，并要求高价值 query 输出可作为 `<KB_ROOT>/wiki/analyses/` 候选沉淀回 wiki。
- 同步更新仓库 operator-facing docs，使它们与安装生成文档使用同一 LLM Wiki 和 session-visible tool contract 表述。
- 为生成的 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md` 增加专门 snapshot/内容断言测试，确认它们包含 LLM Wiki 关键规则；为 repository operator-facing docs 增加轻量内容断言，确认 session-visible `kb_*` 成功标准、saved MCP config alone 不足以证明可用、standalone MCP 调试定位和 `KB_ROOT` path model 不会漂移。
- 保持安装器 fail-closed、显式 workspace、外部 `KB_ROOT`、session-visible `kb_*` 工具等既有契约不变。
- 不引入新的运行时依赖，不改变 `kb_*` 工具名称、参数协议或安装命令参数。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `openclaw-agent-kb-tool-availability`: 扩展“Installed OpenClaw guidance matches the real session tool contract”的需求，使安装生成的 workspace-root 文档不仅匹配真实 session-visible 工具契约，还必须传达 LLM Wiki 的知识维护模型、工作流纪律、索引/日志规则和安全写入边界。

## Impact

- Affected code: `src/openclaw-installer/workspace-docs.ts`
- Affected validation: workspace doc snapshot/hash 相关测试或 fixture、针对生成文档 LLM Wiki 关键规则的内容断言、针对 repository operator-facing docs install contract 表述的内容断言、插件 surface 校验中可能依赖生成文档内容的断言
- Affected docs: 安装生成的 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md`
- Affected repository docs: `README.md`、`docs/openclaw-installer-agent-guide.md` 或其他描述 OpenClaw installer contract 的 operator-facing docs
- Affected source context: `archived/ideas/llm-wiki.md`
- Important constraint: external `KB_ROOT` is installation-specific and may differ across installs; generated docs must refer to the configured `KB_ROOT` instead of embedding a concrete path.
- No dependency changes.
