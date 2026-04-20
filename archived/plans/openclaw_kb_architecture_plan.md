# 基于 OpenClaw 的知识库工程化方案（插件 / Skills / 文件系统）

## 1. 文档目标

本文档给出一套围绕 **OpenClaw** 构建“LLM 持续维护型知识库”的完整工程化方案。

目标不是做一个普通聊天问答机器人，而是做一个：

- 以 **raw sources** 为事实底座
- 以 **wiki** 为持续演化的知识层
- 以 **schema** 为规则层
- 以 **OpenClaw skills + tools** 为执行层
- 以 **native plugin / compatible bundle** 为分发与集成层
- 以 **workspace 文件系统 + Git** 为可审计落盘层

的“知识编译系统”。

这套方案适合个人研究库、团队项目知识库、尽调资料库、专题学习库，以及任何“资料会持续进入、知识需要持续沉淀”的场景。

---

## 2. 为什么选择 OpenClaw 作为承载层

OpenClaw 适合做这件事，原因不在于“它能聊天”，而在于它原生具备以下几类扩展能力：

1. **Workspace 文件系统心智**  
   OpenClaw 默认围绕工作区运行，可在工作区中放置 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、skills 目录等内容，使 agent 行为天然和文件系统结合。

2. **Skills 机制**  
   OpenClaw 使用 AgentSkills 兼容目录。每个 skill 是一个带 `SKILL.md` 的目录，可用来“教会 agent 如何在某种任务上调用工具”。

3. **Plugin 机制**  
   OpenClaw 支持两类主要集成形态：
   - **Native plugin**：原生插件，运行在 OpenClaw 进程内，通过 `register(api)` 注册 tools、channels、providers、hooks、services 等运行时能力。
   - **Compatible bundle**：兼容 Codex / Claude / Cursor 等生态的 bundle。OpenClaw 会把可识别内容规范化进插件注册表，但不会像 native plugin 那样导入任意运行时代码。

4. **Skill 发现与配置机制**  
   文档说明 OpenClaw 会扫描多类 skill root，包括 `~/.openclaw/skills`、`~/.agents/skills`、`<workspace>/.agents/skills`、`<workspace>/skills`，并支持 allowlist 与 watch。

5. **安全边界可配置**  
   OpenClaw 文档明确区分了 native plugin 与 bundle 的信任边界，并强调 native plugin 等价于进程级代码执行，因此非常适合做“内部可审计、自研、窄权限”的知识库插件。

因此，围绕 OpenClaw 来承载“知识编译系统”是可行的，而且结构上是顺的。

---

## 3. 设计原则

### 3.1 Patch-first，而不是直接写文件

agent 不应直接随手改 `kb/wiki/*.md`。  
所有涉及 `kb/wiki/` 的多文件知识变更，都先生成 **Patch Plan**，再由工具负责真正落盘。

例外：
- `kb_source_add` 可以先登记 `kb/raw/` 中的原始资料与 `kb/state/manifests/` 中的 immutable manifest
- 这些登记动作是 ingest staging，不等同于 wiki 知识层更新

### 3.2 Raw 只读，Wiki 可编辑

- `kb/raw/`：事实底座，只读或追加，不做语义重写。
- `kb/wiki/`：知识层，可被持续维护。

### 3.3 Skills 负责编排，Tools 负责确定性动作

- **Skill**：告诉 agent 什么时候做什么。
- **Tool**：负责确定性、可测试、可幂等的动作。
- **Plugin / bundle**：是工具与附带资源的分发形态，而不是额外一层推理逻辑。

### 3.4 文件系统是事实层，LLM 不是事实层

知识库的最终状态必须体现在文件系统中，而不是仅存在于 prompt、对话历史、内存状态或数据库临时缓存中。

### 3.5 Git 是审计与回滚底座

知识库系统早期最重要的能力之一，不是“永不出错”，而是“出错可回滚”。

### 3.6 标识优先于路径

要让 file-first 知识库可维护，必须把“标识”和“路径”分开：

