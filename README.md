# OpenClaw KB

OpenClaw KB 是一个由 LLM 持续维护的知识库系统。它把原始资料沉淀为可编辑、可追踪、可检索的 wiki 知识层，并通过 MCP / OpenClaw 工具暴露标准化操作。

本文是仓库的顶层入口，说明当前 V2 架构包含什么、如何构建启动、如何安全运行。

## Live 文档

当前 live 文档集：

- `README.md`（本文）
- [docs/product.md](./docs/product.md)
- [docs/technical.md](./docs/technical.md)
- [docs/progress.md](./docs/progress.md)
- [docs/openclaw-installer-agent-guide.md](./docs/openclaw-installer-agent-guide.md)

历史计划、评审、想法和会话快照已经归档到 `archived/`，仅作背景追溯，不是当前事实来源。

## 当前状态

- 当前架构：**V2（LLM-driven knowledge compilation）**
- 工具面：MCP server 与 OpenClaw native plugin 均暴露 canonical `kb_*` 工具面。
- OpenClaw 集成：仓库提供 native plugin surface 与 installer-managed external-KB 部署流程。
- KB 治理：对 `kb/wiki` 的多文件修改必须遵循 [AGENTS.md](./AGENTS.md) 要求的 `plan -> draft -> apply` 流程。
- 日志语义：`kb/wiki/log.md` 记录 ingest、重要 query synthesis，以及每次完整 lint pass（包括 clean pass / `No findings`）。

## 目录结构

```text
kb/
  raw/                 # 原始资料层，不改写原件
  wiki/                # 可编辑知识层
    index.md           # 导航索引
    log.md             # 操作时间线
    sources/           # 来源摘要页
    entities/          # 实体页
    concepts/          # 概念页
    analyses/          # 值得沉淀的分析结果
    reports/           # lint / health 报告
  schema/
    wiki-conventions.md
  state/
    manifests/         # source manifest
    cache/page-index.json
src/
  mcp_server.ts        # stdio MCP server
  openclaw_plugin.ts   # OpenClaw native runtime adapter
  runtime/             # canonical kb_* tool contract / args / dispatch
  tools/kb_*.ts        # 工具实现
openclaw.plugin.json   # OpenClaw native plugin manifest
skills/
  kb_ingest/SKILL.md
  kb_query/SKILL.md
  kb_lint/SKILL.md
```

KB 写入边界和 wiki 操作规则以 [AGENTS.md](./AGENTS.md) 为准。

## 安装与验证

从仓库根目录执行：

```bash
npm install
npm run typecheck
npm run test
npm run build
```

