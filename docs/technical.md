# llm_doc_base 技术文档（当前实现）

本文面向工程师，描述本仓库当前可运行实现（V2），不复述历史设想。历史计划文档已归档到 `archived/`，仅作背景参考，不作为现状事实来源。

## 1. 架构分层

当前系统是一个以 MCP 工具为原语、以 skills 为流程编排的知识库系统，核心分 4 层：

1. 存储层（`kb/`）
- `kb/raw/`：原始材料的不可变副本与资产。
- `kb/wiki/`：可编辑知识层（source/entity/concept/analysis/report/index/log）。
- `kb/state/`：机器状态（`manifests`、`cache/page-index.json`）。
- `kb/schema/`：内容约定（`wiki-conventions.md`）。

2. 工具层（`src/tools/kb_*.ts`）
- 提供 11 个 MCP 工具：8 个 workflow 原子能力 + 3 个 maintenance 能力。
- 负责 I/O、安全边界、基础校验、局部索引维护。
 - 其中 workflow tool 负责日常 ingest/query primitive，maintenance tool 负责索引重建、lint、结构修复。

3. 服务层（`src/mcp_server.ts`）
- 以 stdio MCP server 暴露 11 个工具及 JSON Schema。
- 负责 `kb_root` 解析、启动前目录守卫、工具路由分发。

4. 流程层（`skills/` + `scripts/`）
- `skills/kb_ingest`、`kb_query`、`kb_lint` 定义操作 SOP（工具如何组合、何时记 log、何时回写 analysis/report）。
- `scripts/e2e_v2_ingest.ts` 与验证脚本用于端到端和安全/幂等回归。

## 2. 目录结构（实现视角）

```text
kb/
  raw/
    inbox/                 # kb_source_add 复制后的 canonical source
  wiki/
    index.md               # 导航索引（人工可读）
    log.md                 # ingest/query/lint 时间线
    sources/
    entities/
    concepts/
    analyses/
    reports/
  state/
    manifests/             # 每个 source_id 一个 manifest json
    cache/page-index.json  # 搜索与 path/id 解析的机器索引
  schema/wiki-conventions.md

src/
  mcp_server.ts
  tools/kb_*.ts            # 8 个 workflow tool + 3 个 maintenance tool
  core/                    # 共享 KB 领域逻辑（source/wiki/log/search/maintenance/git）
  types/index.ts           # Manifest/PageFrontmatter/PageIndex 等结构
  utils/frontmatter.ts     # frontmatter 解析/校验/摘要抽取
  utils/path_validator.ts  # 路径约束与 symlink 逃逸防护
  utils/hash.ts            # source_id 与 content_hash

skills/
  kb_ingest/SKILL.md
  kb_query/SKILL.md
  kb_lint/SKILL.md

scripts/
  e2e_v2_ingest.ts
  validate_e2e_v2_ingest_safety.ts
  validate_kb_search_wiki_resolve_link.ts
```

## 3. 核心数据结构

以 `src/types/index.ts` 为准：

- `Manifest`
  - 字段：`source_id`、`source_locator`、`source_kind`、`content_hash`、`canonical_path`、`file_name`、`ingest_status`、`created_at`。
  - 存储：`kb/state/manifests/{source_id}.json`。

- `PageFrontmatter`
  - 必需语义字段：`id`、`type`、`title`、`updated_at`、`status`。
  - 可选：`tags`、`aliases`、`source_ids`、`related` 等。
  - `id` 受 `^[a-z0-9_-]+$` 约束；`status` 仅 `active|stub|deprecated`。

- `PageIndex`
  - 结构：`{ pages: PageIndexEntry[] }`。
  - `PageIndexEntry` 含 `page_id/path/type/title/aliases/tags/headings/body_excerpt`。
  - 用途：`kb_search_wiki` 检索、`kb_read_page` 的 id->path 解析。

## 4. 工具职责（当前行为）

### 4.1 Workflow tools（8 个）

