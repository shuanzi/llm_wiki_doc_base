# OpenClaw 知识库系统 — V2 开发计划

> 基于 v1 实现经验 + llm-wiki.md 原始 idea 对照审阅，重新设计的 v2 架构方案。
> 核心转变：从"确定性文档归档系统"到"LLM 驱动的知识编译系统"。

---

## 1. V1 回顾与 V2 动机

### 1.1 V1 做到了什么

- 完整的 plan → draft → apply 确定性管道
- 安全：路径校验、symlink 防护、plan_id 注入防护
- 幂等性：ensure_entry + dedup_key
- 崩溃恢复：in_progress.json + resume/rollback
- 经过 3 轮 Codex 审查 + 22 篇真实文档 E2E 测试

### 1.2 V1 的根本问题

对照 llm-wiki.md 原始 idea，V1 是一个 **文档归档系统**，不是 **知识编译系统**：

| llm-wiki idea | V1 实际行为 |
|--------------|------------|
| LLM 阅读、提炼、整合知识 | 机械截取前 500 字 |
| 一次 ingest 可能更新 10-15 个页面 | 固定 3 个操作：source 页 + index + log |
| Entity / Concept 页面持续更新 | 不存在 |
| 页面间交叉引用 | 不存在 |
| Query 结果可回写 wiki | 不支持 |
| Lint 健康检查 | 不存在 |

**根因**：plan_ingest 和 draft_patch 用确定性代码做了本该由 LLM 做的工作（理解、提炼、关联），导致 LLM 的知识整合能力被完全绕过。

### 1.3 V2 核心思路

```
V1: Agent → [source_add] → [plan_ingest] → [draft_patch] → [apply_patch] → [commit]
                              代码决定写什么     代码生成内容      代码写入

V2: Agent → [source_add] → [read_source] → LLM 理解 + 决策 → [write_page]×N → [commit]
                                            Agent 自身完成       工具只管写入
```

**Tools = 确定性 I/O + 状态管理**（手）
**Skills = 工作流指导**（方法论）
**LLM Agent = 知识整合**（大脑）

---

## 2. 设计原则

### 2.1 LLM 主导内容，工具主导 I/O

工具不生成内容。工具负责：读文件、写文件、校验安全、维护索引。
LLM Agent 负责：阅读理解、提取知识、决定写什么、生成页面内容。

### 2.2 结构化 Frontmatter + 自由格式 Body

Frontmatter 是页面间的结构化契约（搜索、Dataview、lint 依赖它），必须校验。
Body 是知识内容，LLM 全权负责，工具不干预。

### 2.3 Wikilink 优先

页面间引用使用 `[[wikilinks]]` 格式：
- Obsidian graph view 依赖此格式构建关系图
- LLM 写 `[[RISC-V]]` 比 `[RISC-V](../entities/risc_v.md)` 简单且不易出错
- 重命名/移动页面时 Obsidian 自动更新链接

### 2.4 交互式审核替代中间态

不再通过 plan/draft JSON 做审核。LLM 在 skill 指导下：
- 先向用户说明计划变更
- 等用户确认或调整
- 再执行写入

Git commit 提供完整审计历史。

### 2.5 沿用 V1 的安全设计

- 所有写路径必须解析到 `kb/` 范围内
- realpath symlink 校验
- ID 注入防护（validateSafeId）
- 文件系统是事实层，Git 是审计底座

---

## 3. 工作区目录结构

```
workspace/
  kb/
    raw/
      inbox/              # 注册后的源文件副本
      processed/          # （预留）已完成 ingest 的源文件
      assets/             # 图片、附件
    wiki/
      index.md            # 总索引（人类导航 + LLM 导航入口）
      log.md              # 变更日志（时间线）
      entities/           # 实体页：人物、组织、技术、产品
      concepts/           # 概念页：方法、理论、主题
      sources/            # 源摘要页：每篇源文件的 LLM 提炼摘要
      analyses/           # 分析页：query 回写的比较、综合、深度分析
      reports/            # 报告页：lint 报告、专题报告
        index.md
    schema/
      version.yaml        # schema 版本
      wiki-conventions.md # wiki 约定文档（LLM 行为指南）★ 新增
    state/
      manifests/          # source 元数据
      cache/
        page-index.json   # 机器检索索引
```

