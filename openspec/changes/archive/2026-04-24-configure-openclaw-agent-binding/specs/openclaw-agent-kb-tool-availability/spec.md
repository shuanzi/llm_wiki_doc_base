## ADDED Requirements

### Requirement: Configured OpenClaw agent sessions expose canonical KB tools
After a healthy OpenClaw KB install, the installer-configured OpenClaw agent session SHALL expose the canonical 11-tool KB surface directly:

- `kb_source_add`
- `kb_read_source`
- `kb_write_page`
- `kb_update_section`
- `kb_ensure_entry`
- `kb_search_wiki`
- `kb_read_page`
- `kb_commit`
- `kb_rebuild_index`
- `kb_run_lint`
- `kb_repair`

#### Scenario: Healthy install exposes expected KB tools through the official runtime harness
- **WHEN** an operator installs the OpenClaw KB integration for `--agent-id research` successfully
- **THEN** the official OpenClaw runtime/internal harness for the targeted `research` workspace can see the canonical 11-tool KB surface

#### Scenario: Install fails when session-visible KB tools cannot be materialized
- **WHEN** installer setup reaches the point where the configured OpenClaw agent should receive the canonical 11 KB tools
- **AND** the installer cannot materialize or enable that session-visible surface
- **THEN** `install` fails with a non-success result
- **AND** the failure explains that the configured OpenClaw agent does not have the canonical KB tools in-session

#### Scenario: Install registers workspace-local plugin with OpenClaw discovery
- **WHEN** installer materializes the workspace-local installer-owned KB plugin shim
- **THEN** OpenClaw config includes the shim root in `plugins.load.paths`
- **AND** OpenClaw config includes the installer-owned plugin group in `plugins.allow`
- **AND** OpenClaw config enables the installer-owned plugin entry under `plugins.entries`

#### Scenario: Workspace-local plugin shim pins the external KB root
- **WHEN** the workspace-local installer-owned KB plugin shim executes a KB tool in a real OpenClaw session
- **AND** the Gateway or agent process lacks ambient `KB_ROOT`
- **THEN** the tool uses the installer-configured external `KB_ROOT`
- **AND** it does not fall back to `cwd/kb`

#### Scenario: Install allows the plugin group in the configured agent tool policy
- **WHEN** installer configures the target `research` agent for session-visible KB tools
- **THEN** the bound `research` agent tool policy allows the installer-owned KB plugin group
- **AND** installer preserves existing `tools.profile` settings
- **AND** installer avoids creating an OpenClaw-invalid `tools.allow` plus `tools.alsoAllow` conflict

#### Scenario: Read-only KB tool call succeeds through the official runtime harness
- **WHEN** the healthy session-visible runtime for the configured OpenClaw agent invokes `kb_read_page` against `wiki/index.md` under the configured external `KB_ROOT`
- **THEN** the tool call succeeds
- **AND** the returned content comes from the configured external KB rather than the OpenClaw workspace

## MODIFIED Requirements

### Requirement: Installer health MUST validate session-visible KB tools
Installer health evaluation SHALL treat session-visible KB tool availability as a required success condition for OpenClaw integration, not merely the presence of saved MCP config or on-disk skills.

Installer `install` and `check` SHALL validate both:

- visibility of the canonical 11-tool KB surface through the official OpenClaw runtime/internal harness for the configured OpenClaw agent workspace
- successful invocation of `kb_read_page` against `wiki/index.md`

#### Scenario: Saved MCP config exists but session tools are absent
- **WHEN** the installer-owned MCP registration exists and the standalone KB server can still be probed
- **AND** the official OpenClaw runtime/internal harness for the configured OpenClaw agent workspace does not receive the canonical `kb_*` tools
- **THEN** installer `check` reports the integration as unhealthy
- **AND** the reported drift explains that session-visible KB tools are missing for the configured OpenClaw agent

#### Scenario: Tool names are visible but live invocation fails
- **WHEN** the official OpenClaw runtime/internal harness for the configured OpenClaw agent workspace can see the canonical 11 KB tools
- **AND** `kb_read_page("wiki/index.md")` does not succeed against the configured external `KB_ROOT`
- **THEN** installer `install` and `check` report the integration as unhealthy
- **AND** the failure explains that session-visible KB tooling is present but not operational

#### Scenario: Repair restores missing session-visible KB tools
- **WHEN** installer-owned session integration state has drifted but ownership is still recognizable
- **THEN** `repair` restores the session-visible KB tool surface conservatively for the configured OpenClaw agent
- **AND** a follow-up health check confirms the official OpenClaw runtime/internal harness for that configured agent can see the expected KB tools again

#### Scenario: Legacy install is upgraded to include session integration metadata
- **WHEN** the installer encounters a pre-existing OpenClaw KB install whose manifest predates the session-visible runtime metadata
- **AND** installer ownership is still recognizable
- **AND** the configured `agentId` is bound to the explicit `--workspace`
- **THEN** install or repair upgrades the install in place
- **AND** subsequent health checks validate the canonical 11-tool KB surface through the official OpenClaw runtime/internal harness for the configured agent