- OpenClaw-facing skill / tool ID 使用 `snake_case`
- 页面以 frontmatter 中的 `id` 作为权威标识，文件路径只是可变投影
- `source_id` 不能只靠时间戳生成，必须来自稳定指纹
- patch 必须支持 `move` / `rename` 语义，而不只是 `create` / `update` / `delete`
- 链接重写、别名保留、孤儿检测都应围绕稳定 ID 而不是文件名实现

---

## 4. 总体架构

```text
User / Channel
   ↓
OpenClaw Agent
   ↓
Skills (kb_ingest / kb_query / kb_lint / kb_repair)
   ↓
Tools (kb_source_add / kb_plan_ingest / kb_apply_patch / ...)
   ↓
Workspace File System
   ├─ kb/raw
   ├─ kb/wiki
   ├─ kb/schema
   └─ kb/state
   ↓
Git / Index / Reports

Native plugin
   └─ registers runtime tools via `register(api)` / `api.registerTool(...)`
Compatible bundle
   └─ packages compatible skills / metadata / defaults, not custom runtime tool code
```

可理解为四层：

1. **交互层**：用户通过 OpenClaw 发出任务。
2. **编排层**：skills 决定执行流程。
3. **工具层**：tools 执行确定性动作。
4. **状态层**：文件系统 + Git 持久化知识与变更。

---

## 5. 工作区目录结构

建议目录如下：

```text
~/.openclaw/workspace/
  AGENTS.md
  kb/
    raw/
      inbox/
      processed/
      assets/
    wiki/
      index.md
      log.md
      entities/
      concepts/
      sources/
      analyses/
      reports/
        index.md
    schema/
      page-types/
      templates/
      vocab/
      lint-rules.yaml
    state/
      manifests/
      patches/
      runs/
      cache/
  skills/
    kb_ingest/
      SKILL.md
    kb_query/
      SKILL.md
    kb_lint/
      SKILL.md
    kb_repair/
      SKILL.md
```

### 5.1 各目录职责

#### `kb/raw/`
原始资料层。

- `inbox/`：待处理资料
- `processed/`：已归档资料
- `assets/`：图片、附件、原文副本等

#### `kb/wiki/`
知识正文层。

- `index.md`：总索引
- `log.md`：变更日志
- `entities/`：人物、组织、产品、项目等实体页
- `concepts/`：概念、方法、主题页
- `sources/`：每篇原始资料对应的摘要页
- `analyses/`：问答后沉淀出的分析页
- `reports/`：lint、质量检查、批处理报告
- `reports/index.md`：报告目录页，作为所有 report 页的父页面

#### `kb/schema/`
规则与模板层。

- 页面模板
- 命名规范
- frontmatter 规范
- 术语表
- lint 规则

#### `kb/state/`
运行状态层。

- `manifests/`：source 元数据
- `patches/`：每次变更计划及应用记录
- `runs/`：任务执行记录
- `cache/`：非事实性缓存

---

## 6. Native Plugin 设计

建议插件名：

`@your-org/openclaw-kb`

推荐优先做 **native plugin**，原因：

- 可直接通过 `register(api)` 注册 tools
- 可与 skills、模板、schema 资源一起分发
- 适合内部私有部署
- 更适合“窄权限、强约束、可审计”的工具面

### 6.1 为什么不先只做 skill

因为纯 skill 容易导致：

- agent 直接改文件，难审计
- 命名与格式漂移
- 重跑不幂等
- patch 不可视
- 错误难定位

所以更推荐：

- **skill 管流程**
- **tool 管动作**
- **plugin 管分发与运行时注册**

---

## 7. 工具面设计

完整版本建议提供以下 8 个工具，其中 MVP 只实现最小闭环需要的子集。

### 7.1 `kb_source_add`

功能：注册 source 并落盘。

输入：
- 文本 / URL / 文件路径 / 附件

输出：
- `source_id`
- 保存位置
- 内容 hash
- 初始 metadata

职责：
- 写入 `kb/raw/`
- 生成 `kb/state/manifests/<source_id>.json`
- 去重
- 幂等识别

补充约束：
- `source_id` 应由稳定指纹派生，例如 `src_sha256_8f3a1c2d`
- 去重优先依据“规范化内容 hash + canonical locator（URL / 文件路径）”
- 同一 source 二次导入时应复用既有 `source_id`，而不是新建时间戳 ID
- manifest 至少应记录：`source_id`、`source_locator`、`content_hash`、`canonical_path`、`ingest_status`