**V2 变更**：
- 删除 `state/plans/`、`state/drafts/`、`state/applied/`、`state/failed/`、`state/runs/`（plan/draft/apply 管道废弃）
- 新增 `schema/wiki-conventions.md`（替代 V1 中 schema 层的定位缺失）

---

## 4. 页面格式规范

### 4.1 Frontmatter Schema

```yaml
---
id: risc_v                          # 必填 | 全局唯一标识
type: entity                        # 必填 | 核心类型: source, entity, concept, analysis, index, report
title: RISC-V                       # 必填 | 页面标题
updated_at: 2026-04-11              # 必填 | 最后更新日期（ISO 格式）
status: active                      # 必填 | active, stub, deprecated
tags: [architecture, open-source]   # 可选 | 自由标签
aliases: [RISC-V ISA, riscv]        # 可选 | 别名（支持 [[别名]] 链接 + 搜索匹配）
source_ids: [src_sha256_xxx]        # 可选 | 关联的源文件 ID
related: [U-Boot, TEE]              # 可选 | 相关页面（wikilink 目标）
---
```

**校验规则**：
- `id`：必填，仅允许 `[a-z0-9_-]`，全局唯一
- `type`：必填，核心类型做目录映射校验，自定义类型允许但发出 warning
- `title`、`updated_at`、`status`：必填
- 其余字段可选，不校验内容

### 4.2 Body 约定（skill 层指导，不在工具中强制）

```markdown
# {title}

{LLM 写的摘要/正文，自由格式}

## 关联
- [[Entity A]] — 关系说明
- [[Concept B]] — 关系说明

## 来源
- 基于 [[src_sha256_xxx|Source Title]]
```

### 4.3 index.md 格式

```markdown
## Sources
- [[src_sha256_xxx|Docker on RISC-V]] — RISC-V 上运行 Docker 容器的实践指南

## Entities
- [[risc_v|RISC-V]] — 开源指令集架构（5 sources）

## Concepts
- [[secure_boot|安全启动]] — TEE 与信任链（3 sources）

## Analyses
- [[riscv_security_comparison|RISC-V 安全方案对比]] — 三种安全方案的优劣分析
```

每个条目包含：wikilink + 一行摘要 + 可选的 source 计数。

### 4.4 log.md 格式

```markdown
## [2026-04-11] ingest | Docker Containers on RISC-V Architecture
- 新建: [[src_sha256_xxx|Source Summary]]
- 新建: [[risc_v|RISC-V]] (entity)
- 更新: [[docker|Docker]] — 新增 RISC-V 相关段落
- 更新: index.md — 3 entries added
```

结构化前缀 `## [日期] 操作 | 标题`，方便 grep 解析。

---

## 5. 工具层设计

### 5.1 工具总览

| 工具 | 职责 | 确定性 | 变更 |
|------|------|--------|------|
| `kb_source_add` | 注册源文件，去重，创建 manifest | 是 | 保留 |
| `kb_read_source` | 按 source_id 读取原始源内容 | 是 | **新增** |
| `kb_write_page` | 创建/更新 wiki 页面（校验 frontmatter + 刷新索引） | 是 | **新增** |
| `kb_update_section` | 更新页面中的指定 section | 是 | **新增** |
| `kb_ensure_entry` | 幂等追加条目到 index.md / log.md | 是 | **新增**（从 apply_patch 提取） |
| `kb_search_wiki` | 搜索 page-index.json | 是 | 保留，增强 alias 匹配 |
| `kb_read_page` | 读取 wiki 页面，返回 frontmatter + body | 是 | 保留 |
| `kb_commit` | 暂存 kb/ 变更并 git commit | 是 | 保留 |

**删除**：`kb_plan_ingest`、`kb_draft_patch`、`kb_apply_patch`

### 5.2 `kb_source_add`（保留，微调）

沿用 V1 实现。变更：
- 返回值增加 `file_name`（原始文件名，供 LLM 作为标题参考）

