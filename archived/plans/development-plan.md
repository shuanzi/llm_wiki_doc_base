# OpenClaw 知识库系统 — 开发计划

> 基于 `openclaw_kb_architecture_plan.md` 原始方案，经两轮 review 调整后的最终开发计划。

---

## 1. 项目概述

构建一套基于 OpenClaw 的"LLM 持续维护型知识库"系统：

- **raw sources** 为事实底座
- **wiki** 为持续演化的知识层
- **schema** 为规则层
- **OpenClaw skills + tools** 为执行层
- **native plugin** 为分发与集成层
- **workspace 文件系统 + Git** 为可审计落盘层

核心闭环：`添加资料 → 生成 plan → 渲染 draft → 应用 patch → 搜索 wiki → 回答 → Git 留痕`

---

## 2. 设计原则（含 review 修正）

### 2.1 Patch-first

所有涉及 `kb/wiki/` 的多文件知识变更，都先生成 Patch Plan，再渲染内容，再确定性落盘。
例外：`kb_source_add` 可先登记 `kb/raw/` 中的原始资料与 manifest。

### 2.2 Raw 只读，Wiki 可编辑

- `kb/raw/`：事实底座，只读或追加
- `kb/wiki/`：知识层，可被持续维护

### 2.3 Skills 负责编排，Tools 负责确定性动作

- **Skill**：告诉 agent 什么时候做什么（编排逻辑）
- **Tool**：确定性、可测试、可幂等的动作
- **Plugin**：工具与资源的分发形态

> **review 修正**：内容生成（LLM 调用）由专用 tool `kb_draft_patch` 承担并持久化产出物，不在 skill 层 ad hoc 完成。这确保了审计链的完整性。

### 2.4 文件系统是事实层，LLM 不是事实层

知识库最终状态必须体现在文件系统中。

### 2.5 Git 是审计与回滚底座

出错可回滚比永不出错更重要。

### 2.6 标识优先于路径

- 页面以 frontmatter 中的 `id` 作为权威标识，文件路径只是可变投影
- `source_id` 使用稳定指纹：`src_sha256_<8位hash前缀>`（保留算法标识）
- patch 支持 `move` / `rename` 语义

### 2.7 写目标路径校验（纵深防御）

> **review 新增**：所有 tool 实现内部必须校验——写目标（write destinations）和 wiki 相对路径参数必须解析到 `workspace/kb/**` 范围内；外部 source locator（URL、外部文件路径）作为只读输入允许传入，但不得作为写入目标。不依赖宿主层单一限制。

---

## 3. 工作区目录结构

```
workspace/
  AGENTS.md
  kb/
    raw/
      inbox/              # 待处理资料
      processed/          # 已归档资料
      assets/             # 图片、附件、原文副本
    wiki/
      index.md            # 总索引（人类导航）
      log.md              # 变更日志
      entities/           # 人物、组织、产品等实体页
      concepts/           # 概念、方法、主题页
      sources/            # 每篇原始资料对应的摘要页
      analyses/           # 问答沉淀出的分析页
      reports/
        index.md          # 报告目录页
    schema/
      page-types/
      templates/
      vocab/
      lint-rules.yaml
      version.yaml        # schema 版本（仓库级唯一权威）
    state/
      plans/              # kb_plan_ingest 输出（status: planned）
      drafts/             # kb_draft_patch 输出（status: drafted）
      applied/            # kb_apply_patch 完成后移入（status: applied）
      failed/             # kb_apply_patch 失败后移入（status: failed）
      manifests/          # source 元数据
      runs/               # 任务执行记录 + in_progress 标记（dirty check 排除此目录）
      cache/
        page-index.json   # 机器检索索引
```

> **review 修正**：
> - 原方案的 `kb/state/patches/` 拆分为 `plans/` / `drafts/` / `applied/` 三个目录，对应 patch 生命周期的三个状态
> - 新增 `page-index.json` 作为机器检索索引，与 `index.md`（人类导航）职责分离
> - 新增 `schema/version.yaml` 作为仓库级 schema 版本

---

## 4. 工具面设计

### 4.1 MVP 工具清单（7 个）

原方案 MVP 为 6 个工具，review 后调整为 7 个：