### Requirement: Repair and uninstall act only on recognizable installer-owned session integration
Repair and uninstall SHALL mutate session-visible runtime artifacts only when installer ownership is recognizable from explicit metadata or an exact legacy artifact match for the explicit workspace and configured agent.

Ownership is recognizable when either:

- the installer manifest records the session-visible runtime artifact metadata for the explicit workspace and configured `agentId`, or
- legacy installer state matches the explicit workspace, configured `agentId`, and `mcpName` through the exact runtime artifact path plus exact content hash/build fingerprint, together with the installer-owned compatibility MCP registration and the installer-owned skill/workspace-doc hashes

#### Scenario: Uninstall removes only recognizable installer-owned artifacts
- **WHEN** uninstall runs against a workspace whose session-visible KB integration ownership is recognizable for the configured OpenClaw agent
- **THEN** uninstall removes only the installer-owned session runtime artifacts and installer-owned compatibility MCP registration
- **AND** uninstall does not remove unrelated user-managed runtime artifacts
- **AND** uninstall removes the installer-owned KB plugin entries from `plugins.load.paths`, `plugins.allow`, and `plugins.entries`
- **AND** uninstall removes the installer-owned KB plugin group from the bound configured agent tool policy

#### Scenario: Uninstall fails closed on unrecognized ownership
- **WHEN** uninstall runs against a workspace whose session-visible KB integration ownership is not recognizable for the configured OpenClaw agent
- **THEN** uninstall fails closed
- **AND** the failure explains that installer ownership could not be established

#### Scenario: Manifest agent id mismatch fails closed
- **WHEN** a lifecycle command runs with `--agent-id research`
- **AND** the installer manifest records session runtime ownership for a different `agentId`
- **THEN** the command fails closed or reports unhealthy drift according to command semantics
- **AND** it does not update the `research` agent tool policy unless an existing explicit `--force` path applies and ownership is otherwise recognizable

### Requirement: Installed OpenClaw guidance matches the real session tool contract
安装后的 OpenClaw skills、生成的 workspace-root docs，以及仓库中的 operator-facing docs SHALL 优先描述 installer-configured OpenClaw agent session 可直接使用的 KB tool surface；它们 MAY 把 installer-owned standalone MCP surface 作为次要的兼容/调试路径说明。

生成的 workspace-root docs SHALL 教会安装后的 installer-configured OpenClaw agent 遵循 LLM Wiki 运行模型：`KB_ROOT` 是安装绑定的 `kb` directory 本身，`<KB_ROOT>/raw` 是不可变 source-of-truth layer，`<KB_ROOT>/wiki` 是可编辑 knowledge layer，agent 的职责是把 raw material 和高价值回答增量编译进一个持久、互链、可演进的 wiki。

生成的 workspace-root docs SHALL 描述 schema/guidance layer 的职责：这些文档和 skills 是约束 agent 如何维护 wiki 的运行规则层。

生成的 workspace-root docs SHALL 说明高价值 query 输出可作为 `<KB_ROOT>/wiki/analyses/` 或等价 analysis page 的候选沉淀回 wiki。

生成的 workspace-root docs SHALL 说明 external `KB_ROOT` 由安装时指定且每次安装可能不同，并且 `KB_ROOT` 是 `kb` directory 本身；KB tree MUST 直接位于 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`，工具路径如 `wiki/index.md`、`wiki/log.md` MUST 相对于当前 installer-configured external `KB_ROOT` 解析，而不是解析为 OpenClaw workspace 内的固定路径、某次安装的绝对路径或 `<KB_ROOT>/kb/...`。

生成的 workspace-root docs SHALL 使用中文说明，并保留工具名、命令名、文件名、环境变量、协议名等英文代码标识的精确写法。生成的 deterministic workspace-root docs SHOULD use generic wording such as installer-configured OpenClaw agent and SHOULD NOT inject a concrete installed `agentId`.

#### Scenario: 安装后的 skills 引用 session-visible canonical tools
- **WHEN** installer 将 OpenClaw-adapted KB skills 写入目标 workspace
- **THEN** 这些 skills 引用真实 configured OpenClaw agent session 中可见的 canonical `kb_*` tool names

#### Scenario: Workspace docs 不把 saved MCP config 视为充分条件
- **WHEN** installer 为目标 workspace 写入生成的 workspace-root docs
- **THEN** 这些 docs 将 session-visible KB tool availability 描述为成功标准
- **AND** 这些 docs 不暗示 saved outbound MCP config 本身足以保证 OpenClaw agent 可用
- **AND** 这些 docs 将目标描述为 installer-configured OpenClaw agent，而不是固定 `llmwiki`

#### Scenario: Repository docs 使用同一契约表述
- **WHEN** repository operator-facing docs 描述 OpenClaw installation contract
- **THEN** 它们将 configured OpenClaw agent 的 session-visible KB tool availability 描述为成功标准
- **AND** 它们不把 saved outbound MCP config 本身描述为足够的 OpenClaw usability evidence
- **AND** 它们说明 external `KB_ROOT` 是安装绑定的 `kb` directory 本身，KB tree 直接位于 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`
- **AND** 它们 MAY 说明默认 `--agent-id` 是 `llmwiki`，但 MUST NOT 把 `llmwiki` 描述为唯一支持对象

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
- **AND** 它将 OpenClaw 目标描述为 installer-configured agent，而不是固定 `llmwiki`