---

### 7.2 `kb_source_parse`

功能：把 source 解析成统一结构。

标准中间结构建议：

```json
{
  "source_id": "src_sha256_8f3a1c2d",
  "source_locator": "https://example.com/post",
  "content_hash": "sha256:8f3a1c2d...",
  "ingest_status": "registered",
  "canonical_path": "kb/raw/processed/src_sha256_8f3a1c2d.txt",
  "title": "...",
  "kind": "article|paper|note|pdf|webpage",
  "text_blocks": ["..."],
  "assets": ["..."],
  "metadata": {
    "url": "...",
    "author": "...",
    "created_at": "..."
  }
}
```

职责：
- 内容规范化
- 解析与理解分层
- 为后续 patch plan 提供稳定输入

说明：
- 对于 MVP，可先把“基础文本规范化”内联到 `kb_source_add`
- 把 `kb_source_parse` 作为 Phase 2 的显式拆分工具，处理复杂格式与 richer parsing

---

### 7.3 `kb_plan_ingest`

功能：根据 source 和当前 wiki 上下文，输出 patch plan。

输出建议：

```json
{
  "source_id": "src_sha256_8f3a1c2d",
  "create": [
    {
      "page_id": "source_src_sha256_8f3a1c2d",
      "path": "kb/wiki/sources/src_sha256_8f3a1c2d.md",
      "kind": "source_summary"
    }
  ],
  "update": [
    {
      "path": "kb/wiki/index.md",
      "reason": "link new source summary"
    },
    {
      "path": "kb/wiki/log.md",
      "reason": "record ingest event"
    }
  ],
  "moves": [
    {
      "page_id": "concept_transformer",
      "from": "kb/wiki/concepts/transformer.md",
      "to": "kb/wiki/concepts/nn/transformer.md",
      "rewrite_links": true
    }
  ],
  "delete": [],
  "conflicts": [
    "..."
  ],
  "notes": "..."
}
```

职责：
- 先计划、后执行
- 控制改动范围
- 支持人工审核
- 输出 contract 与 `kb_apply_patch` 消费的 contract 保持一致

MVP 收敛：
- MVP 的 `kb_plan_ingest` 只负责：
  - 创建 source 摘要页
  - 更新 `kb/wiki/index.md`
  - 更新 `kb/wiki/log.md`
- 自动创建 / 大改 concept、entity、analysis 页面放到后续阶段

---

### 7.4 `kb_apply_patch`

功能：将 patch plan 转为真实文件变更。

职责：
- 写入 markdown 文件
- 更新 `kb/wiki/index.md`
- 更新 `kb/wiki/log.md`
- 记录 patch 到 `kb/state/patches`
- 支持 dry-run / apply
- 支持 `move` / `rename` 与链接重写 metadata

说明：
- 回滚能力建议在 Phase 2 做成显式能力，不强塞进 MVP 验收

---

### 7.5 `kb_search_wiki`

功能：优先在 wiki 层搜索相关页面。

输入：
- query
- page type filter
- tags

输出：
- 匹配页面列表
- 摘要
- 相关度说明

---

### 7.6 `kb_read_page`

功能：精读页面。

职责：
- 供 query skill 读取具体页面
- 用于组合回答
- 支持返回 frontmatter 与正文分离结构

---

### 7.7 `kb_lint`

功能：对 wiki 健康度做巡检。

检查项建议包括：
- frontmatter 缺失
- 坏链接
- 孤儿页
- `source_ids` 缺失
- 未被索引的页面
- 冲突未标注
- `log.md` 不完整

输出：
- `kb/wiki/reports/lint-YYYY-MM-DD.md`
- 结构化 lint JSON（便于自动修复）

并更新：
- `kb/wiki/reports/index.md`

---

### 7.8 `kb_commit`

功能：把当前变更提交到 Git。

建议 commit message 模板：

```text
kb: ingest src_20260408_001 and update transformer-related pages
```

---

## 8. 四个核心 Skills 设计

OpenClaw 的 skill 适合做“编排规则”，不适合承担事实状态。