| 工具 | 职责 | 确定性 |
|------|------|--------|
| `kb_source_add` | 注册 source（MVP 仅支持 .md/.txt），写入 raw，生成 manifest | 是 |
| `kb_plan_ingest` | 根据 source + wiki 上下文输出结构化 plan | 否（LLM） |
| `kb_draft_patch` | 将 plan 渲染为完整 patch payload 并归档 | 否（LLM） |
| `kb_apply_patch` | 确定性写入文件 + 同步更新 page-index.json | 是 |
| `kb_search_wiki` | 基于 page-index.json 搜索页面 | 是 |
| `kb_read_page` | 精读页面，返回 frontmatter + 正文 | 是 |
| `kb_commit` | 提交 Git | 是 |

### 4.2 Phase 2 工具

| 工具 | 职责 |
|------|------|
| `kb_source_parse` | 复杂格式解析（PDF、富文本等） |
| `kb_run_lint` | wiki 健康度巡检（注意：skill 名为 `kb_lint`，tool 名为 `kb_run_lint`） |
| `kb_repair` | 根据 lint 报告做修复 |
| `kb_rebuild_index` | 从 `kb/wiki/` 全量重建 `page-index.json`（灾难恢复用） |

---

## 5. 各工具详细设计

### 5.1 `kb_source_add`

**MVP 支持的输入格式**：
- `.md`（Markdown 文件）
- `.txt`（纯文本文件）

**后续扩展**（不在 MVP 范围内）：
- URL / 网页正文
- 粘贴文本
- PDF / 富文本 / 附件等（配合 Phase 2 的 `kb_source_parse`）

**输出**：`source_id`、保存位置、`content_hash`、初始 metadata

**职责**：
- 校验输入文件格式为 `.md` 或 `.txt`，其他格式拒绝并提示"当前版本不支持"
- 写入 `kb/raw/inbox/` 或 `kb/raw/processed/`
- 生成 `kb/state/manifests/<source_id>.json`
- 去重（基于规范化内容 hash + canonical locator）
- 同一 source 二次导入复用既有 `source_id`
- MVP 中同时承担基础文本规范化
- 格式分发设计上预留扩展点，后续通过 `source_kind` 字段路由到不同解析逻辑

**`source_id` 格式**：`src_sha256_<hash前缀>`（默认 8 位，碰撞时自动扩展到 12 位）

**manifest 必填字段**：
```json
{
  "source_id": "src_sha256_8f3a1c2d",
  "source_locator": "/path/to/input/article.md",
  "source_kind": "markdown",
  "content_hash": "sha256:8f3a1c2d...",
  "canonical_path": "kb/raw/processed/src_sha256_8f3a1c2d.md",
  "ingest_status": "registered"
}
```

### 5.2 `kb_plan_ingest`

**输入**：`source_id` + 当前 wiki 上下文

**输出**：结构化 plan JSON（不含内容正文）

```json
{
  "plan_id": "plan_20260408_8f3a1c2d",
  "source_id": "src_sha256_8f3a1c2d",
  "status": "planned",
  "create": [
    {
      "page_id": "source_src_sha256_8f3a1c2d",
      "path": "kb/wiki/sources/src_sha256_8f3a1c2d.md",
      "kind": "source_summary"
    }
  ],
  "update": [
    { "path": "kb/wiki/index.md", "reason": "link new source summary" },
    { "path": "kb/wiki/log.md", "reason": "record ingest event" }
  ],
  "moves": [],
  "delete": [],
  "conflicts": [],
  "risk_level": "low",
  "notes": ""
}
```

**落盘位置**：`kb/state/plans/<plan_id>.json`

**MVP 收敛**：只生成 source 摘要页 + `index.md` / `log.md` 更新。不自动生成 concept / entity / analysis 页。

### 5.3 `kb_draft_patch`（review 新增）

**输入**：plan JSON

**输出**：完整 patch payload（含 markdown 正文）

**职责**：
- 根据 plan 中的 `create` 条目，调用 LLM 生成 wiki 页面正文
- 根据 plan 中的 `update` 条目，生成 `index.md` / `log.md` 的更新内容
- 产出**最终、完整、可回放**的文件变更集合——`kb_apply_patch` 不再生成任何内容
- 归档完整 draft 到 `kb/state/drafts/<plan_id>.json`