```typescript
interface KbSourceAddInput {
  file_path: string;
}
interface KbSourceAddOutput {
  source_id: string;
  content_hash: string;
  canonical_path: string;
  file_name: string;       // 新增
  manifest: Manifest;
}
```

### 5.3 `kb_read_source`（新增）

读取已注册源文件的原始内容。这是 LLM 阅读理解的入口。

```typescript
interface KbReadSourceInput {
  source_id: string;
}
interface KbReadSourceOutput {
  source_id: string;
  source_kind: SourceKind;
  file_name: string;
  content: string;
}
```

**职责**：
- 从 manifest 找到 canonical_path
- 读取并返回完整原文
- 大文件截断保护（>200KB 时返回前 200KB + 警告）

### 5.4 `kb_write_page`（新增，核心工具）

创建或覆盖一个 wiki 页面。LLM 提供完整的页面内容（frontmatter + body），工具负责校验和写入。

```typescript
interface KbWritePageInput {
  path: string;          // 相对于 kb/ 的路径，如 "wiki/entities/risc_v.md"
  content: string;       // 完整的页面内容（--- frontmatter --- + body）
  create_only?: boolean; // true 时如果文件已存在则报错（默认 false，允许覆盖）
}
interface KbWritePageOutput {
  path: string;
  page_id: string;
  action: "created" | "updated";
  warnings: string[];    // 非阻断警告（如未知 type）
}
```

**职责**：
1. 路径安全校验（必须在 `kb/wiki/` 下）
2. 解析 frontmatter，校验必填字段：`id`、`type`、`title`、`updated_at`、`status`
3. `id` 格式校验：仅 `[a-z0-9_-]`
4. `id` 唯一性校验：检查 page-index.json 中是否已有不同路径使用相同 id
5. `type` 校验：核心类型检查目录是否匹配（`source` → `wiki/sources/`），自定义类型发 warning
6. 写入文件（mkdir -p 如需）
7. 刷新 page-index.json（只更新该页面的条目，非全量重建）
8. 返回结果 + warnings

**不做**：
- 不解析或校验 body 内容
- 不检查 wikilinks 是否有效（lint 的工作）
- 不自动生成任何内容

### 5.5 `kb_update_section`（新增）

更新已有页面中的一个 section。用于 ingest 时向 entity/concept 页面追加新源信息，避免 LLM 重写整个页面。

```typescript
interface KbUpdateSectionInput {
  path: string;              // wiki 页面路径
  heading: string;           // section 标题（如 "## 来源"）
  content: string;           // 新的 section 内容（替换该 heading 下到下一个同级 heading 之间的内容）
  append?: boolean;          // true 时追加到 section 末尾而非替换（默认 false）
  create_if_missing?: boolean; // heading 不存在时是否在页面末尾创建（默认 true）
}
interface KbUpdateSectionOutput {
  path: string;
  action: "replaced" | "appended" | "created_section";
}
```

**职责**：
1. 路径校验
2. 读取现有页面
3. 定位 heading（通过 `##` 级别匹配）
4. 替换或追加 section 内容
5. 写回文件
6. 刷新 page-index.json
7. 自动更新 frontmatter 中的 `updated_at`

### 5.6 `kb_ensure_entry`（新增，从 V1 apply_patch 提取）

幂等地向 index.md 或 log.md 追加条目。

```typescript
interface KbEnsureEntryInput {
  path: string;           // 如 "wiki/index.md" 或 "wiki/log.md"
  entry: string;          // 要追加的条目文本
  anchor: string | null;  // 锚点标题（如 "## Sources"），null 时追加到末尾
  dedup_key: string;      // 幂等键
}
interface KbEnsureEntryOutput {
  action: "inserted" | "already_exists";
}
```

沿用 V1 的 dedup_key + `<!-- dedup:key -->` HTML 注释机制。

### 5.7 `kb_search_wiki`（保留，增强）