1. `kb_source_add`
- 作用：注册源文件，复制到 `kb/raw/inbox/`，写 manifest。
- 关键行为：按内容 SHA256 生成 `src_sha256_xxx`；按内容哈希去重。
- 现状限制：仅支持 `.md/.txt`（MVP 限制）。

2. `kb_read_source`
- 作用：按 `source_id` 读 manifest，再读 canonical source。
- 关键行为：最大返回 200KB，超限截断并附 warning 文本。

3. `kb_write_page`
- 作用：创建/更新 wiki 页面，并增量维护 `page-index.json`。
- 关键行为：frontmatter 校验、ID 全局唯一性校验、`create_only` 支持、返回 `warnings[]`。

4. `kb_update_section`
- 作用：替换或追加某个 heading section 内容。
- 关键行为：支持 `append` 与 `create_if_missing`；自动更新 `updated_at`；更新 index 对应 `headings/body_excerpt`。

5. `kb_ensure_entry`
- 作用：向 index/log 幂等写入条目。
- 关键行为：`dedup_key` 对应 `<!-- dedup:... -->` 标记；重复调用返回 `already_exists`；支持 anchor heading 定位插入。

6. `kb_search_wiki`
- 作用：基于 `page-index.json` 搜索。
- 关键行为：关键词加权（title/alias/tag/heading/excerpt）、`type_filter`、全量 tag 命中、`resolve_link` 解析 `[[...]]`/`[[id|title]]`。

7. `kb_read_page`
- 作用：按路径或 `page_id` 读取页面，返回 frontmatter 与 body。
- 关键行为：`page_id` 通过 `page-index.json` 解析；拒绝读取 symlink。

8. `kb_commit`
- 作用：在 git 仓库中对配置的 `kb_root` 路径执行 stage 后提交。
- 关键行为：要求 `kb_root` 位于某个 git working tree 内；仅检查该路径的 staged 结果是否为空，再执行 commit。
- 现状 caveat：若提交前已有非 `kb_root` 范围文件 staged，仍可能被同次 commit 带入。

### 4.2 Maintenance tools（3 个）

9. `kb_rebuild_index`
- 作用：扫描 `kb/wiki/**/*.md`，确定性重建 `kb/state/cache/page-index.json`。
- 关键行为：忽略非 markdown 文件；遇到重复 `page_id` 会在写盘前失败；磁盘格式保持 root-compatible 的 `{ pages: [...] }`。

10. `kb_run_lint`
- 作用：输出结构化 KB lint 报告，分离 deterministic findings 与 semantic warnings。
- 关键行为：默认包含 semantic checks；支持 `include_semantic: false`；只读，不写 `kb/` 下任何文件。

11. `kb_repair`
- 作用：仅修复结构性问题，并返回 fix 列表与 repair 后 lint 摘要。
- 关键行为：支持 `dry_run`；写入范围仅限 `kb/wiki/index.md`、`kb/wiki/log.md`、`kb/state/cache/page-index.json`；不会改业务页内容，也不依赖 `kb/state/audit/*`。

## 5. Skills 角色（流程职责）

- `kb_ingest`
  - 面向“新增材料入库”，规定“注册源 -> 阅读 -> 规划 -> 写 source/entity/concept -> 更新 index/log -> commit”流程。
  - 强制关注：`kb_update_section` 默认 replace，追加必须显式 `append: true`。

- `kb_query`
  - 面向“wiki-first 问答”，要求先 `kb_search_wiki` 再 `kb_read_page`（通常 3-5 页）做综合回答。
  - 对高价值结果可回写 `wiki/analyses`，并写 query log（含 `run_id`）。

- `kb_lint`
  - 面向“结构与内容健康检查”，关注 orphan/ghost link/missing cross-reference/stub/contradiction/data gap。
  - 规定完整 lint pass（含 No findings）也必须写 `wiki/log.md`。

结论：tools 是原子操作面，skills 是运营流程面；一致性依赖 skill 执行纪律。

## 6. 关键安全与幂等约束