**draft 输出结构**：
```json
{
  "plan_id": "plan_20260408_8f3a1c2d",
  "status": "drafted",
  "files": [
    {
      "action": "create",
      "path": "kb/wiki/sources/src_sha256_8f3a1c2d.md",
      "content": "---\nid: source_src_sha256_8f3a1c2d\ntype: source\n..."
    },
    {
      "action": "ensure_entry",
      "path": "kb/wiki/index.md",
      "entry": "- [src_sha256_8f3a1c2d](sources/src_sha256_8f3a1c2d.md)",
      "anchor": "## Sources",
      "dedup_key": "src_sha256_8f3a1c2d"
    },
    {
      "action": "ensure_entry",
      "path": "kb/wiki/log.md",
      "entry": "- 2026-04-08: ingest src_sha256_8f3a1c2d — added source summary",
      "anchor": null,
      "dedup_key": "src_sha256_8f3a1c2d"
    }
  ]
}
```

**操作语义**：
- `create`：创建新文件，文件已存在则报错
- `ensure_entry`：幂等插入——按 `dedup_key` 检查目标文件中是否已存在该条目，存在则跳过，不存在则在 `anchor`（指定的标题/位置）之后插入。如 `anchor` 为 null 则追加到文件末尾
- `overwrite`：覆盖整个文件（用于 Phase 2 的大改场景）

> **设计理由**：
> 1. `kb_draft_patch` 是审计链上最后一个人工可 review 的稳定产物。draft 即为最终可执行变更集，`kb_apply_patch` 不再生成任何内容。
> 2. 使用 `ensure_entry` 替代 `append`，保证重试安全——即使 apply 中途失败后重试，也不会在 `index.md` / `log.md` 中产生重复条目。

### 5.4 `kb_apply_patch`

**输入**：draft JSON

**定位**：纯执行器。不生成任何内容，只校验、写入、迁移状态、同步索引。

**前置检查**：
- `git status --porcelain -- kb/` 确认 kb 路径下 worktree 干净，**但排除 `kb/state/runs/`**（避免残留 in_progress 标记导致死锁）
- 在 `kb/state/runs/` 写入 `<run_id>_in_progress.json` 标记（结构见下文）

**职责**：
- 按 draft 中的 `files` 列表确定性执行（`create` / `ensure_entry` / `overwrite`）
- 同步更新 `kb/state/cache/page-index.json`
- 将 draft 从 `kb/state/drafts/` 移入 `kb/state/applied/`
- 删除 `<run_id>_in_progress.json` 标记
- 支持 dry-run 模式

**`in_progress.json` 结构**：

```json
{
  "run_id": "run_20260408_001",
  "plan_id": "plan_20260408_8f3a1c2d",
  "started_at": "2026-04-08T10:30:00Z",
  "completed_files": [
    { "path": "kb/wiki/sources/src_sha256_8f3a1c2d.md", "op": "created" },
    { "path": "kb/wiki/index.md", "op": "modified" }
  ]
}
```

每完成一个文件写入，立即追加到 `completed_files`，并标记操作类型（`created` / `modified`）。这使得恢复操作能按类型正确处理。

**失败处理与恢复**：

apply 中途失败时：
1. draft 移入 `kb/state/failed/`（不留在 `drafts/`，物理隔离）
2. `in_progress.json` 保留

下次运行检测到残留 `in_progress` 时，提供三种处理路径：
- **resume**：读取 `in_progress.json`，跳过已完成文件，继续执行剩余操作
- **rollback**：按操作类型分别处理——对 `modified` 文件执行 `git checkout -- <file>` 恢复；对 `created` 文件执行删除（因为新建文件尚未被 Git 跟踪，`git checkout` 无法处理）
- **force-clear**：清除 `in_progress` 标记，由用户手动处理（适合用户已通过 git 自行恢复的情况）

系统默认行为：提示用户选择，不自动执行任何恢复操作。

> **review 修正**：
> - dirty check 排除 `kb/state/runs/`，避免残留标记导致恢复死锁
> - `failed` 状态的 draft 移入独立的 `kb/state/failed/` 目录，与待应用的 `drafts/` 物理隔离
> - 定义了 resume / rollback / force-clear 三种恢复路径
> - `in_progress.json` 中按操作类型（`created` / `modified`）记录已完成文件，rollback 据此分别处理

### 5.5 `kb_search_wiki`

**输入**：query、page type filter、tags

**输出**：匹配页面列表 + 摘要 + 相关度说明

**实现**：基于 `kb/state/cache/page-index.json` 做关键词匹配和 type/tag 过滤

**索引字段**：
```json
{
  "pages": [
    {
      "page_id": "source_src_sha256_8f3a1c2d",
      "path": "kb/wiki/sources/src_sha256_8f3a1c2d.md",
      "type": "source",
      "title": "...",
      "aliases": [],
      "tags": ["ml", "architecture"],
      "headings": ["TL;DR", "Key facts", "Sources"],
      "body_excerpt": "前200字正文摘要..."
    }
  ]
}
```

