# 真实数据全流程测试需求文档

## 背景

本轮目标是在 `test-case-updates-20260507` worktree 中增加一类真实数据全流程测试。测试输入来自 `tests/test-source/`，其中：

- `tests/test-source/markdown/*.md` 是本地真实 Markdown 源材料。
- `tests/test-source/url.txt` 是真实 URL 源材料清单。

测试需要模拟 `TOOLS.md` 中的「实战工作流」，通过工具接口完成源材料纳入、wiki 写入、索引与日志维护、ingest 状态收尾、质量校验，并验证产出物符合预期。

仓库根目录没有静态 `TOOLS.md` 文件；该文档由 installer 在 workspace 中生成，源模板位于 `src/openclaw-installer/workspace-docs.ts`。当前「实战工作流」定义为：

1. 查询：优先 `kb_search_wiki` + `kb_read_page`；证据不足时再 `kb_read_source`。
2. ingest/写入：`kb_source_add` 或 `kb_url_add` -> `kb_read_source` -> `kb_write_page`/`kb_update_section` -> `kb_append_log_entry` -> `kb_ingest_finalize`。
3. 索引与日志：完成页面落盘后，用 `kb_ensure_entry` 维护 `wiki/index.md`；用 `kb_append_log_entry` 维护 `wiki/log.md`。
4. 质量与修复：先 `kb_run_lint`，必要时 `kb_rebuild_index` 或 `kb_repair`，并保留 dry_run 审核。
5. 安装器生命周期：`install/check/repair/uninstall` 的主判据是安装器配置的 OpenClaw agent 会话可见 canonical `kb_*`。
6. `kb_commit` 属于高风险动作：仅在用户显式要求提交、且当前工作流明确需要时执行。
7. 仅保存 MCP 配置不足以证明 OpenClaw 可用；standalone MCP 只用于兼容性与调试排障。

## 目标

1. 新增真实数据全流程测试，覆盖 `tests/test-source/markdown/` 下的 Markdown 文件和 `tests/test-source/url.txt` 中的 URL。
2. 测试通过工具接口执行 `TOOLS.md` 的「实战工作流」，而不是直接调用底层 core 函数绕过工具层。
3. 明确验证 MCP 工具调用与 OpenClaw 插件工具调用是否走同一执行逻辑。
4. 校验每轮工作流产出物，包括 raw/source manifest、wiki 页面、index/log、cache、lint/finalize 状态。
5. 每个 source 子测试执行前重新初始化目标测试知识库目录，保证多轮运行可重复、互不污染。

## 范围

必须覆盖：

- 本地 Markdown ingest：使用 `kb_source_add` 注册真实 Markdown 文件。
- URL ingest：使用 `kb_url_add` 注册真实 URL 并产生 canonical Markdown source。
- source 读取：使用 `kb_read_source` 校验 canonical source content 可读。
- wiki 写入：使用 `kb_write_page` 写入 source summary 页面；必要时使用 `kb_update_section` 覆盖章节更新路径。
- parent/index 链接：使用 `kb_ensure_entry` 把新页面链接到 `wiki/index.md`。
- 日志：使用 `kb_append_log_entry` 写入 `wiki/log.md`。
- ingest 生命周期：使用 `kb_ingest_finalize` 标记 manifest 为 `ingested`。
- 质量检查：使用 `kb_run_lint`；若索引缺失或漂移，可在测试内显式调用 `kb_rebuild_index` 后再断言。
- 查询回读：使用 `kb_search_wiki` 和 `kb_read_page` 验证新页面可检索、可读取。

不在本轮范围内：

- 不验证 LLM 生成摘要的语义质量。测试页面内容应由确定性的测试驱动生成，避免让自动测试依赖模型输出。
- 不执行 `kb_commit`。该工具属于高风险动作，且本轮需求是验证工作流产物，不需要提交测试 KB 改动。
- 不修改 `kb/raw` 里的既有真实源材料；测试目标 KB 应为临时或专用目录。
- 不把真实 URL 网络测试作为无条件单元测试要求。真实 URL 存在网络、反爬、内容变更、远端删除等不稳定因素，应作为显式启用的集成测试。

## MCP 与 OpenClaw 工具一致性要求

可以通过 MCP 接口测试主要工作流，原因是当前代码结构中：

- `src/mcp_server.ts` 的 MCP `CallTool` handler 调用 `dispatchKbTool(name, args, config)`。
- `src/openclaw_plugin.ts` 的 OpenClaw `execute` handler 也调用 `dispatchKbTool(toolName, normalizeToolArgs(params), workspace)`。
- `dispatchKbTool` 位于 `src/runtime/kb_tool_runtime.ts`，统一负责参数校验和分派到 `src/tools/kb_*.ts`。
- 两个入口共享 `KB_TOOL_DEFINITIONS`，工具 schema 和 canonical 工具顺序来自 `src/runtime/kb_tool_contract.ts`。

因此，MCP 适合作为工具链 E2E 的主要执行入口。测试还必须补充一个轻量入口一致性校验：