说明：
- OpenClaw skill frontmatter 中的 `name` 应使用 `snake_case`
- 下文统一使用 `kb_ingest` / `kb_query` / `kb_lint` / `kb_repair`

### 8.1 `kb_ingest`

职责：把新资料编译进知识库。

典型触发：
- “把这篇文章纳入知识库”
- “把这个 PDF 总结后沉淀进去”
- “根据这篇资料更新现有页面”

执行链：
1. `kb_source_add`
2. 如需复杂解析，再调用 `kb_source_parse`
3. `kb_plan_ingest`
4. 审核或自动通过
5. `kb_apply_patch`
6. `kb_commit`

关键约束：
- 不能绕过 patch plan 直接写 wiki
- 必须更新 `kb/wiki/log.md`
- 新页面必须被 `kb/wiki/index.md` 或某父页面引用

MVP 特殊说明：
- MVP 中把基础规范化折叠进 `kb_source_add`
- MVP 的 ingest 只要求稳定创建 source 页并更新 `index.md` / `log.md`

---

### 8.2 `kb_query`

职责：优先基于 wiki 进行回答。

典型触发：
- “根据知识库回答这个问题”
- “比较一下 X 和 Y”
- “总结这个主题目前知识库中的结论”

执行链：
1. `kb_search_wiki`
2. `kb_read_page`
3. 基于 wiki 组织回答
4. 如答案形成高价值分析，建议沉淀到 `kb/wiki/analyses/`

关键约束：
- 先读 wiki，再考虑回 raw
- 不确定时说明“当前 wiki 未沉淀充分”
- 不允许把猜测包装成已知事实

---

### 8.3 `kb_lint`

职责：检查知识库健康度。

典型触发：
- 定期巡检
- 手动要求“检查知识库一致性”
- 大批量 ingest 之后

执行链：
1. 扫描 `kb/wiki/`
2. 调用 `kb_lint`
3. 生成报告
4. 必要时建议调用 `kb_repair`

---

### 8.4 `kb_repair`

职责：根据 lint 或人工指定问题做修复。

典型触发：
- “修复孤儿页”
- “补全索引”
- “修复这批 source 引用问题”

执行链：
1. 读取 lint 报告或目标问题
2. 生成小 patch
3. `kb_apply_patch`
4. `kb_commit`

---

## 9. `AGENTS.md` 建议内容

`AGENTS.md` 建议写成全局宪法，而不是技能说明书。

推荐最小版本如下：

```md
# Knowledge Base Rules

1. `kb/raw` is the source-of-truth layer for original materials. Do not rewrite raw sources.
2. `kb/wiki` is the editable knowledge layer.
3. Any multi-file change under `kb/wiki` must start from a patch plan.
4. `kb_source_add` may register immutable raw-source and manifest records before a wiki patch exists.
5. Query the wiki first before falling back to raw sources.
6. Every ingest that changes `kb/wiki` must update `kb/wiki/log.md`.
7. Every new page must be linked from an index or parent page.
8. Uncertainty or contradiction must be written explicitly as conflict or open question.
9. High-value answers should be candidates for `kb/wiki/analyses/`.
```

如果你希望更严格，还可以补充：
- 高风险主题默认走“建议 patch，等待确认”
- 所有页面必须带 frontmatter
- 不允许删除 raw source manifest

---

## 10. `SKILL.md` 模板示例

### 10.1 `skills/kb_ingest/SKILL.md`

```md
---
name: kb_ingest
description: Ingest a new source into the local knowledge base through a patch-first workflow
user-invocable: true
---

When the user asks to add a source, update the wiki from a source, or summarize and store new material:

1. Call `kb_source_add` to register the source and get `source_id`.
2. If the source is complex, call `kb_source_parse` to normalize content.
3. Call `kb_plan_ingest` to produce a patch plan.
4. Do not edit wiki files directly before a patch exists.
5. If the topic is high-risk, present the patch summary first.
6. Otherwise call `kb_apply_patch`.
7. Call `kb_commit` with a concise message.

Always ensure:
- `kb/wiki/log.md` is updated
- any new page is linked from an index or parent page
- unresolved conflicts are written explicitly
```

### 10.2 `skills/kb_query/SKILL.md`