> **review 修正**：
> - `index.md` = 人类导航，`page-index.json` = 机器检索，职责明确分离
> - `kb_apply_patch` 每次写入后同步更新索引（正常路径），`kb_rebuild_index` 仅用于灾难恢复
> - 索引字段包含 `page_id`、`path`、`type`、`title`、`aliases`、`tags`、`headings`、`body_excerpt`

### 5.6 `kb_read_page`

**输入**：page path 或 page_id

**输出**：frontmatter + 正文分离结构

### 5.7 `kb_commit`

**输入**：变更描述

**commit message 模板**：
```
kb: ingest src_sha256_8f3a1c2d and create source summary
kb: update concept pages from src_sha256_8f3a1c2d
kb: repair orphan pages and broken links
```

> **review 修正**：commit message 中统一使用 `src_sha256_<prefix>` 格式，不再使用时间戳格式 `src_20260408_001`。

---

## 6. Skills 设计

### 6.1 MVP Skills（2 个）

#### `kb_ingest`

触发："把这篇文章纳入知识库"

执行链：
1. `kb_source_add` → 注册 source，获得 `source_id`
2. `kb_plan_ingest` → 生成结构化 plan
3. `kb_draft_patch` → 渲染完整 patch payload 并归档
4. 高风险任务：先展示 patch 摘要等待确认
5. `kb_apply_patch` → 确定性写入
6. `kb_commit` → Git 留痕

约束：
- 不能绕过 plan → draft → apply 流程直接写 wiki
- 必须更新 `log.md`
- 新页面必须被 `index.md` 或某父页面引用

#### `kb_query`

触发："根据知识库回答这个问题"

执行链：
1. `kb_search_wiki` → 索引召回
2. `kb_read_page` → 精读相关页面
3. 基于 wiki 组织回答
4. 如果答案缺乏充分依据，明确说明

约束：
- 先读 wiki，不确定时说明"当前 wiki 未沉淀充分"
- 不允许把猜测包装成已知事实

> **review 修正**：当查询命中多个相关 source 页时，建议用户手动触发 `kb_ingest` 来沉淀 concept 页，而不是自动创建。

### 6.2 Phase 2 Skills

#### `kb_lint`

执行链：
1. 调用 `kb_run_lint` tool
2. 汇总问题
3. 建议调用 `kb_repair`

> **review 修正**：skill 名 `kb_lint`，tool 名 `kb_run_lint`，避免命名冲突。

#### `kb_repair`

执行链：
1. 读取 lint 报告
2. 生成小 patch
3. `kb_apply_patch`
4. `kb_commit`

---

## 7. Patch 生命周期（review 新增）

Patch 经历三个显式状态，分别存储在不同目录：

```
planned  →  drafted  →  applied
                    ↘  failed
```

| 状态 | 存储位置 | 触发工具 |
|------|----------|----------|
| `planned` | `kb/state/plans/` | `kb_plan_ingest` |
| `drafted` | `kb/state/drafts/` | `kb_draft_patch` |
| `applied` | `kb/state/applied/` | `kb_apply_patch` 成功时 |
| `failed` | `kb/state/failed/` | `kb_apply_patch` 失败时 |

**唯一真相源**：文件所在目录为权威状态。JSON 中的 `status` 字段为冗余镜像，仅用于调试与展示。当目录位置与 `status` 字段不一致时，以目录为准。

每个 patch JSON 都携带 `status` 字段，可追溯从结构规划到内容渲染到最终落盘的完整链路。

---

## 8. Schema 版本管理

### 8.1 版本文件

`kb/schema/version.yaml`：
```yaml
schema_version: 1
min_compatible_version: 1
schema_effective_from: 2026-04-08    # 当前 schema 版本的生效日期
migration_grace_until: null          # 升级时设为截止日期，如 2026-06-01
```

### 8.2 规则

- 仓库级 `version.yaml` 为权威版本
- 页面级增加可选字段 `schema_migrated_at`（ISO 日期），记录该页面最后一次通过 schema 迁移检查的时间
- `kb_run_lint` 检查逻辑：
  - 有 `schema_migrated_at` 且日期 ≥ `schema_effective_from` → 按当前 schema 检查
  - 无 `schema_migrated_at` 或日期早于 `schema_effective_from` → 在 `migration_grace_until` 之前报 warning，之后报 error
