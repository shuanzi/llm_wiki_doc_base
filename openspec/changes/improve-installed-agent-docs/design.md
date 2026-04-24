## Context

安装器当前通过 `src/openclaw-installer/workspace-docs.ts` 生成 workspace-root 文档，包括 `AGENTS.md`、`HEARTBEAT.md`、`TOOLS.md`、`SOUL.md`。这些文档已经覆盖显式 `--workspace`、`llmwiki` 绑定、外部 `KB_ROOT`、session-visible `kb_*` 工具、installer ownership 和 fail-closed 等安装集成契约。

本次变更不改变这些安装契约，而是在现有生成文档中补足 LLM Wiki 的任务语义：`KB_ROOT` 是安装时指定的 `kb` directory 本身，`<KB_ROOT>/raw` 是不可变原始资料层，`<KB_ROOT>/wiki` 是 LLM 维护的可编辑知识层，schema/指导文档约束代理如何持续维护 wiki。`archived/ideas/llm-wiki.md` 描述的核心模式是“把知识增量编译进持久 wiki”，而不是在每次查询时临时从 raw source 重新做 RAG 式拼装。

主要使用者是安装后的 `llmwiki` agent。它需要在没有额外人工解释的情况下，从生成文档中理解何时 ingest、何时 query、何时 lint，怎样维护 `index.md` 与 `log.md`，以及怎样处理冲突、不确定性、孤儿页面和高价值分析沉淀。

文档语言采用“中文说明 + 英文代码标识”：规则、流程和原则用中文表达；工具名、命令名、文件名、环境变量和协议标识保持英文原文。