- MCP `tools/list` 返回的工具名和 schema 必须等于 `KB_TOOL_DEFINITIONS`。
- OpenClaw 插件注册出的工具名和 schema 必须等于 `KB_TOOL_DEFINITIONS`。
- 对至少一个无外部副作用或可隔离副作用的工具，在同构临时 KB 上分别通过 MCP 和 OpenClaw plugin execute 调用，并确认结果语义一致。

需要显式记录的差异：

- MCP 失败时返回 `isError: true` 与文本 `Error: ...`。
- OpenClaw plugin 失败时抛出 `Error`。
- 这是传输层和错误包装差异，不应视为工具执行逻辑差异。

## 测试数据要求

Markdown 数据：

- 默认全量读取 `tests/test-source/markdown/*.md`，按文件名排序，逐个执行工作流。
- 每个文件都是真实源材料；测试不能重写这些源文件。
- 每个 source 子测试中必须产生稳定的 `source_id`，并在 manifest、source page、index、log 中可追踪。

URL 数据：

- 默认读取 `tests/test-source/url.txt`，忽略空行和注释行。
- 真实 URL 网络测试必须通过显式环境变量启用，例如 `RUN_REAL_DATA_E2E_URLS=1`。
- 未启用时，测试应跳过 URL 网络调用并给出清晰 skip 信息，避免普通 `npm test` 因网络波动失败。
- 启用后应全量遍历 `url.txt` 中 URL；若单个 URL 因远端不可用失败，测试应报告具体 URL、阶段和错误。

## 目标测试 KB 初始化要求

每个 source 子测试开始前必须初始化目标 KB：

1. 删除上一轮目标目录。
2. 创建最小可用 KB 目录结构。
3. 写入 `schema/version.yaml`。
4. 写入 `wiki/index.md`，包含 `Sources`、`Concepts`、`Entities`、`Analyses` 等 anchor。
5. 写入 `wiki/log.md`。
6. 创建 `raw/inbox`、`raw/originals`、`state/manifests`、`state/cache`、`state/extractions`。
7. 通过测试入口调用 `kb_rebuild_index({ allow_partial: false })`，使 `page-index.json` 和 `search-index.json` 与初始 wiki 一致。

目标目录必须位于临时目录或测试专用目录，不能指向 repo 根目录的 `kb/`。

## 产出物验收标准

对每个 Markdown source：

- `kb_source_add` 成功，返回 `source_id`、`file_name`、`canonical_path`。
- `kb/raw/inbox/{source_id}.md` 存在，内容与 canonical Markdown 一致。
- `kb/state/manifests/{source_id}.json` 存在，`source_origin` 为 `file` 或等价本地来源，`canonical_path` 指向 raw inbox。
- `kb_read_source` 可读取内容，内容非空，并包含源文件中的可识别标题或正文片段。
- `kb_write_page` 写入 `wiki/sources/{source_id}.md`，frontmatter 合法，`id` 等于 `source_id`，`type` 为 `source`。
- `kb_ensure_entry` 将 source page 链接到 `wiki/index.md`，并带有稳定 dedup key。
- `kb_append_log_entry` 在 `wiki/log.md` 写入 ingest 记录，带有稳定 dedup key。
- `kb_ingest_finalize` 后 manifest 的 `ingest_status` 为 `ingested`，`ingest_summary_page_id` 等于 `source_id`，`ingest_touched_pages` 包含 source page、index、log。
- `kb_search_wiki` 能搜索到 source page。
- `kb_read_page` 能按 `source_id` 读回页面。
- `kb_run_lint` 返回成功或无 deterministic error。

对每个 URL source：

- `kb_url_add` 成功，返回 `source_id`、`canonical_path`、`manifest`，且 `manifest.url_metadata.final_url` 为非空字符串；`title` 允许为 `null`，测试页面标题需在 `title` 为空时降级到 `file_name` 或 URL。
- `kb/raw/originals/{source_id}.html` 或 manifest 中记录的 original artifact 存在。
- `kb/raw/inbox/{source_id}.md` 存在，包含 URL provenance 注释和 Defuddle 产出的 canonical Markdown。
- `kb/state/extractions/` 下存在 extraction JSON，并与 manifest 中路径一致。
- 后续 source page、index、log、finalize、search/read/lint 验收与 Markdown source 相同。

## 可重复性要求

- 同一个测试命令重复运行两次，第二次不得依赖第一次的目标 KB 内容。
- 每个 source 子测试都必须从干净 KB 开始。
- 测试内部如需要验证幂等性，可以在同一个已初始化 KB 内连续执行两轮工作流；但下一条测试仍必须重新初始化目标 KB。
- 测试不得遗留 tracked 文件改动。

## 风险与约束

- 真实 URL 测试会受网络、远端内容变化、TLS、DNS、反爬和速率限制影响，应与默认测试分离。
- 微信公众号 URL 和 GitHub 页面可能出现访问限制或 HTML 结构变化；失败报告必须包含 URL 和工具阶段。
- 如果未来 MCP server 或 OpenClaw plugin 不再共享 `dispatchKbTool`，入口一致性测试必须失败。
- 如果 `TOOLS.md` 的「实战工作流」发生变化，本测试需求和技术方案需要同步更新。