常用专项验证：

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_tool_contract_baseline.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_search_wiki_resolve_link.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_rebuild_index.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_run_lint.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_repair.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_openclaw_plugin_surface.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_openclaw_installer_install.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_openclaw_installer_repair_uninstall.ts
```

## 启动 MCP

先构建，再启动：

```bash
npm run build
npm run start:mcp
```

`start:mcp` 等价于：

```bash
node dist/mcp_server.js
```

### `KB_ROOT` / `WORKSPACE_ROOT`

`src/mcp_server.ts` 按以下顺序解析 `kb_root`：

1. `KB_ROOT`：直接解析为 KB 根目录。
2. `WORKSPACE_ROOT`：视为仓库根目录，解析到 `${WORKSPACE_ROOT}/kb`。
3. 默认值：从当前工作目录解析 `./kb`。

显式指定示例：

```bash
KB_ROOT=/absolute/path/to/kb npm run start:mcp
WORKSPACE_ROOT=/absolute/path/to/repo npm run start:mcp
```

启动守卫：如果解析后的 `kb_root` 不是已存在目录，server 会在连接 MCP transport 前退出，退出码为 `2`。

## MCP 工具

MCP server（`kb-mcp`）当前暴露 11 个工具。

Workflow tools：

1. `kb_source_add`：注册本地 source 文件，写入 raw source 与 manifest。
2. `kb_read_source`：按 `source_id` 读取 canonical source，支持分页窗口。
3. `kb_write_page`：创建或更新完整 wiki 页面，并校验 frontmatter。
4. `kb_update_section`：替换或追加指定 heading section。
5. `kb_ensure_entry`：向 index/log 等页面幂等插入单行条目。
6. `kb_search_wiki`：基于 `page-index.json` 搜索 wiki，支持 query、type/tag filter 与 wikilink 解析。
7. `kb_read_page`：按路径或 `page_id` 读取 wiki 页面。
8. `kb_commit`：仅 stage 配置的 `kb_root` 范围并创建 git commit。

Maintenance tools：

9. `kb_rebuild_index`：从 `kb/wiki/**/*.md` 确定性重建 `kb/state/cache/page-index.json`。
10. `kb_run_lint`：执行 deterministic 与 semantic KB lint，默认包含 semantic advisory checks。
11. `kb_repair`：仅修复结构性 KB artifact（`index.md`、`log.md`、`page-index.json`），支持 `dry_run`。

当前实现注意点：

- `kb_source_add` 原生支持 Markdown / plaintext；`.html/.htm/.csv/.json/.xml/.pdf/.docx/.pptx/.xlsx/.xls/.epub` 可在安装 Python MarkItDown 后转换为 canonical Markdown。
- ZIP、OCR / 图片、音频转录、Outlook / email、YouTube URL、SVG 与 MarkItDown plugins 当前故意不支持。
- `kb_commit` 会拒绝在已有 `kb_root` 范围外 staged files 的情况下提交，避免把无关暂存内容带入同一次 commit。

## OpenClaw Native Plugin

仓库同时提供 OpenClaw native plugin runtime surface：

- manifest：`openclaw.plugin.json`
- runtime artifact：`dist/openclaw_plugin.js`
- package metadata：`package.json` -> `openclaw.extensions = ["./dist/openclaw_plugin.js"]`

构建：

```bash
npm run typecheck
npm run build
```

从本地路径安装到 OpenClaw：

```bash
openclaw plugins install /absolute/path/to/this/repo
```

运行 `openclaw agent --local` 时，OpenClaw 会预加载已安装的 local plugins，使 canonical 11 个 `kb_*` 工具在 session 内可用。

## OpenClaw Installer（External KB）

installer 用于把当前仓库的 KB 能力接入另一个 OpenClaw workspace，并让 KB 保持为外部目录。

入口：

- script：`npm run start:openclaw-installer`
- artifact：`dist/openclaw_installer.js`
- bin：`kb-openclaw-installer`

先构建：

```bash
npm run typecheck
npm run build
```

安装（显式 workspace + 显式 external `KB_ROOT`）：

```bash
node dist/openclaw_installer.js install \
  --workspace /absolute/path/to/target-workspace \
  --kb-root /absolute/path/to/external-kb \
  --agent-id llmwiki \
  --mcp-name llm-kb
```

检查：

```bash
node dist/openclaw_installer.js check \
  --workspace /absolute/path/to/target-workspace \
  --agent-id llmwiki \
  --mcp-name llm-kb \
  --json
```

修复：

```bash
node dist/openclaw_installer.js repair \
  --workspace /absolute/path/to/target-workspace \
  --kb-root /absolute/path/to/external-kb \
  --agent-id llmwiki \
  --mcp-name llm-kb
```

卸载：

```bash
node dist/openclaw_installer.js uninstall \
  --workspace /absolute/path/to/target-workspace \
  --agent-id llmwiki \
  --mcp-name llm-kb