重要路径约束：external `KB_ROOT` 是安装时由 `--kb-root` 指定的 `kb` directory 本身，每次安装可能不同。生成文档必须说明 KB tree 直接位于 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`；工具路径如 `wiki/index.md`、`wiki/log.md` 相对于 `KB_ROOT` 解析。生成文档不得暗示存在 `<KB_ROOT>/kb/raw` 或 OpenClaw workspace-local `kb/`。

## Goals / Non-Goals

**Goals:**

- 让安装生成的 `AGENTS.md` 成为 `llmwiki` 的直接执行规则：明确 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、schema/guidance 分层、wiki-first 查询、ingest 写入纪律、multi-file wiki change 的 plan -> draft -> apply 流程、索引/父页面链接、日志更新、冲突与开放问题记录。
- 让安装生成的 `SOUL.md` 表达系统使命与优先级：知识要持续沉淀、交叉引用、修正和演进，而不是只回答当前问题。
- 让安装生成的 `TOOLS.md` 从纯工具清单升级为操作手册：说明读写工具的用途、推荐组合、写入风险、检查/修复流程，以及 standalone MCP 仅为兼容/调试路径。
- 同步更新安装生成的 `HEARTBEAT.md`，让 startup/execution/wrap-up checklist 与 `AGENTS.md` 中 ingest/query/lint 规则保持一致。
- 明确 `KB_ROOT` 是 `kb` directory 本身，KB 内容直接位于 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`，工具路径相对于 `KB_ROOT` 解析，并避免在生成文档中写死绝对路径。
- 明确 schema/guidance layer 是约束 agent 维护 wiki 的运行规则层。
- 明确高价值 query 输出可以作为 `<KB_ROOT>/wiki/analyses/` 候选沉淀回 wiki。
- 同步更新 repository operator-facing docs，使 preserved repo-doc scenario 可被实现和验证。
- 新增专门测试，直接断言生成的 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md` 包含 LLM Wiki 关键规则，并对 repository operator-facing docs 的 install contract 关键表述做轻量内容断言。
- 保持当前安装器的 deterministic rendering 与 manifest hash drift 检测方式不变，使 `check`/`repair` 仍能准确识别 installer-owned workspace doc drift。
- 保持文档内容 concise enough for agent startup context，同时足够具体，可直接约束任务执行。

**Non-Goals:**

- 不改变 `kb_*` 工具名称、参数 schema、返回结构或工具数量。
- 不改变安装器 CLI 参数、OpenClaw config 路径解析、workspace targeting、session-visible runtime shim 或 MCP 兼容注册逻辑。
- 不新增模板引擎、外部依赖或运行时配置项。
- 不把 `archived/ideas/llm-wiki.md` 全文复制进生成文档；只提炼可执行规则。
- 不为 workspace docs 增加运行时可配置模板；本次仍是固定安装模板优化。
- 不把安装时的绝对 `KB_ROOT` 注入 workspace-root docs；实际 `KB_ROOT` 仍由 manifest、MCP config 和 session runtime metadata 管理。

## Decisions

### Decision 1: 继续在 `workspace-docs.ts` 中用静态 markdown 行渲染

生成文档仍由 `buildAgentsDocContent`、`buildToolsDocContent`、`buildSoulDocContent` 返回 deterministic markdown。这样最小化实现范围，并保留现有 `sha256(content)` drift 检测、manifest metadata 与 repair 行为。

替代方案：引入外部 markdown 模板文件。该方案更便于编辑长文档，但会扩大打包、路径解析、测试 fixture 和安装时文件读取面；本次只是优化固定生成内容，不值得引入新的模板加载路径。

### Decision 2: 三个文档分工保持清晰

- `AGENTS.md` 写“必须遵守的行为规则”，包括写入边界、流程约束和 wiki 维护纪律。
- `SOUL.md` 写“为什么这样工作”的系统原则，强调持久 wiki、增量编译、可追溯性与人机分工。
- `TOOLS.md` 写“如何操作工具”，包括工具分组、典型流程和风险提示。

替代方案：把所有内容集中写入 `AGENTS.md`。这会让单个启动文档过长，也会弱化 `SOUL.md` 和 `TOOLS.md` 在 OpenClaw workspace 中的用途。

### Decision 3: 文档应围绕任务流程组织，而不是只围绕文件名或工具名组织

`AGENTS.md` 应显式覆盖 ingest、query、lint 三类核心操作：ingest 要读 `<KB_ROOT>/raw`、写 `<KB_ROOT>/wiki`、更新 `wiki/index.md` / `wiki/log.md`；query 要先搜 wiki、必要时读 raw、可沉淀 analyses；lint 要检查链接、孤儿页、陈旧/冲突声明和可补资料缺口。

`TOOLS.md` 保留 11 个工具列表，但增加推荐组合，例如：

- 查询：`kb_search_wiki` -> `kb_read_page` -> 必要时 `kb_read_source`
- 写页：`kb_write_page` / `kb_update_section` -> `kb_ensure_entry` 更新 index/log -> `kb_rebuild_index`
- 维护：`kb_run_lint` -> 人类确认后 `kb_repair` 或定向 wiki edits

替代方案：只扩写每个工具的一句话说明。该方案可以改善可读性，但不能指导 agent 完成完整任务。

### Decision 4: 保留英文工具名与命令名，正文可使用中文

生成文档应保留 `kb_*`、`install`、`check`、`repair`、`uninstall`、`KB_ROOT`、`llmwiki`、`AGENTS.md` 等精确标识，避免与代码契约脱节。说明性正文可以使用中文或更强的任务导向表达。

替代方案：全部英文。当前用户要求后续文档使用中文，且目标 workspace 可以从中文规则中获益；保留代码标识即可保证可执行性。

### Decision 5: 同步更新 `HEARTBEAT.md`

`HEARTBEAT.md` 应作为 `llmwiki` 每轮任务的简短 checklist，与 `AGENTS.md` 中的 ingest/query/lint 规则保持一致。Startup 阶段确认 `KB_ROOT`、session-visible `kb_*`、wiki-first 入口；execution 阶段提醒按任务类型执行 ingest/query/lint 并维护 index/log；wrap-up 阶段提醒运行必要检查、报告 drift/风险、避免 speculative mutation。

替代方案：只更新 `AGENTS.md`、`SOUL.md`、`TOOLS.md`。该方案会让 `HEARTBEAT.md` 继续停留在安装健康检查层面，无法作为任务执行前后的轻量核对清单。

### Decision 6: 增加生成文档关键规则断言测试

新增专门测试应直接调用 workspace doc render API，断言 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md` 包含 LLM Wiki 关键规则，例如 `KB_ROOT` 是 `kb` directory 本身、`<KB_ROOT>/raw` / `<KB_ROOT>/wiki` / schema 分层、工具路径相对于 `KB_ROOT`、wiki-first 查询、ingest/query/lint 流程、`index.md`/`log.md` 维护、高价值 query 输出沉淀、冲突/开放问题记录、工具组合、高风险写操作提示，以及 saved MCP config alone 不足以证明 OpenClaw agent usability。测试不应依赖完整安装流程，以便快速定位文档模板回归。

Repository operator-facing docs 的自动覆盖不需要完整 snapshot；使用内容断言即可。断言目标应覆盖：session-visible `kb_*` 是 OpenClaw usability 成功标准、saved MCP config alone 不足以证明 OpenClaw agent usability、standalone MCP 是兼容/调试路径、external `KB_ROOT` 是安装绑定的 `kb` directory 本身，KB tree 直接位于 `<KB_ROOT>/raw` / `<KB_ROOT>/wiki`。

替代方案：只依赖现有 typecheck/build 或 manifest hash drift 行为。该方案只能证明文档可生成，不能证明关键规则仍存在。

### Decision 7: 文档说明 `KB_ROOT` 是 `kb` directory 本身，不嵌入安装时绝对路径

`renderOpenClawWorkspaceDoc` 当前按 `docName` deterministic rendering，不接收 `kbRoot`。这与 installer-owned workspace doc hash drift 检测相匹配：同一版本安装器生成的 docs 内容稳定，manifest 记录 actual `kbRoot`，session runtime shim pin 住 actual `KB_ROOT`，`check`/`repair` 从 manifest、MCP config 或 session runtime metadata 解析当前绑定。

