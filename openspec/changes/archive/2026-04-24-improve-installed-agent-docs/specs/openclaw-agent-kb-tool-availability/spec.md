## MODIFIED Requirements

### Requirement: Installed OpenClaw guidance matches the real session tool contract
安装后的 OpenClaw skills、生成的 workspace-root docs，以及仓库中的 operator-facing docs SHALL 优先描述真实 `llmwiki` session 可直接使用的 KB tool surface；它们 MAY 把 installer-owned standalone MCP surface 作为次要的兼容/调试路径说明。

生成的 workspace-root docs SHALL 教会安装后的 `llmwiki` agent 遵循 LLM Wiki 运行模型：`KB_ROOT` 是安装绑定的 `kb` directory 本身，`<KB_ROOT>/raw` 是不可变 source-of-truth layer，`<KB_ROOT>/wiki` 是可编辑 knowledge layer，agent 的职责是把 raw material 和高价值回答增量编译进一个持久、互链、可演进的 wiki。

生成的 workspace-root docs SHALL 描述 schema/guidance layer 的职责：这些文档和 skills 是约束 agent 如何维护 wiki 的运行规则层。

生成的 workspace-root docs SHALL 说明高价值 query 输出可作为 `<KB_ROOT>/wiki/analyses/` 或等价 analysis page 的候选沉淀回 wiki。

生成的 workspace-root docs SHALL 说明 external `KB_ROOT` 由安装时指定且每次安装可能不同，并且 `KB_ROOT` 是 `kb` directory 本身；KB tree MUST 直接位于 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`，工具路径如 `wiki/index.md`、`wiki/log.md` MUST 相对于当前 installer-configured external `KB_ROOT` 解析，而不是解析为 OpenClaw workspace 内的固定路径、某次安装的绝对路径或 `<KB_ROOT>/kb/...`。

生成的 workspace-root docs SHALL 使用中文说明，并保留工具名、命令名、文件名、环境变量、协议名等英文代码标识的精确写法。

#### Scenario: 安装后的 skills 引用 session-visible canonical tools
- **WHEN** installer 将 OpenClaw-adapted KB skills 写入目标 workspace
- **THEN** 这些 skills 引用真实 `llmwiki` session 中可见的 canonical `kb_*` tool names

#### Scenario: Workspace docs 不把 saved MCP config 视为充分条件
- **WHEN** installer 为目标 workspace 写入生成的 workspace-root docs
- **THEN** 这些 docs 将 session-visible KB tool availability 描述为成功标准
- **AND** 这些 docs 不暗示 saved outbound MCP config 本身足以保证 OpenClaw agent 可用

#### Scenario: Repository docs 使用同一契约表述
- **WHEN** repository operator-facing docs 描述 OpenClaw installation contract
- **THEN** 它们将 session-visible KB tool availability 描述为成功标准
- **AND** 它们不把 saved outbound MCP config 本身描述为足够的 OpenClaw usability evidence
- **AND** 它们说明 external `KB_ROOT` 是安装绑定的 `kb` directory 本身，KB tree 直接位于 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`

#### Scenario: 生成的 AGENTS guidance 定义 LLM Wiki 操作规则
- **WHEN** installer 为目标 workspace 写入生成的 `AGENTS.md`
- **THEN** `AGENTS.md` 将 `<KB_ROOT>/raw` 描述为不可变 source-of-truth，将 `<KB_ROOT>/wiki` 描述为可编辑 knowledge layer，并描述 schema/guidance layer 约束 agent 维护 wiki 的规则职责
- **AND** 它说明 `KB_ROOT` 是安装绑定的 `kb` directory 本身，工具路径如 `wiki/index.md` 相对于当前 installer-configured external `KB_ROOT` 解析
- **AND** 它要求查询时先使用 wiki-first，再在需要时回退到 raw sources
- **AND** 它说明高价值 query 输出应作为 `<KB_ROOT>/wiki/analyses/` 或等价 analysis page 的候选沉淀回 wiki
- **AND** 它要求任何改变 `<KB_ROOT>/wiki` 的 ingest 工作更新 `wiki/index.md` 或其他 parent/index page，并向 `wiki/log.md` 追加有意义的记录
- **AND** 它要求 multi-file wiki changes 遵循 plan -> draft -> apply 纪律
- **AND** 它要求 uncertainty、contradictions 和 open questions 在 wiki 中显式记录
- **AND** 它要求所有写入目标保持在当前 external `KB_ROOT` 内

