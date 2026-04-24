## 1. 准备与现状确认

- [x] 1.1 检查 `src/openclaw-installer/workspace-docs.ts` 的现有渲染结构，确认 `renderOpenClawWorkspaceDoc` / `renderAllOpenClawWorkspaceDocs` 仍保持 deterministic rendering 且不接收安装实例的绝对 `KB_ROOT`。
- [x] 1.2 查找现有 workspace doc、installer manifest、OpenClaw installer validation 测试，确定新增内容断言测试应放置的位置和运行命令。
- [x] 1.3 对照 `skills/kb_ingest/SKILL.md`、`skills/kb_query/SKILL.md`、`skills/kb_lint/SKILL.md`，提取生成文档中应保持一致的 ingest/query/lint 上层规则。
- [x] 1.4 查找 `README.md`、`docs/openclaw-installer-agent-guide.md` 等 repository operator-facing docs 中描述 OpenClaw installer contract 的段落，确定需要同步的表述。

## 2. 更新生成的 workspace-root docs

- [x] 2.1 更新 `AGENTS.md` 生成内容，覆盖 `KB_ROOT` is the kb directory path model、`<KB_ROOT>/raw` / `<KB_ROOT>/wiki` / schema-guidance 分层、工具路径相对于 `KB_ROOT`、wiki-first 查询、高价值 query 输出沉淀为 analyses 候选、ingest 更新 index/log、multi-file wiki change 的 plan -> draft -> apply 纪律、冲突/开放问题记录和 external `KB_ROOT` 写入边界。
- [x] 2.2 更新 `SOUL.md` 生成内容，表达 `llmwiki` 的持久 wiki 使命、人类与 agent 分工、raw material 与高价值 query 输出的增量编译/交叉引用/一致性维护，以及 conservative ownership / fail-closed 原则。
- [x] 2.3 更新 `TOOLS.md` 生成内容，保留 canonical 11 个 `kb_*` tools，并按 query、ingest/write、index/log maintenance、lint、repair、installer lifecycle checks 说明工具组合和风险边界。
- [x] 2.4 更新 `HEARTBEAT.md` 生成内容，使 startup/execution/wrap-up checklist 与 `AGENTS.md` 的 ingest/query/lint 规则一致，并提醒不要假设 `KB_ROOT` 是固定路径或 workspace-local `kb/`。
- [x] 2.5 保持中文说明 + 英文代码标识风格，避免写入任何安装实例的绝对 `KB_ROOT` 路径。
- [x] 2.6 更新 repository operator-facing docs，使其说明 session-visible `kb_*` 是 OpenClaw usability 成功标准、saved MCP config alone 不足以证明可用、standalone MCP 是兼容/调试路径、external `KB_ROOT` 是安装绑定的 `kb` directory 本身。

## 3. 增加测试覆盖

- [x] 3.1 新增或扩展 workspace doc rendering 测试，直接调用生成 API 获取 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`HEARTBEAT.md`。
- [x] 3.2 断言 `AGENTS.md` 包含 `KB_ROOT` is the kb directory path model、raw/wiki/schema 分层、工具路径相对于 `KB_ROOT`、saved MCP config alone 不足以证明可用、wiki-first、高价值 query 输出沉淀、index/log、plan -> draft -> apply、冲突/开放问题和写入边界规则。
- [x] 3.3 断言 `SOUL.md` 包含持久 wiki、raw material 与高价值 query 输出的增量编译、人类/agent 分工、external `KB_ROOT` 和 fail-closed/ownership 原则。
- [x] 3.4 断言 `TOOLS.md` 包含 canonical 11 个 `kb_*` tools、实际 workflow 组合、standalone MCP 调试定位和 `kb_commit` 等高风险写操作边界。
- [x] 3.5 断言 `HEARTBEAT.md` 包含 external `KB_ROOT` startup check、ingest/query/lint execution checklist、index/log 维护提醒和 ambiguous ownership/runtime state 的 fail-closed 提醒。
- [x] 3.6 断言生成的 workspace docs 整体不把 saved MCP config alone 描述为足够的 OpenClaw agent usability evidence，并将 standalone MCP 描述为兼容/调试路径。
- [x] 3.7 新增或扩展 repository operator-facing docs 内容断言，覆盖 session-visible `kb_*` 成功标准、saved MCP config alone 不足以证明可用、standalone MCP 兼容/调试定位、external `KB_ROOT` 是安装绑定的 `kb` directory 本身。
- [x] 3.8 确认测试不依赖完整安装流程、不要求注入绝对 `KB_ROOT`，并能快速定位文档模板回归。

## 4. 验证与收尾

- [x] 4.1 运行新增/相关测试，确认 workspace doc 与 repository operator-facing docs 内容断言通过。
- [x] 4.2 运行 `npm run typecheck` 和 `npm run build`。
- [x] 4.3 运行 `npm run validate:plugin-surface`，确认 canonical tool surface 未受文档变更影响。
- [x] 4.4 人工检查生成文档内容，确认没有暗示 `kb/` 位于 OpenClaw workspace，也没有嵌入某次安装的绝对 `KB_ROOT`。
- [x] 4.5 人工检查 repository operator-facing docs，确认它们与生成文档保持同一 OpenClaw install contract 表述。
- [x] 4.6 更新任务状态，记录验证结果与剩余风险。

验证结果：
- `node --import tsx --test tests/openclaw-installer-substrate.test.ts` 通过，覆盖 workspace docs snapshot/content rules 与 operator-facing docs contract。
- `npx tsc --noEmit --ignoreConfig tests/openclaw-installer-substrate.test.ts --module commonjs --target ES2022 --moduleResolution node --esModuleInterop --types node --ignoreDeprecations 6.0` 通过。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run validate:plugin-surface` 通过，确认 canonical 11 个 `kb_*` tools 未漂移。
- `openspec validate improve-installed-agent-docs` 通过。
- 最终 reviewer 复审通过；`schema/guidance layer` 与 external `KB_ROOT` tool binding 两个补丁后缺口已收敛。

剩余风险：
- 文档测试以精确子串断言关键规则，能防止语义缺失，但未来等价改写需要同步调整断言。