因此，生成文档应使用“当前安装绑定的 external `KB_ROOT`”这类表述，并说明 `KB_ROOT` 已经是 `kb` directory 本身。实际内容位于 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`；工具路径如 `wiki/index.md`、`wiki/log.md` 相对于 `KB_ROOT` 解析。文档不应出现 `/some/absolute/path/kb` 之类的安装实例路径，也不应暗示 `kb/` 位于 OpenClaw workspace 下或存在 `<KB_ROOT>/kb/...`。

替代方案：扩展 `renderOpenClawWorkspaceDoc({ docName, kbRoot })`，把安装时路径写进 `AGENTS.md` 等文档。该方案会让文档内容随安装目标变化，增加 manifest hash、repair、re-home 和测试复杂度；当前已有 manifest/session runtime metadata 管理实际 `KB_ROOT`，文档只需要讲清解析语义。

### Decision 8: Repository operator docs 也纳入实现范围

现有 base requirement 保留了 repository operator-facing docs 与 workspace docs 使用同一 contract wording 的场景。因此本次实现不应只改生成模板，还应检查并更新 `README.md`、`docs/openclaw-installer-agent-guide.md` 等实际描述 OpenClaw installation contract 的仓库文档。仓库文档无需复制完整 workspace-root docs，但必须同步表达 session-visible `kb_*` 是成功标准、saved MCP config alone 不足以证明 OpenClaw agent usability、standalone MCP 是兼容/调试路径、external `KB_ROOT` 是安装绑定的 `kb` directory 本身。

替代方案：把 repo-doc scenario 从 modified requirement 中移除。该方案会削弱既有能力契约，并可能让仓库 operator docs 与安装生成文档再次漂移。

## Risks / Trade-offs

- [Risk] 生成文档过长，占用 agent startup context。→ Mitigation: 使用短章节、规则列表和流程列表，避免复制 idea 文档中的长篇解释。
- [Risk] 文档说法与现有 skills (`kb_ingest`、`kb_query`、`kb_lint`) 发生语义漂移。→ Mitigation: 实现时对照 skills 中已有规则，生成文档只写上层约束和流程，不复制易过期细节。
- [Risk] 修改生成文档会改变 manifest 中记录的 workspace doc hash，导致旧安装被 `check` 识别为 drift。→ Mitigation: 这是预期行为；`repair` 应按现有机制重写 installer-owned docs。无需新增迁移路径。
- [Risk] 中文说明可能影响只按英文关键词检索规则的 agent。→ Mitigation: 保留所有关键文件名、工具名、命令名和英文协议词。
- [Risk] `TOOLS.md` 将 `kb_commit` 描述为可用工具，可能诱导自动提交。→ Mitigation: 明确 `kb_commit` 属于高风险写操作，默认不应自动调用，除非用户要求或 workflow 明确需要。
- [Risk] 文档里的 raw/wiki 路径被误解为 OpenClaw workspace 内的固定目录，或被误解为 `<KB_ROOT>/kb/...`。→ Mitigation: 在 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md` 中明确 `KB_ROOT` 是 `kb` directory 本身，内容直接位于 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki` 等子目录；测试覆盖这一表述。
- [Risk] repository operator docs 与生成文档再次出现 contract drift。→ Mitigation: 任务中显式包含 repo-doc 更新和验证，spec 保留 repo-doc scenario。

## Migration Plan

1. 更新 `src/openclaw-installer/workspace-docs.ts` 中 `AGENTS.md`、`HEARTBEAT.md`、`TOOLS.md`、`SOUL.md` 的生成内容。
2. 更新 repository operator-facing docs，保持 OpenClaw install contract 与生成文档一致。
3. 保持 `renderMarkdown`、doc name 列表、manifest hash 计算和 installer ownership 结构不变。
4. 新增并运行针对 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md` 生成内容的关键规则断言测试，覆盖 LLM Wiki 规则、`KB_ROOT` path model 和 saved MCP config alone 不足以证明可用的规则。
5. 新增并运行针对 repository operator-facing docs 的 install contract 内容断言。
6. 运行 TypeScript typecheck/build，确认静态渲染代码仍可编译。
7. 运行插件 surface / installer 相关验证，确认生成文档变更不会影响 canonical tool surface。
8. 对既有安装，使用当前 `repair --workspace ...` 机制重写 installer-owned workspace-root docs；若 workspace docs 非 installer-owned 或 ownership 不可识别，仍按现有 fail-closed 行为处理。

Rollback 策略：回退 `workspace-docs.ts` 中四份 workspace-root docs 的生成内容，并回退对应 repository operator-facing docs 更新即可。由于不改变 manifest schema、工具协议或 CLI 参数，回滚不需要数据迁移。

## Open Questions

无。以下问题已决策：

- 同步更新 `HEARTBEAT.md`，使 startup/execution/wrap-up checklist 与新 `AGENTS.md` 的 ingest/query/lint 规则保持一致。
- 文档采用“中文说明 + 英文代码标识”。
- 新增专门 snapshot/内容断言测试，直接断言生成的 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md` 包含 LLM Wiki 关键规则。
- `KB_ROOT` 是安装时指定且可能变化的 `kb` directory 本身；生成文档说明 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state` 的结构和相对工具路径，不嵌入安装实例的绝对路径。
- Repository operator-facing docs 也要保持同一 contract wording。