在 V1 基础上增强：
- **Alias 匹配**：搜索时匹配 `aliases` 字段，`[[RISC-V ISA]]` 能找到 `risc_v.md`
- **Wikilink 解析**：新增 `resolve_link` 模式，输入 `[[页面名]]` 返回对应页面路径
- **返回值增加 aliases 字段**

```typescript
interface SearchQuery {
  query: string;
  type_filter?: string;
  tags?: string[];
  limit?: number;
  resolve_link?: string;  // 新增：解析 [[wikilink]] 到路径
}
```

### 5.8 `kb_read_page`（保留）

沿用 V1 实现，无变更。

### 5.9 `kb_commit`（保留）

沿用 V1 实现，无变更。

---

## 6. Skill 层设计

### 6.1 `kb_ingest` — 知识整合（重大重设计）

```markdown
---
name: kb_ingest
description: 将新源文件整合到知识库中，创建/更新多个 wiki 页面
user-invocable: true
---

当用户要求添加新源或更新知识库时：

### 第 1 步：注册与阅读
1. `kb_source_add(file_path)` → 获取 source_id
2. `kb_read_source(source_id)` → 获取完整原文
3. 仔细阅读原文，理解核心内容

### 第 2 步：分析与规划（向用户报告）
告诉用户你的分析结果：
- 文档概述（2-3 句话）
- 你将创建的页面（源摘要页 + 新 entity/concept 页）
- 你将更新的已有页面（列出具体页面和更新原因）
- 发现的矛盾或值得注意的关联
等用户确认后继续。

### 第 3 步：写入源摘要页
`kb_write_page` 创建 `wiki/sources/{source_id}.md`：
- type: source
- 内容：LLM 撰写的结构化摘要（不是原文截取），包含关键要点、核心论断、相关的 [[wikilinks]]

### 第 4 步：创建/更新 Entity 页面
对每个识别出的关键实体（技术、产品、组织、人物等）：
1. `kb_search_wiki` 检查是否已有页面
2. 已有 → `kb_read_page` 读取，`kb_update_section` 追加新源信息
3. 新实体 → `kb_write_page` 创建 `wiki/entities/{id}.md`
   - 初始内容可以是 stub（status: stub），后续 ingest 持续充实

### 第 5 步：创建/更新 Concept 页面
对每个识别出的核心概念，同 Entity 流程。

### 第 6 步：更新索引和日志
1. `kb_ensure_entry` 更新 index.md（在对应 section 下添加，带一行摘要）
2. `kb_ensure_entry` 更新 log.md（结构化日志格式）

### 第 7 步：提交
`kb_commit` — message 格式: `kb: ingest {source_id} — {简短描述}`

### 矛盾检测（Ingest 时）
阅读新源时，对每个关键论断：
1. `kb_search_wiki` 查找相关页面
2. 发现与已有页面矛盾时：
   - 在源摘要页标注: `> ⚠️ 本文称 X，但 [[Y]] 认为 Z`
   - 在被矛盾页面的相关 section 追加说明
```

### 6.2 `kb_query` — 知识查询与回写