```md
---
name: kb_query
description: Answer questions primarily from the local wiki knowledge layer
user-invocable: true
---

When the user asks a question about topics covered by the knowledge base:

1. Call `kb_search_wiki` first.
2. Call `kb_read_page` on the top relevant pages.
3. Synthesize the answer from the wiki layer.
4. If critical facts are missing, say so explicitly.
5. Suggest `kb_ingest` only when new source ingestion is needed.

Prefer:
- wiki over raw
- explicit uncertainty over speculation
- structured answers over broad freeform summaries
```

### 10.3 `skills/kb_lint/SKILL.md`

```md
---
name: kb_lint
description: Run health checks on the local knowledge base wiki
user-invocable: true
---

When asked to inspect the knowledge base consistency or quality:

1. Call `kb_lint`.
2. Summarize the major issues.
3. Point out which issues can be auto-repaired.
4. Suggest `kb_repair` for actionable fixes.
```

### 10.4 `skills/kb_repair/SKILL.md`

```md
---
name: kb_repair
description: Repair wiki structure, links, references, and page consistency issues
user-invocable: true
---

When the user asks to fix structural issues in the wiki:

1. Read the lint report or the target page(s).
2. Generate a minimal patch.
3. Apply the patch through `kb_apply_patch`.
4. Commit the repair with `kb_commit`.

Prefer minimal and reversible fixes.
```

---

## 11. Wiki 页面 Schema

MVP 阶段建议只定义 6 种 page type：

- `source`
- `concept`
- `entity`
- `analysis`
- `index`
- `report`

### 11.1 Frontmatter 规范

约定：

- `id` 是页面的 canonical identifier
- 文件路径由 slug 派生，可被 `move` / `rename`
- frontmatter 中的关联关系优先引用其他页面的 `id`

slug 规则建议：

- 默认 slug 由 `title` 的 kebab-case 生成，如 `Transformer Overview` -> `transformer-overview`
- 如需稳定路径，可允许 frontmatter 显式给出 `slug`
- `kb_apply_patch` 负责在 `move` / `rename` 时重写 backlinks、保留 aliases、补写迁移日志

示例：

```yaml
---
id: concept_transformer
type: concept
title: Transformer
aliases: []
source_ids: [src_sha256_8f3a1c2d, src_sha256_2d94c310]
updated_at: 2026-04-08
status: active
tags: [ml, architecture]
related:
  - concept_attention
  - concept_encoder
---
```

### 11.2 正文建议结构

```md
# Transformer

## TL;DR
...

## Key facts
- ...

## Conflicts / ambiguities
- ...

## Open questions
- ...

## Related
- `concept_attention`
- `concept_encoder`

## Sources
- src_sha256_8f3a1c2d
- src_sha256_2d94c310
```

### 11.3 Source 页面结构

每个 source 建议对应一个摘要页，例如：

`kb/wiki/sources/src_sha256_8f3a1c2d.md`

建议约定：

- source 页面 `id` 使用 `source_<source_id>`，例如 `source_src_sha256_8f3a1c2d`
- source 页面路径使用 `kb/wiki/sources/<source_id>.md`

正文结构：
- 来源说明
- 核心摘要
- 关键 claims
- 影响到的主题页
- 未解决问题

### 11.4 Report 页面结构

报告页用于 lint、批处理检查与维护记录，建议使用：

- `type: report`
- 路径位于 `kb/wiki/reports/`
- 从 `kb/wiki/reports/index.md` 链出，并在需要时从 `kb/wiki/index.md` 暴露入口

---

## 12. Patch-first 机制

Patch-first 是整套系统的关键。

### 12.1 为什么需要 patch

没有 patch 层的风险：
- agent 任意改文件
- 无法审计改动范围
- 难以做人工审核
- 出错时难回溯

### 12.2 Patch 建议字段

```json
{
  "patch_id": "patch_20260408_8f3a1c2d",
  "source_id": "src_sha256_8f3a1c2d",
  "create": [
    {"page_id": "source_src_sha256_8f3a1c2d", "path": "kb/wiki/sources/src_sha256_8f3a1c2d.md"}
  ],
  "update": ["kb/wiki/index.md", "kb/wiki/log.md"],
  "move": [
    {"page_id": "concept_transformer", "from": "kb/wiki/concepts/transformer.md", "to": "kb/wiki/concepts/nn/transformer.md"}
  ],
  "delete": [],
  "rationale": "Add source summary and link it to relevant concept pages",
  "risk_level": "low"
}
```