- 迁移操作通过 `kb_repair` 批量处理，成功后写入 `schema_migrated_at`

---

## 9. Wiki 页面 Schema

### 9.1 MVP 页面类型（6 种）

`source` / `concept` / `entity` / `analysis` / `index` / `report`

### 9.2 Frontmatter 规范

```yaml
---
id: concept_transformer         # canonical identifier
type: concept                   # 页面类型
title: Transformer
aliases: []
source_ids: [src_sha256_8f3a1c2d]
updated_at: 2026-04-08
status: active                  # active / stub / deprecated
tags: [ml, architecture]
schema_migrated_at: 2026-04-08  # 可选，最后一次 schema 迁移检查通过的日期
related:
  - concept_attention
---
```

### 9.3 正文结构

```markdown
# {title}

## TL;DR
...

## Key facts
- ...

## Conflicts / ambiguities
- ...

## Open questions
- ...

## Related
- ...

## Sources
- src_sha256_8f3a1c2d
```

---

## 10. 安全边界

### 10.1 Native plugin 信任边界

- native plugin 运行在 Gateway 进程内，不被 sandbox
- `openclaw-kb` 必须私有部署、自研或完全审计后使用

### 10.2 路径校验（纵深防御）

- 宿主层限制：只允许访问 `workspace/kb/**`
- Tool 层校验：每个 tool 内部校验写目标路径在 `workspace/kb/**` 范围内
- 外部 source locator（URL、外部文件路径）作为只读输入允许传入，不得作为写入目标

### 10.3 密钥管理

secrets 不得出现在 `AGENTS.md`、`SKILL.md`、prompt 模板、任务日志中。

---

## 11. MVP 验收标准

至少做到：

- [ ] 能导入一篇 `.md` 或 `.txt` 文件
- [ ] 能创建 source 摘要页
- [ ] 能更新 `index.md` 与 `log.md`
- [ ] 能生成 plan → draft → applied 完整 patch 存档链
- [ ] 能基于 `page-index.json` 搜索并回答问题
- [ ] 能留下 Git commit 作为审计记录
- [ ] `kb_apply_patch` 在 kb/ dirty 时拒绝执行（排除 `kb/state/runs/`）
- [ ] `kb_apply_patch` 失败后能通过 resume / rollback / force-clear 恢复
- [ ] `index.md` / `log.md` 的更新操作可安全重试（`ensure_entry` 幂等）
- [ ] 所有写操作的目标路径经过 `workspace/kb/**` 校验

---

## 12. 开发顺序

### Phase 0：平台验证 spike（开发前必须完成）

- [ ] 验证 OpenClaw `register(api)` / `api.registerTool()` 接口稳定性
- [ ] 验证 skill 与 tool 命名空间是否隔离
- [ ] 验证 workspace 路径限制是否可配置
- [ ] 确认官方文档 URL 可访问且内容与方案描述一致
- [ ] 如果 spike 发现关键接口不稳定，收敛到纯 skill + 文件系统方案

### Phase 1：单用户本地版（MVP）

**目标**：跑通闭环

**步骤**：
1. 建立 `kb/` 文件树与 `AGENTS.md`
2. 实现 `kb_source_add`（含基础文本规范化）
3. 实现 `kb_plan_ingest`
4. 实现 `kb_draft_patch`
5. 实现 `kb_apply_patch`（含 page-index.json 同步更新、dirty 检查）
6. 实现 `kb_search_wiki` + `kb_read_page`
7. 实现 `kb_commit`
8. 编写 `kb_ingest` / `kb_query` 两个 skill
9. 跑通单篇 source ingest + query 完整闭环
10. 验收

**交付物**：
- `kb/` 目录结构
- 7 个 MVP tools
- 2 个 MVP skills
- `AGENTS.md`
- Git 集成

### Phase 2：质量控制版

**目标**：可维护

**交付物**：
- `kb_source_parse`（复杂格式）
- `kb_run_lint` + `kb_repair`
- `kb_rebuild_index`（灾难恢复）
- `kb_lint` / `kb_repair` skills
- patch `move` / `rename` + 链接重写
- 审核模式（auto-apply / review-before-apply）
- 目录级 `_index.md` + 按月分文件 log（顶层文件降级为聚合页）
- schema migration grace period 机制
- 自动 concept / entity 页创建（配合 stub 清理规则）

### Phase 3：增强检索版

**目标**：适合大知识库