```markdown
---
name: kb_query
description: 基于 wiki 知识层回答问题，高价值回答可沉淀为分析页
user-invocable: true
---

### 回答问题
1. `kb_search_wiki` 搜索相关页面
2. `kb_read_page` 精读 top 结果
3. 综合 wiki 内容回答，引用具体页面: [[页面名]]
4. 缺少关键信息时明确说明

### 结果回写（当回答有长期价值时）
如果回答是深度分析、对比、综合——建议用户将其沉淀为 wiki 页面：
1. `kb_write_page(wiki/analyses/{topic}.md)` — type: analysis
2. `kb_ensure_entry(index.md, ## Analyses section)`
3. `kb_ensure_entry(log.md)`
4. `kb_commit`
```

### 6.3 `kb_lint` — 知识库健康检查（新增）

```markdown
---
name: kb_lint
description: 检查知识库健康度，发现矛盾、孤岛、缺失、过时内容
user-invocable: true
---

### 检查流程
1. 读取 index.md 和 page-index.json 获取全部页面清单
2. 分主题抽样阅读页面（`kb_read_page`）
3. 检查项目：

**结构健康**：
- 孤岛页面：被 index.md 列出但没有其他页面链接到它
- 幽灵链接：页面中 [[wikilink]] 指向不存在的页面
- 缺失页面：多个页面提到某个 entity/concept 但没有独立页面
- Stub 页面：status: stub 的页面是否可以根据已有源信息充实

**内容健康**：
- 矛盾：同一主题的不同页面是否有冲突结论
- 过时：是否有新源推翻了旧页面的结论
- 覆盖度：哪些源文件已注册但知识未充分整合到 entity/concept 页面

### 输出
以列表形式报告发现，按严重性排序。
用户选择具体项目后，执行修复（write_page / update_section / ensure_entry）。
```

---

## 7. 类型系统变更

### 7.1 删除的类型

```typescript
// 以下类型随 plan/draft/apply 管道一起删除
Plan, PlanCreateEntry, PlanUpdateEntry, PlanMoveEntry
Draft, DraftFile, DraftFileCreate, DraftFileEnsureEntry, DraftFileOverwrite
InProgressRecord, CompletedFileRecord, RecoveryAction
```

### 7.2 保留的类型

```typescript
// 源与 Manifest
Manifest, SourceKind

// 页面
PageFrontmatter   // 增加 aliases 字段校验
PageIndex, PageIndexEntry  // 增加 aliases 字段

// 搜索
SearchQuery, SearchResult

// 工具基础
ToolResult<T>, WorkspaceConfig
```

### 7.3 新增的类型

```typescript
// Frontmatter 校验结果
interface FrontmatterValidation {
  valid: boolean;
  errors: string[];    // 阻断性错误（缺少必填字段等）
  warnings: string[];  // 非阻断警告（未知 type 等）
}

// 页面 ID 格式
type PageId = string;  // 约束: /^[a-z0-9_-]+$/

// 核心页面类型枚举
const CORE_PAGE_TYPES = ["source", "entity", "concept", "analysis", "index", "report"] as const;
type CorePageType = typeof CORE_PAGE_TYPES[number];
```

---

## 8. 从 V1 迁移

### 8.1 代码迁移

| V1 文件 | V2 处置 |
|---------|--------|
| `src/tools/kb_source_add.ts` | 保留，增加 file_name 返回 |
| `src/tools/kb_plan_ingest.ts` | **删除** |
| `src/tools/kb_draft_patch.ts` | **删除** |
| `src/tools/kb_apply_patch.ts` | **删除**（ensure_entry 逻辑提取到新文件） |
| `src/tools/kb_search_wiki.ts` | 保留，增强 alias 匹配 |
| `src/tools/kb_read_page.ts` | 保留 |
| `src/tools/kb_commit.ts` | 保留 |
| `src/tools/kb_read_source.ts` | **新建** |
| `src/tools/kb_write_page.ts` | **新建** |
| `src/tools/kb_update_section.ts` | **新建** |
| `src/tools/kb_ensure_entry.ts` | **新建** |
| `src/utils/path_validator.ts` | 保留 |
| `src/utils/hash.ts` | 保留 |
| `src/utils/frontmatter.ts` | 保留，增加 frontmatter 校验函数 |
| `src/types/index.ts` | 删除 plan/draft 类型，增加新类型 |

### 8.2 数据迁移

V1 E2E 测试产生的数据：
- `kb/state/manifests/` — 保留，格式不变
- `kb/state/plans/`、`drafts/`、`applied/`、`runs/` — 可删除
- `kb/wiki/sources/*.md` — 保留，但内容质量低（截取式摘要），后续 lint 时标记为需要充实
- `kb/wiki/index.md`、`log.md` — 保留，格式需手动调整为 V2 wikilink 格式

### 8.3 wiki-conventions.md

新建 `kb/schema/wiki-conventions.md`，作为 LLM 行为指南：

```markdown
# Wiki 约定

## 页面类型
- source: 源文件摘要，位于 wiki/sources/
- entity: 实体（技术/产品/组织/人物），位于 wiki/entities/
- concept: 概念（方法/理论/主题），位于 wiki/concepts/
- analysis: 分析/对比/综合，位于 wiki/analyses/
- report: 报告，位于 wiki/reports/

## 链接约定
- 页面间引用使用 [[wikilinks]]
- 引用源文件使用 [[source_id|显示标题]]
- entity/concept 页面首次提到其他 entity/concept 时建立链接

## ID 命名
- 使用小写英文 + 下划线: risc_v, secure_boot, docker
- 源页面 ID 使用 source_id: src_sha256_xxxxxxxx
- 避免过长的 ID，保持简洁可读

## 内容约定
- 摘要应提炼关键洞见，不是原文截取
- Entity 页面应综合所有相关源的信息
- 发现矛盾时用 ⚠️ 标记并说明
- Stub 页面（status: stub）表示有页面但内容待充实
```

---

## 9. 实现计划

### Phase 1：工具层改造（核心）

**任务 1.1**：类型系统更新
- 删除 Plan/Draft/InProgress 相关类型
- 新增 FrontmatterValidation、PageId 等类型
- 更新 PageFrontmatter 增加 aliases

**任务 1.2**：新增 `kb_read_source`
- 从 manifest 读取源文件内容
- 大文件截断保护

**任务 1.3**：新增 `kb_write_page`（最核心的新工具）
- Frontmatter 解析 + 必填字段校验
- ID 格式 + 唯一性校验
- 路径安全校验
- 增量更新 page-index.json
- create_only 模式

**任务 1.4**：新增 `kb_update_section`
- Heading 定位 + section 边界识别
- replace / append 模式
- 自动更新 updated_at

**任务 1.5**：新增 `kb_ensure_entry`（从 apply_patch 提取）
- 沿用 dedup_key 机制
- 独立为单一职责工具

**任务 1.6**：增强 `kb_search_wiki`
- Alias 匹配
- resolve_link 模式

**任务 1.7**：更新 `kb_source_add`
- 返回值增加 file_name

**任务 1.8**：删除旧工具 + 更新 index.ts 导出
- 删除 plan_ingest, draft_patch, apply_patch
- 更新入口导出

**任务 1.9**：TypeScript 编译 + 全量测试

### Phase 2：Skill 层 + 约定文档

**任务 2.1**：编写 `kb/schema/wiki-conventions.md`

**任务 2.2**：重写 `skills/kb_ingest/SKILL.md`
- LLM 驱动的知识整合流程

**任务 2.3**：重写 `skills/kb_query/SKILL.md`
- 增加结果回写能力

**任务 2.4**：新建 `skills/kb_lint/SKILL.md`
- wiki 健康检查流程

### Phase 3：E2E 验证

**任务 3.1**：用 V1 的 22 篇测试文档重新跑 ingest（手动模拟 LLM 行为）
**任务 3.2**：验证 Obsidian 兼容性（wikilink、graph view、Dataview）
**任务 3.3**：Codex review

---

## 10. 验收标准

### 工具层
- [ ] `kb_write_page` 正确校验 frontmatter 必填字段，拒绝无效输入
- [ ] `kb_write_page` 增量更新 page-index.json（不全量重建）
- [ ] `kb_update_section` 正确定位和替换/追加 section
- [ ] `kb_ensure_entry` 幂等性（重复调用不产生重复条目）
- [ ] `kb_search_wiki` alias 匹配正确
- [ ] `kb_read_source` 能读取已注册源文件内容
- [ ] 所有新工具通过路径安全校验
- [ ] TypeScript strict mode 编译通过

### Skill 层
- [ ] kb_ingest skill 指导 LLM 完成：源注册 → 阅读 → 分析 → 多页面写入 → 索引更新 → 提交
- [ ] 一次 ingest 能产生 ≥5 个页面操作（源摘要 + entity + concept + index + log）
- [ ] kb_query skill 支持结果回写为 analysis 页面
- [ ] kb_lint skill 能发现 orphan pages 和 phantom links

### 兼容性
- [ ] 生成的 wiki 在 Obsidian 中能正确显示 graph view
- [ ] Wikilinks 能在 Obsidian 中正确跳转
- [ ] Frontmatter 能被 Dataview 查询