#### Scenario: 生成的 SOUL guidance 定义持久 wiki 使命
- **WHEN** installer 为目标 workspace 写入生成的 `SOUL.md`
- **THEN** `SOUL.md` 说明 `llmwiki` 应将 source material 和高价值 query 输出增量编译进持久、互链的 wiki，而不是每次 query 都从 raw sources 重新推导答案
- **AND** 它说明这份持久 wiki 位于当前安装绑定的 external `KB_ROOT` 下，而不是固定的 workspace-local `kb/`
- **AND** 它将 human role 描述为 source curation、direction 和 review
- **AND** 它将 agent role 描述为 summarizing、cross-linking、filing、logging，以及维护 wiki pages 之间的一致性
- **AND** 它保留 conservative installer ownership 和 fail-closed principles

#### Scenario: 生成的 TOOLS guidance 定义工具流程与风险边界
- **WHEN** installer 为目标 workspace 写入生成的 `TOOLS.md`
- **THEN** `TOOLS.md` 列出真实 `llmwiki` sessions 可用的 canonical 11 个 `kb_*` tools
- **AND** 它说明这些 tools 读写当前安装绑定的 external `KB_ROOT`
- **AND** 它按 query、ingest/write、index/log maintenance、lint、repair 和 installer lifecycle checks 等实际 workflow 分组或解释工具
- **AND** 它将 `kb_commit` 等高风险写操作标记为需要明确 user intent 或明确 workflow requirement
- **AND** 它将 standalone MCP reachability 描述为次要兼容/调试路径，而不是 OpenClaw usability success contract

#### Scenario: 生成的 HEARTBEAT checklist 对齐 ingest query lint 规则
- **WHEN** installer 为目标 workspace 写入生成的 `HEARTBEAT.md`
- **THEN** `HEARTBEAT.md` 包含 intended external `KB_ROOT`、session-visible canonical `kb_*` tools 和 wiki-first operation 的 startup checks
- **AND** 它提醒不要假设 `KB_ROOT` 是固定路径或 workspace-local `kb/`
- **AND** 它的 execution checklist 覆盖 ingest、query 和 lint 工作，并提醒维护 index/log
- **AND** 它的 wrap-up checklist 覆盖相关 validation、drift/risk reporting，以及在 ownership 或 runtime state ambiguous 时避免 speculative mutation

#### Scenario: 生成文档测试保护 LLM Wiki 关键规则
- **WHEN** workspace doc rendering tests 运行
- **THEN** tests 直接断言生成的 `AGENTS.md`、`SOUL.md`、`TOOLS.md` 和 `HEARTBEAT.md` 包含 LLM Wiki key rules
- **AND** 被断言的规则包括 `KB_ROOT` is the kb directory path model、raw/wiki/schema layer separation、tool paths relative to `KB_ROOT`、saved MCP config alone is insufficient、wiki-first querying、high-value query output filing、ingest/query/lint workflow guidance、`index.md` 和 `log.md` maintenance、conflict 或 open-question recording、practical tool combinations，以及 high-risk write-operation boundaries

#### Scenario: Repository docs 测试保护 install contract 关键表述
- **WHEN** repository operator-facing docs validation 运行
- **THEN** tests 断言 operator-facing docs 将 session-visible `kb_*` 描述为 OpenClaw usability 成功标准
- **AND** tests 断言 operator-facing docs 不把 saved MCP config alone 描述为足够的 OpenClaw usability evidence
- **AND** tests 断言 operator-facing docs 将 standalone MCP 描述为兼容/调试路径
- **AND** tests 断言 operator-facing docs 描述 external `KB_ROOT` 是安装绑定的 `kb` directory 本身，KB tree 直接位于 `<KB_ROOT>/raw` 和 `<KB_ROOT>/wiki`