**交付物**：
- 全文索引
- hybrid search
- 更强页面召回
- 自动建议沉淀 analysis
- raw fallback 查询（核验原文细节）

### Phase 4：团队协作版

**目标**：多人使用

**交付物**：
- 审核工作流
- 分支与权限控制
- 页面评论 / 批注
- 冲突合并策略

### Phase 5：Bundle 兼容版

**目标**：跨生态复用

**交付物**：
- 抽出 bundle 元数据
- 兼容 Codex / Claude / Cursor 可识别内容包
- 保留 native plugin 作为主实现

---

## 13. Review 修正记录

以下为相对原方案的关键修正，供审阅对照：

| # | 修正项 | 原方案 | 修正后 | 来源 |
|---|--------|--------|--------|------|
| 1 | 内容生成归属 | 未明确 | 新增 `kb_draft_patch` tool，LLM 产出物持久化到 `kb/state/drafts/` | Review R1 + Codex R1 |
| 2 | Patch 生命周期 | 单一 `patches/` 目录 | 拆为 `plans/` → `drafts/` → `applied/`，显式状态机 | Codex R2 |
| 3 | 搜索索引 | 未指定实现 | `page-index.json`（机器检索）+ `index.md`（人类导航）职责分离 | Review R1 + Codex R1/R2 |
| 4 | 索引新鲜度 | 未定义 | `kb_apply_patch` 同步更新，`kb_rebuild_index` 仅灾难恢复 | Codex R2 |
| 5 | source_id 格式 | 混用时间戳和 hash | 统一为 `src_sha256_<prefix>`，保留算法标识 | Review R1 + Codex R1 |
| 6 | tool/skill 重名 | `kb_lint` 同名 | tool 改为 `kb_run_lint`，skill 保持 `kb_lint` | Review R1 + Codex R1 |
| 7 | index.md / log.md | 单文件，MVP 和后续不分 | MVP 保持单文件；Phase 2 引入目录级 index + 按月 log | Codex R1 |
| 8 | Dirty worktree 检查 | 无 | `git status --porcelain -- kb/`，仅检查 kb 路径 | Review R1 + Codex R2 |
| 9 | 事务标记 | 无 | `in_progress.json` 标记 + 残留检测 | Codex R2 |
| 10 | Schema 版本 | 无 | 仓库级 `version.yaml` + `migration_grace_until` 过渡期 | Review R1 + Codex R1/R2 |
| 11 | 路径校验 | 仅提及宿主层 | 纵深防御：宿主层 + tool 层双校验，区分读输入和写目标 | Codex R1/R2 |
| 12 | MVP 查询闭环 | 弱（仅 source 页） | 保持 MVP 不自动创建 concept，但 skill 建议用户手动沉淀 | Codex R1 |
| 13 | Phase 0 spike | 无 | 开发前必须验证 OpenClaw 平台能力 | Review R1 |
| 14 | draft/apply 职责边界 | 两处都声称负责 index/log 生成 | `kb_draft_patch` 产出最终完整变更集，`kb_apply_patch` 纯执行不生成内容 | Dev Plan Review R1 |
| 15 | append 幂等性 | `append` 操作重试会重复 | 替换为 `ensure_entry`（按 dedup_key 去重） | Dev Plan Review R1 |
| 16 | 失败恢复语义 | in_progress 标记导致死锁 | dirty check 排除 `kb/state/runs/`；定义 resume/rollback/force-clear 三种恢复路径 | Dev Plan Review R1 |
| 17 | 状态机真相源 | 目录 + JSON 双重表达 | 目录位置为唯一权威，JSON status 为冗余镜像；failed 独立目录 | Dev Plan Review R1 |
| 18 | Schema 迁移标记 | 无页面级标记 | 新增可选 `schema_migrated_at` 字段，lint 据此判断是否在 grace period 内 | Dev Plan Review R1 |
| 19 | source_id 碰撞 | 固定 8 位无碰撞策略 | 默认 8 位，碰撞时自动扩展到 12 位 | Dev Plan Review R1 |
| 20 | rollback 不完整 | 统一用 `git checkout` 回退 | `in_progress.json` 按操作类型（`created`/`modified`）记录，rollback 对 modified 用 git 恢复、对 created 执行删除 | Dev Plan Review R2 |
| 21 | schema 生效日缺失 | lint 规则引用未定义字段 | `version.yaml` 新增 `schema_effective_from`，lint 用它与 `schema_migrated_at` 比较 | Dev Plan Review R2 |