补充要求：
- patch 中的 `page_id` 与 `path` 要同时记录，避免 rename 时丢失身份
- `move` 是一等操作，不要用“删旧文件 + 建新文件”伪装重命名
- backlink rewrite 与 alias 保留应在 apply 阶段自动完成或显式报出

### 12.3 审核模式

建议支持两种模式：

- **auto-apply**：低风险任务自动应用
- **review-before-apply**：高风险任务先给出 patch 摘要再应用

高风险场景示例：
- 医疗、法律、财务内容
- 将删除或大改已有核心页面
- 大批量 patch
- 事实冲突明显

---

## 13. 查询链路设计

建议查询时遵循：

### 一级：索引召回
- 读 `kb/wiki/index.md`
- 通过 `kb_search_wiki` 找候选页面

### 二级：页面精读
- 用 `kb_read_page` 读取具体页面
- 聚合多个 concept / entity / analysis 页面

### 三级：必要时回 raw
只有在以下情况才回 raw：
- wiki 没沉淀到该问题
- 需要核验原文细节
- 发现 wiki 与 source 冲突

MVP 约束：
- MVP 不实现 raw fallback 工具，query 只基于 `kb/wiki/` 回答
- 回 raw 核验放到后续阶段，与 `kb_source_parse` 或专用 raw reader 一起引入

### 回答后的沉淀
若问答本身产生高价值结构化分析，则建议写入：
- `kb/wiki/analyses/`

这样就形成闭环：

`source -> ingest -> wiki -> query -> analysis -> wiki`

---

## 14. Lint 规则设计

建议 lint 分为 3 类。

### 14.1 内容质量
- 摘要是否为空
- 是否存在未标明来源的重要结论
- 是否有明显冲突却未写入 conflict

### 14.2 结构质量
- frontmatter 是否齐全
- index 是否能到达页面
- 是否存在孤儿页
- 是否存在坏链接
- `source_ids` 是否存在且有效

### 14.3 系统质量
- 是否支持幂等重跑
- patch 是否落档
- log 是否记录
- commit 是否完成

输出形式建议：
- 人类可读 markdown 报告
- 机器可读 JSON 结果

---

## 15. Git 与版本管理

建议把整个 `kb/` 目录纳入 Git。

### 15.1 为什么要 Git

- 可回滚
- 可 diff
- 可审计
- 可分支试验

### 15.2 建议策略

- 每次 ingest 一个独立 commit
- lint repair 单独 commit
- 大型变更先开分支，再 squash

### 15.3 Commit message 规范

```text
kb: ingest src_20260408_001 and create source summary
kb: update transformer concept from src_20260408_001
kb: repair orphan pages and broken links
```

---

## 16. 安全边界与风险控制

这是整套方案最需要重视的部分之一。

### 16.1 Native plugin 的信任边界

OpenClaw 官方文档明确指出：

- native plugin 运行在 Gateway 进程内
- 它们不被 sandbox
- 恶意 native plugin 等价于进程级任意代码执行

因此本方案中的 `openclaw-kb` 应遵循：

- 私有部署
- 自研或完全审计后使用
- 严格最小权限

### 16.2 只给知识库插件窄权限

推荐限制为：
- 只允许访问 `workspace/kb/**`
- 不默认授予浏览器、邮件、聊天渠道、远程 shell 等权限
- 不让它顺手变成万能 agent

### 16.3 对第三方 skills / plugins 保守处理

OpenClaw 文档建议将第三方 skills 视为不可信代码，并使用 allowlist、明确安装路径、最小权限与沙箱策略。

### 16.4 宿主机与 sandbox 策略

如果你在多 agent、群组或不完全信任的上下文里运行 OpenClaw，应优先利用 OpenClaw 的 sandbox 模式，把非主会话放在隔离环境中。

### 16.5 密钥管理

不要把 secrets 放进：
- `AGENTS.md`
- `SKILL.md`
- prompt 模板
- 任务日志

如果 plugin 未来需要外部存储或索引服务，应通过宿主进程环境变量或独立 secret 管理方案注入。