### 6.1 写入边界与路径安全
- 所有目标路径通过 `resolveKbPath`/`validateWritePath` 收敛在 `kb_root` 内。
- `kb_write_page`、`kb_update_section`、`kb_ensure_entry` 进一步限制必须落在 `kb/wiki/`。
- symlink 防护：
  - `validateWritePath` 使用 `realpath` 防 symlink 越界。
  - `kb_write_page` 禁止 symlink 写目标。
  - `kb_read_page` 禁止 symlink 读目标。

### 6.2 启动与环境安全
- `kb_root` 解析顺序：
  1. `KB_ROOT`
  2. `WORKSPACE_ROOT/kb`
  3. `./kb`（cwd）
- 启动前 guard：`kb_root` 非目录即直接退出码 2，不接入 MCP transport。

### 6.3 幂等与去重
- source 注册幂等：同内容在 `kb_source_add` 直接报 duplicate（返回已有 source_id 信息）。
- index/log 幂等：`kb_ensure_entry` 依赖 `dedup_key` 防重复插入。
- e2e 驱动要求两轮 ingest 后：
  - run2 的 ensure_entry 应全部 `already_exists`。
  - run2 相对 run1 文件内容应无变化（content idempotency）。

### 6.4 提交安全约束（脚本层）
- `scripts/e2e_v2_ingest.ts` 默认在 throwaway temp kb 执行，避免污染真实仓库。
- `--commit` 必须显式 `--kb-root` 且该路径必须是 `<git-top-level>/kb`，拒绝非 git 目录或嵌套子目录 `sub/kb`。

## 7. 验证方式（当前可执行）

### 7.1 基础构建验证
- `npm run typecheck`
- `npm run build`
- `npm run start:mcp`

MCP 启动方式在本轮重构后没有变化，仍然是先 build 再 `npm run start:mcp`。另外当前主线已新增独立 OpenClaw installer（见第 9 节），用于外部 `KB_ROOT` 的 OpenClaw 接入，不替代 `start:mcp`。

### 7.2 端到端验证
- `scripts/e2e_v2_ingest.ts`
  - 覆盖 8 工具完整链路。
  - 执行两轮 ingest，并做读回验证、索引/日志校验、幂等校验。
  - 可选 commit（受强约束）。

### 7.3 安全/幂等专项验证
- `scripts/validate_e2e_v2_ingest_safety.ts`
  - 验证默认模式不修改真实 `kb/`。
  - 验证显式模式 run1/run2 内容幂等（含跨日期）。
  - 验证 commit guard 拒绝非法目标。

- `scripts/validate_kb_search_wiki_resolve_link.ts`
  - 验证 `resolve_link` 行为，包括：
    - `[[id]]`、`[[title]]`、`[[ id | label ]]` 解析；
    - `[[id|display]]` 取 pipe 左侧目标，避免误解 display text。

## 8. 当前技术债 / 未完成项

1. `kb_source_add` 文件类型仍是 MVP 范围（仅 `.md/.txt`），对 PDF/HTML/Office 等源无原生接入。
2. `kb_commit` 只执行对配置 `kb_root` 范围的 stage，但无法隔离“已预先 staged 的非 `kb_root` 文件”被一并提交的风险。
3. frontmatter 解析器是轻量实现（`parseSimpleYaml`），并非完整 YAML 解析器，复杂 YAML 语法兼容性有限。
4. `page-index.json` 是增量维护模型；若页面被工具外手动删除/改名，索引可能漂移，需要 lint/重建机制兜底。
5. `kb_search_wiki` 基于索引字段做轻量打分检索，不是全文/语义检索，召回与排序能力有限。
6. `kb_run_lint` / `kb_repair` 已成为独立 MCP 工具，但 README 与流程文档仍需持续保持与 tool surface 同步，避免再次出现“8 tools”类滞后描述。
7. e2e ingest 驱动为测试目的使用文件名关键词和占位模板生成页面，不代表生产级内容理解质量。
8. 历史样例未全部回填到 `kb/raw/inbox/` 与 `kb/state/manifests/`；溯源完整性应以具体 `source_id` 是否存在 manifest 为准。