#### Scenario: 生成的 SOUL guidance 定义持久 wiki 使命
- **WHEN** installer 为目标 workspace 写入生成的 `SOUL.md`
- **THEN** `SOUL.md` 说明 configured OpenClaw agent 应将 source material 和高价值 query 输出增量编译进持久、互链的 wiki，而不是每次 query 都从 raw sources 重新推导答案
- **AND** 它说明这份持久 wiki 位于当前安装绑定的 external `KB_ROOT` 下，而不是固定的 workspace-local `kb/`
- **AND** 它将 human role 描述为 source curation、direction 和 review
- **AND** 它将 agent role 描述为 summarizing、cross-linking、filing、logging，以及维护 wiki pages 之间的一致性
- **AND** 它保留 conservative installer ownership 和 fail-closed principles

#### Scenario: 生成的 TOOLS guidance 定义工具流程与风险边界
- **WHEN** installer 为目标 workspace 写入生成的 `TOOLS.md`
- **THEN** `TOOLS.md` 列出真实 configured OpenClaw agent sessions 可用的 canonical 11 个 `kb_*` tools
- **AND** 它说明这些 tools 读写当前安装绑定的 external `KB_ROOT`
- **AND** 它按 query、ingest/write、index/log maintenance、lint、repair 和 installer lifecycle checks 等实际 workflow 分组或解释工具
- **AND** 它将 `kb_commit` 等高风险写操作标记为需要明确 user intent 或明确 workflow requirement
- **AND** 它将 standalone MCP reachability 描述为次要兼容/调试路径，而不是 OpenClaw usability success contract

#### Scenario: 生成的 HEARTBEAT checklist 对齐 ingest query lint 规则
- **WHEN** installer 为目标 workspace 写入生成的 `HEARTBEAT.md`
- **THEN** `HEARTBEAT.md` 包含 intended external `KB_ROOT`、configured OpenClaw agent session-visible canonical `kb_*` tools 和 wiki-first operation 的 startup checks
- **AND** 它提醒不要假设 `KB_ROOT` 是固定路径或 workspace-local `kb/`
- **AND** 它的 execution checklist 覆盖 ingest、query 和 lint 工作，并提醒维护 index/log
- **AND** 它的 wrap-up checklist 覆盖相关 validation、drift/risk reporting，以及在 ownership 或 runtime state ambiguous 时避免 speculative mutation

#### Scenario: 生成文档测试保护 LLM Wiki 关键规则
- **WHEN** workspace doc rendering tests 运行
- **THEN** tests 直接断言生成的 `AGENTS.md`、`SOUL.md`、`TOOLS.md` 和 `HEARTBEAT.md` 包含 LLM Wiki key rules
- **AND** 被断言的规则包括 `KB_ROOT` is the kb directory path model、raw/wiki/schema layer separation、tool paths relative to `KB_ROOT`、saved MCP config alone is insufficient、wiki-first querying、high-value query output filing、ingest/query/lint workflow guidance、`index.md` 和 `log.md` maintenance、conflict 或 open-question recording、practical tool combinations，以及 high-risk write-operation boundaries
- **AND** tests 断言 generated workspace docs 使用 installer-configured OpenClaw agent 的通用语义，而不是固定 `llmwiki`

#### Scenario: Repository docs 测试保护 install contract 关键表述
- **WHEN** repository operator-facing docs validation 运行
- **THEN** tests 断言 operator-facing docs 将 configured OpenClaw agent 的 session-visible `kb_*` 描述为 OpenClaw usability 成功标准
- **AND** tests 断言 operator-facing docs 不把 saved MCP config alone 描述为足够的 OpenClaw usability evidence
- **AND** tests 断言 operator-facing docs 将 standalone MCP 描述为兼容/调试路径
- **AND** tests 断言 operator-facing docs 描述 external `KB_ROOT` 是安装绑定的 `kb` directory 本身，KB tree 直接位于 `<KB_ROOT>/raw` 和 `<KB_ROOT>/wiki`
- **AND** tests 允许 docs 说明默认 `--agent-id` 是 `llmwiki`，但不允许 docs 将 `llmwiki` 表述为唯一支持 agent

## REMOVED Requirements

### Requirement: `llmwiki` agent sessions expose canonical KB tools
**Reason**: The session-visible KB tool contract now applies to the installer-configured OpenClaw agent instead of a fixed `llmwiki` agent.

**Migration**: Use `--agent-id <id>` to select the OpenClaw agent whose session receives canonical `kb_*` tools. Existing invocations that omit `--agent-id` keep the compatibility default `llmwiki`.