---

## 17. 最小可运行版本（MVP）

### 17.1 MVP 目标

先跑通以下闭环：

`添加资料 -> 生成 patch -> 应用 patch -> 搜索 wiki -> 回答 -> Git 留痕`

### 17.2 MVP 范围

先只支持：
- markdown
- txt
- 粘贴文本
- 简单 URL 网页正文

先不支持：
- 自动创建 / 大改 concept、entity、analysis 页面
- rename / move / rollback 自动化
- 复杂 PDF OCR
- 图片理解
- 多媒体摘要
- 分布式任务队列
- 向量数据库

### 17.3 MVP 工具范围

建议 MVP 实现以下 6 个工具，保证闭环自洽：
- `kb_source_add`
- `kb_plan_ingest`
- `kb_apply_patch`
- `kb_search_wiki`
- `kb_read_page`
- `kb_commit`

说明：
- `kb_source_add` 在 MVP 中同时承担基础文本规范化与 manifest 落盘
- `kb_plan_ingest` 在 MVP 中只生成 source 页、`index.md`、`log.md` 的 patch
- `kb_source_parse`、`kb_lint`、`kb_repair`、rollback 放到后续阶段

### 17.4 MVP Skills

- `kb_ingest`
- `kb_query`

### 17.5 MVP 验收标准

至少做到：
- 能导入一篇文章
- 能创建 source 页面
- 能更新 `index.md` 与 `log.md`
- 能生成 patch 存档与 source manifest
- 能基于 `kb_search_wiki + kb_read_page` 回答问题
- 能留下一个 Git commit 作为审计记录

---

## 18. 迭代路线图

### Phase 1：单用户本地版

目标：跑通闭环。

交付：
- `kb/` 目录结构
- 6 个基础 tools
- 2 个基础 skills
- Git 集成

### Phase 2：质量控制版

目标：可维护。

交付：
- `kb_source_parse`
- `kb_lint`
- `kb_repair`
- patch 存档
- rename / move / rollback 流程
- 审核模式

### Phase 3：增强检索版

目标：更适合大知识库。

交付：
- 全文索引
- hybrid search
- 更强页面召回
- 自动建议沉淀 analysis

### Phase 4：团队协作版

目标：多人使用。

交付：
- 审核工作流
- 分支与权限控制
- 页面评论 / 批注
- 冲突合并策略

### Phase 5：Bundle 兼容版

目标：跨生态复用。

交付：
- 抽出 bundle 元数据
- 兼容 Codex / Claude / Cursor 可识别内容包
- 保留 native plugin 作为主实现

---

## 19. 我最推荐的开发顺序

1. 先建立 `kb/` 文件树与 `AGENTS.md`
2. 先写 `kb_ingest` / `kb_query` 两个 skill
3. 再写 native plugin 的最小 6 个 tools
4. 跑通单篇 source ingest 闭环
5. 接入 Git
6. 补 `kb_source_parse`
7. 补 `kb_lint` / `kb_repair`
8. 再考虑更强检索与团队协作

核心原则：

**先证明“agent 能持续把知识沉淀成文件系统资产”，再去扩功能。**

---

## 20. 实施建议总结

如果用一句话概括这套方案：

> 用 OpenClaw 作为 agent 容器与交互层；
> 用 workspace 文件系统作为知识事实底座；
> 用 skills 负责编排知识工作流；
> 用 native plugin 提供稳定、可审计、可幂等的知识库工具面。

这是比“纯 prompt + 任意改 markdown”更稳、更可扩展、更适合工程化的路线。

---

## 21. 参考资料

以下为编写本方案时参考的 OpenClaw 官方资料：

1. OpenClaw README  
   https://github.com/openclaw/openclaw/blob/main/README.md

2. Skills 文档  
   https://docs.openclaw.ai/tools/skills

3. Skills Config 文档  
   https://docs.openclaw.ai/tools/skills-config

4. Plugins 文档  
   https://docs.openclaw.ai/tools/plugin

5. Plugin Bundles 文档  
   https://docs.openclaw.ai/plugins/bundles

6. Plugin Internals / Architecture 文档  
   https://docs.openclaw.ai/plugins/architecture