```

installer-managed flow 的健康标准：

- 配置的 OpenClaw agent session 能直接看到 canonical `kb_*` 工具面。
- 默认 `--agent-id` 是 `llmwiki`，但不是唯一支持目标。
- 已保存的 MCP config 只是 secondary compatibility / debugging signal，不足以证明 OpenClaw 可用。
- `check` 和 `repair` 以配置的 OpenClaw agent session 可见 canonical `kb_*` 工具面作为主要健康契约；仅有已保存 MCP config 不足以证明 OpenClaw 可用。
- standalone MCP server 只是次要兼容 / 调试入口，不是 OpenClaw 成功标准。
<!-- `check` and `repair` treat configured OpenClaw agent session-visible `kb_*` availability as the primary health contract; saved MCP config alone is insufficient evidence of OpenClaw usability. -->
<!-- The standalone MCP server remains a secondary compatibility/debugging surface, not the OpenClaw success criterion. -->

### Installer 操作约束

- `install/check/repair/uninstall` 都只作用于显式 `--workspace`。
- `install` 要求显式 `--kb-root`；`repair` 可从 manifest / MCP config 推断，也可显式覆盖。
- external `KB_ROOT` 是已安装 KB 目录本身：`<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`，不是 `<KB_ROOT>/kb/...`。
- 工具相对路径（例如 `wiki/index.md` 和 `wiki/log.md`）都在该 `KB_ROOT` 下解析。
<!-- `KB_ROOT` is the installed `kb` directory itself (`<KB_ROOT>/raw`, `<KB_ROOT>/wiki`, `<KB_ROOT>/schema`, `<KB_ROOT>/state`), not `<KB_ROOT>/kb/...` and not workspace-local `kb/`. -->
<!-- Tool-relative paths such as `wiki/index.md` and `wiki/log.md` are resolved under that `KB_ROOT`. -->
- installer 会在 `<workspace>/skills/{kb_ingest|kb_query|kb_lint}` 写入 OpenClaw-adapted skills（`openclaw-adapted-v1`）。
- installer 会在 `<workspace>/.openclaw/extensions/llmwiki-kb-tools` 写入 workspace-local native plugin shim，并把它固定到 external `KB_ROOT`。
- installer 会配置 OpenClaw plugin load / allow / enabled 状态，并在绑定 agent 的 tool policy 中允许 `llmwiki-kb-tools` plugin group。
- `kb_commit` 仍在 MCP server surface 中可用，但不是默认 external-KB installer contract；adapted skills 不会自动执行 `kb_commit`。
- 冲突处理默认 fail-closed；只有在明确理解 ownership / drift 后才使用 `--force`。

更细的执行手册见 [docs/openclaw-installer-agent-guide.md](./docs/openclaw-installer-agent-guide.md)。

## Skills 工作流

- `skills/kb_ingest/SKILL.md`：新增 source 并更新多页 wiki。
- `skills/kb_query/SKILL.md`：wiki-first 问答；高价值答案可沉淀到 `wiki/analyses/`。
- `skills/kb_lint/SKILL.md`：健康检查，包括 orphan、ghost link、missing cross-reference、stub、contradiction 与 data gap。

日常操作优先使用 skills 作为 SOP；maintenance tools 是健康检查与结构修复原语。

## Safe E2E 用法

E2E driver：

```text
scripts/e2e_v2_ingest.ts
```

默认安全行为：如果省略 `--kb-root`，脚本会创建临时 workspace，复制当前 `./kb` 到临时目录，执行两轮 ingest 后清理，不污染真实仓库。

安全默认运行：

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts /absolute/path/to/source.md
```

显式目标 KB：

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts /absolute/path/to/source.md --kb-root /absolute/path/to/kb
```

commit 模式规则：

- `--commit` 必须同时提供显式 `--kb-root`。
- 显式 `--kb-root` 必须正好是 `<git-top-level>/kb`。
- 嵌套路径如 `<repo>/sub/kb` 会被拒绝。

生产可用 commit 示例：

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts /absolute/path/to/source.md --kb-root "$PWD/kb" --commit
```

## 操作守则

- 查询时先查 `kb/wiki`，再回退到 `kb/raw`。
- `kb/raw` 是 source-of-truth 原件层，不改写。
- 新页面必须从 index 或 parent page 可达。
- 每次改变 `kb/wiki` 的 ingest 都必须更新 `kb/wiki/log.md`。
- 不确定、冲突或证据不足必须显式写成 conflict / open question。
- 高价值回答优先沉淀到 `kb/wiki/analyses/`。

## 入口索引

- 产品视角：[docs/product.md](./docs/product.md)
- 技术实现：[docs/technical.md](./docs/technical.md)
- 当前进度：[docs/progress.md](./docs/progress.md)
- OpenClaw installer 执行指南：[docs/openclaw-installer-agent-guide.md](./docs/openclaw-installer-agent-guide.md)
- MCP server 入口：[src/mcp_server.ts](./src/mcp_server.ts)
- OpenClaw plugin 入口：[src/openclaw_plugin.ts](./src/openclaw_plugin.ts)
- Archive index：[archived/index.md](./archived/index.md)