## 9. OpenClaw Installer（当前主线）

### 9.1 命令面与入口
- 编译产物入口：`dist/openclaw_installer.js`
- package script：`npm run start:openclaw-installer`
- bin：`kb-openclaw-installer`
- 命令面：
  - `install --workspace <path> --kb-root <path> [--agent-id <id>] [--mcp-name <name>] [--force]`
  - `check --workspace <path> [--agent-id <id>] [--mcp-name <name>] [--json]`
  - `repair --workspace <path> [--kb-root <path>] [--agent-id <id>] [--mcp-name <name>] [--force]`
  - `uninstall --workspace <path> [--agent-id <id>] [--mcp-name <name>] [--force]`

### 9.2 操作命令（精确示例）

```bash
node dist/openclaw_installer.js install --workspace /absolute/path/to/target-workspace --kb-root /absolute/path/to/external-kb --agent-id llmwiki --mcp-name llm-kb
node dist/openclaw_installer.js check --workspace /absolute/path/to/target-workspace --agent-id llmwiki --mcp-name llm-kb --json
node dist/openclaw_installer.js repair --workspace /absolute/path/to/target-workspace --kb-root /absolute/path/to/external-kb --agent-id llmwiki --mcp-name llm-kb
node dist/openclaw_installer.js uninstall --workspace /absolute/path/to/target-workspace --agent-id llmwiki --mcp-name llm-kb
```

### 9.3 当前实现约束（必须知晓）

1. 显式 workspace 绑定与 fail-closed
- `install/check/repair/uninstall` 都要求显式 `--workspace`。
- `install/check/repair/uninstall` 都要求显式 `--workspace`，并使用显式或默认的 `--agent-id` 选择 configured OpenClaw agent。
- 默认 `--agent-id` 是 `llmwiki`，但不是唯一支持对象；缺失绑定、歧义绑定或不匹配时 fail-closed。

2. `KB_ROOT` 是外部且显式的契约
- `install` 强制 `--kb-root`；`repair` 可从 manifest/MCP 配置恢复，也可显式传入。
- `KB_ROOT` 指向已安装 `kb` 目录本体（`<KB_ROOT>/raw|wiki|schema|state`），工具相对路径如 `wiki/index.md`、`wiki/log.md` 都在该根下解析；不是 `<KB_ROOT>/kb/...`，也不是 workspace-local `kb/`。
- 卸载不会删除外部 `KB_ROOT` 内容，只清理 installer-owned 的 workspace 工件与 MCP 注册。

3. 安装 skill 为 OpenClaw 适配变体
- 安装目标：`<workspace>/skills/kb_ingest|kb_query|kb_lint/SKILL.md`
- 版本集合：`openclaw-adapted-v1`
- 适配规则：不依赖宿主机 `kb/...` 直接读文件，不自动执行 `kb_commit`。

4. `kb_commit` 不属于默认 external-KB contract
- MCP surface 仍包含 `kb_commit` 工具（兼容当前主线工具面），但 installer 下发的默认 skill 工作流不把 `kb_commit` 作为自动步骤。

5. repo-path coupling 与冲突保守策略
- manifest 记录 `repoRoot`，且期望 MCP 配置固定指向 `<repoRoot>/dist/mcp_server.js` + `KB_ROOT`；移动 repo 或 build 产物缺失会触发 drift。
- 冲突（manifest ownership、MCP config、skill 内容/目录）默认拒绝覆盖并 fail-closed，只有显式 `--force` 才允许覆盖。
- OpenClaw 可用性成功判据是 configured OpenClaw agent 会话可见 canonical `kb_*`；仅保存 MCP 配置不足以代表可用。standalone MCP 只作为兼容/调试路径。

## 10. 与历史文档关系

仓库中的历史计划与评审文档（例如 `archived/plans/development-plan-v2.md`）仅用于背景追溯；当前工程事实以 README、`src/` 实现、`skills/` 规范与 `scripts/` 验证脚本为准。
