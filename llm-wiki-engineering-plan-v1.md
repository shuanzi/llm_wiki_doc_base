# LLM Wiki 工程化落地方案 v1

> 版本：v1.0  
> 日期：2026-04-07  
> 适用范围：单用户、本地 / 私有部署、混合型知识域、半自动写入、Markdown Wiki 方案

---

## 1. 文档目的

本文给出一套可落地的 **LLM Wiki 工程化方案 v1**，目标是将 Karpathy 提出的 “LLM 维护持久化 Wiki，而不是仅在查询时临时 RAG” 的模式，落实为一个可运行、可审计、可回滚、可逐步演进的本地知识系统。

这份方案聚焦于：

- 单用户使用
- 本地 / 私有部署
- 多知识域混合沉淀
- Source 类型限定为 Markdown / TXT、网页正文、文本型 PDF
- 半自动写入
- 页面级可追溯到 `source_id`
- 查询目标以“快速问答 + 导航发现”为主
- 回答仅在用户确认后回写知识库
- 版本治理保留 `patch plan + diff + commit`

本文不追求一次性设计成最终形态，而是优先确保 **能跑通、能维护、能扩展**。

---

## 2. 背景与设计原则

### 2.1 背景

传统 RAG 工作流通常是在查询时从原始文档中临时检索片段，再由 LLM 合成答案。这种方式适合即时问答，但存在三个问题：

1. **知识不累积**：跨文档综合需要每次重做。
2. **结构不沉淀**：实体关系、冲突、主题演化不会长期保留。
3. **维护成本高**：真正有价值的知识库需要持续整理、链接、修订，而这通常最容易被放弃。

LLM Wiki 模式的核心变化是：

- 原始资料保持只读
- LLM 不仅检索资料，还负责把资料“编译”进持久化 Wiki
- Query 不再主要面向 raw sources，而是优先面向已经整理过的 Wiki
- 好的分析结果继续回写，从而形成复利式积累

### 2.2 设计原则

本方案采用以下原则：

1. **Wiki-first，而不是 RAG-first**  
   原始资料是事实底座，Wiki 是主要知识层。

2. **Patch-first，而不是 Direct-write-first**  
   LLM 先提出修改计划，再执行落盘，避免不透明的大面积写入。

3. **Git-first，而不是 DB-only**  
   Wiki 以 Markdown 文件为核心资产，配合 Git 获取天然版本历史与回滚能力。

4. **Schema-first，而不是 Prompt-only**  
   系统行为依赖明确的页面规范、流程规范、lint 规则，而不是靠临时 prompt 维持稳定。

5. **Human-in-the-loop**  
   第一版默认半自动：低风险内容可自动更新，高风险内容需要人工审核。

6. **先轻后重**  
   MVP 不引入向量库、不做复杂 UI、不做多租户；先用文件系统 + SQLite + Git 跑通主链路。

---

## 3. 已确认的项目边界

### 3.1 项目定位

本项目定位为：

> **单用户、本地 / 私有部署的 AI-native Markdown 知识库系统**

目标不是做通用企业知识平台，也不是先做聊天产品，而是先做一个可稳定使用的“知识编译器”。

### 3.2 首批知识域

采用 **混合型知识域**，但第一版不为每个知识域建立完全独立的 schema，而是采用：

- 一套通用页面类型
- 少量可扩展 frontmatter 字段
- 通过 `workspace -> kb` 的层次隔离不同知识域

示例：

- `kb/riscv-tee/`
- `kb/llm-infra/`
- `kb/product-notes/`

### 3.3 支持的 Source 类型

第一版支持：

- Markdown / TXT
- 网页正文
- 文本型 PDF

暂不支持：

- 扫描版 PDF OCR
- 图片知识抽取
- 音视频转写
- 代码仓库深度语义解析

### 3.4 写入策略

采用 **半自动**：

- Source summary、索引更新、日志更新：默认可自动执行
- 影响核心概念页、主题页、分析页的修改：默认进入待审核 patch
- 存在冲突或大面积改动：强制人工确认

### 3.5 可追溯要求

第一版要求页面可追溯到 `source_id`，重点内容至少能在页面级回溯到对应 source。

不要求第一版就做到 claim-level evidence span，但会为后续演进预留字段。

### 3.6 Query 目标

第一版 Query 聚焦两件事：

1. **快速问答**：基于现有 Wiki 返回结构化答案
2. **导航发现**：告诉用户相关页面、冲突点、空白点、建议继续阅读的内容

### 3.7 回答回写策略

Query 产生的回答默认 **不自动回写**。仅在满足以下条件时允许回写：

- 用户明确确认
- 内容具备长期价值
- 内容可归档为独立页面（如专题总结、对比分析、FAQ）

### 3.8 运行环境

部署方式为：

- 本地运行优先
- 可迁移至私有服务器
- 模型层可切换（本地模型 / API 模型）

### 3.9 版本治理

第一版保留以下链路：

- `patch plan`
- `file diff`
- `git commit`

不强制第一版实现完整的 source -> claim -> evidence span 全链路审计，但保留数据结构扩展空间。

### 3.10 知识组织方式

采用：

> **一个 workspace 下多个 kb**

这样兼顾：

- 单知识域内部结构稳定
- 多知识域相互隔离
- 系统逻辑可以复用

---

## 4. 系统目标与非目标

### 4.1 目标

第一阶段要达成的目标：

1. 可以将新增 source 稳定导入系统
2. 可以由 LLM 生成 patch plan，并对 Wiki 提交受控修改
3. 可以通过 `index.md` 与全文检索完成基本导航
4. 可以对知识库执行基础 lint
5. 可以将高价值 query 结果在确认后回写
6. 可以通过 Git 查看历史与回滚

### 4.2 非目标

第一阶段暂不追求：

- 企业级权限系统
- 多人并发编辑冲突解决
- 向量检索 / rerank / MCP 搜索栈
- 音视频、OCR、多模态大规模 ingest
- 自动 schema 演化
- 复杂可视化管理台

---

## 5. 总体架构

### 5.1 三层模型

系统沿用 LLM Wiki 的核心三层：

1. **Raw Sources**  
   原始资料层，只读不可改，是系统事实来源。

2. **Wiki**  
   持久化 Markdown 知识层，由 LLM 维护，用户主要阅读和提问都围绕这一层展开。

3. **Schema**  
   规则层，定义页面类型、命名规范、工作流、lint 规则、输出约束。

### 5.2 工程模块拆分

在此基础上，工程实现拆分为六个模块：

1. **Source Manager**  
   接收、登记、去重、保存 source 与元数据。

2. **Parser / Normalizer**  
   解析 Markdown / 网页 / PDF，转换为统一中间格式。

3. **Wiki Compiler**  
   读取 source 与当前 wiki 状态，生成 patch plan。

4. **Patch Applier**  
   对 patch plan 做 diff、审核、应用、提交。

5. **Query Engine**  
   基于 Wiki 执行问答与导航。

6. **Lint Engine**  
   定期巡检知识库健康度并输出报告。

### 5.3 核心数据流

#### Ingest

`source input -> parse -> normalize -> plan patch -> review -> apply -> update index/log -> git commit`

#### Query

`question -> read index -> locate pages -> read pages -> synthesize answer -> optional save proposal`

#### Lint

`scan wiki -> detect issues -> generate report -> optional repair patch`

---

## 6. 目录结构设计

建议采用如下 workspace 布局：

```text
workspace/
  kb/
    riscv-tee/
      raw/
        inbox/
        processed/
        assets/
      wiki/
        index.md
        log.md
        overview.md
        sources/
        concepts/
        entities/
        topics/
        analyses/
        reports/
      schema/
        AGENTS.md
        page_templates/
        workflows/
        lint_rules.yaml
      state/
        state.db
        manifests/
        patches/
        runs/
      scripts/
        ingest.py
        query.py
        lint.py
        rebuild_index.py
      .git/
    llm-infra/
    product-notes/
```

### 6.1 目录说明

#### `raw/`

- `inbox/`：待处理 source
- `processed/`：已登记的 source 原件
- `assets/`：网页图片、PDF 附件等本地资源

#### `wiki/`

- `index.md`：内容导航入口
- `log.md`：时间线记录
- `overview.md`：当前知识域总览
- `sources/`：每个 source 的摘要页
- `concepts/`：概念页
- `entities/`：实体页
- `topics/`：主题聚合页
- `analyses/`：专题分析页与回写页面
- `reports/`：lint 结果、差异报告、体检结果

#### `schema/`

- `AGENTS.md`：LLM 行为总规范
- `page_templates/`：页面模板
- `workflows/`：ingest / query / lint 规则
- `lint_rules.yaml`：lint 检查项

#### `state/`

- `state.db`：SQLite 状态数据库
- `manifests/`：source manifest
- `patches/`：patch plan、diff、review 结果
- `runs/`：运行日志与任务快照

---

## 7. 数据模型与文件规范

### 7.1 Source Manifest

每个 source 入库后，生成一份 manifest：

```yaml
source_id: src_20260407_0001
kb_id: riscv-tee
title: Example Paper
source_type: pdf
origin:
  kind: local_file
  url: null
  file_path: raw/processed/src_20260407_0001.pdf
content_hash: sha256:xxxx
created_at: 2026-04-07T10:00:00+08:00
status: processed
parser:
  text_extracted: true
  images_extracted: false
metadata:
  author: null
  published_at: null
  tags: [research]
```

用途：

- 去重
- 幂等 ingest
- 状态管理
- 追溯来源

### 7.2 中间解析格式

统一为：

```json
{
  "source_id": "src_20260407_0001",
  "title": "Example Paper",
  "source_type": "pdf",
  "sections": [
    {"heading": "Abstract", "text": "..."},
    {"heading": "Introduction", "text": "..."}
  ],
  "full_text": "...",
  "metadata": {"lang": "en"}
}
```

这样可以将“解析问题”和“知识编译问题”拆开。

### 7.3 页面类型

第一版定义以下通用页面类型：

1. `source_summary`
2. `concept`
3. `entity`
4. `topic`
5. `analysis`
6. `report`
7. `overview`
8. `index`
9. `log`

### 7.4 页面 Frontmatter 规范

通用 frontmatter 建议如下：

```yaml
---
id: concept-transformer
page_type: concept
title: Transformer
kb_id: llm-infra
created_at: 2026-04-07
updated_at: 2026-04-07
status: active
source_ids:
  - src_20260407_0001
  - src_20260407_0003
tags:
  - architecture
  - llm
aliases: []
related_pages:
  - concept-attention
  - topic-sequence-modeling
confidence: medium
review_state: auto
---
```

### 7.5 页面正文建议结构

除 `index.md` 和 `log.md` 外，正文尽量遵循统一结构：

```markdown
# 页面标题

## TL;DR

## Key Points

## Current Understanding

## Open Questions

## Related Pages

## Source References
```

### 7.6 Source Summary 页面规范

每个 source 都应有一页摘要，建议模板：

```markdown
# Source: Example Paper

## Metadata
- source_id: src_20260407_0001
- type: pdf
- imported_at: 2026-04-07

## Summary

## Key Claims

## Entities Mentioned

## Concepts Mentioned

## Suggested Wiki Updates

## Source References
```

---

## 8. 特殊文件设计

### 8.1 `index.md`

`index.md` 是内容导航入口。第一版把它作为 Query 的第一跳。

建议结构：

```markdown
# Index

## Overview
- [[overview]] — 当前知识域总览

## Sources
- [[sources/src_20260407_0001]] — Example Paper 摘要页

## Concepts
- [[concepts/transformer]] — Transformer 架构概念页

## Entities
- [[entities/openai]] — OpenAI 实体页

## Topics
- [[topics/attention-mechanisms]] — Attention 相关主题页

## Analyses
- [[analyses/transformer-vs-rnn]] — Transformer vs RNN 对比分析
```

设计要求：

- 每次 ingest 后增量更新
- 每条记录一行摘要
- 保持类别分组
- 页面新增或重命名后必须同步

### 8.2 `log.md`

`log.md` 是 append-only 时间线。

建议格式：

```markdown
## [2026-04-07 14:30] ingest | Example Paper
- source_id: src_20260407_0001
- created: sources/src_20260407_0001.md
- updated: concepts/transformer.md, topics/sequence-modeling.md
- commit: abc1234

## [2026-04-07 16:10] query | Transformer 的并行化优势
- pages_read: index.md, concepts/transformer.md, topics/sequence-modeling.md
- output: chat answer
- save_back: no
```

设计要求：

- 固定标题前缀，便于脚本解析
- 记录核心输入与输出
- 不修改历史项，仅追加

---

## 9. Schema 与 AGENTS.md 设计

### 9.1 AGENTS.md 的职责

`AGENTS.md` 是系统行为的最高优先级约束文件，负责告诉 LLM：

- 当前 workspace 与 kb 的结构
- 允许创建哪些页面
- 每类任务的标准流程
- 什么情况下必须输出 patch 而不是直接修改
- 什么情况下必须提示人工审核
- 输出格式、命名规则、frontmatter 规则

### 9.2 AGENTS.md 应至少覆盖的内容

1. 项目目标与边界
2. 目录结构说明
3. 页面命名规范
4. ingest 流程
5. query 流程
6. lint 流程
7. patch 输出格式
8. review 规则
9. 引用与追溯规则
10. 不允许的操作

### 9.3 v1 的约束倾向

第一版采取 **高约束、低自由度**：

- 不允许 agent 自发扩展目录层级
- 不允许创建未声明 page type
- 不允许直接改 raw sources
- 不允许跳过 patch plan 直接批量改 Wiki

---

## 10. Ingest 工作流

### 10.1 目标

将一个新增 source 编译进现有 Wiki，并形成：

- source summary 页面
- index 更新
- log 更新
- 相关 concept / entity / topic 页面更新
- patch plan 与 git commit

### 10.2 Ingest 分阶段流程

#### 阶段 1：登记与解析

输入：

- 新 source 文件或 URL

动作：

1. 计算 `content_hash`
2. 分配 `source_id`
3. 保存原件到 `raw/processed/`
4. 解析正文并写入 manifest

输出：

- `manifest.yaml/json`
- 标准化文本内容

#### 阶段 2：生成 patch plan

LLM 读取：

- 该 source 内容
- `index.md`
- 相关页面候选（可由索引或关键字检索给出）

输出一个结构化 patch plan，例如：

```json
{
  "source_id": "src_20260407_0001",
  "create": [
    "wiki/sources/src_20260407_0001.md"
  ],
  "update": [
    "wiki/index.md",
    "wiki/log.md",
    "wiki/concepts/transformer.md"
  ],
  "reasoning_summary": [
    "新增 source summary",
    "在 Transformer 概念页补充来自该 source 的补充说明"
  ],
  "risk_level": "medium",
  "requires_review": true
}
```

#### 阶段 3：生成文件级 diff

由 Writer 生成：

- 新建文件内容
- 修改后的目标文件内容
- 可读 diff

#### 阶段 4：审核与执行

规则：

- 仅更新 source summary + index + log：可自动通过
- 影响概念页、主题页、分析页：默认待审核
- 修改 5 个以上文件或出现冲突词：强制待审核

执行后：

- 写入文件
- 追加 `log.md`
- 生成 Git commit
- 保存 patch 元数据到 `state/patches/`

### 10.3 Ingest 幂等性

系统必须支持重复 ingest 同一 source 时不产生重复页面。

依赖：

- `content_hash`
- `source_id`
- `status`
- patch plan 中的去重判断

### 10.4 Ingest 成功标准

一次 ingest 完成后，应满足：

- source 已注册
- source summary 已存在
- index 已收录
- log 已追加
- 所有变更均可追溯到本次 patch 和 commit

---

## 11. Query 工作流

### 11.1 Query 的目标

Query 主要服务两类需求：

1. 给出快速答案
2. 给出知识导航

因此 Query 输出不应只是一段自然语言，而应优先采用以下结构：

- 简短结论
- 使用到的页面
- 相关页面建议
- 仍不确定的点

### 11.2 Query 流程

#### 步骤 1：读取 `index.md`

通过索引缩小候选页面范围。

#### 步骤 2：读取目标页面

优先读取：

- 相关 concept
- 相关 topic
- 相关 analysis
- 必要时读取对应 source summary

#### 步骤 3：综合回答

输出内容建议包含：

- 回答结论
- 基于哪些 wiki 页面得出
- 是否存在页面冲突或信息缺口
- 推荐进一步查看哪些页面

#### 步骤 4：可选保存提案

如果回答明显具备长期价值，则生成“保存提案”而非直接回写。

例如：

```yaml
save_back_proposal:
  suggested_page_type: analysis
  suggested_path: wiki/analyses/transformer-vs-rnn.md
  reason: 该回答对已有内容进行了清晰对比总结，具备长期复用价值
  requires_user_confirmation: true
```

### 11.3 Query 的结果形式

第一版以 Markdown 结构化回答为主，支持：

- 简答
- 对比表
- 页面列表
- 后续研究建议

暂不在系统内置：

- 图表自动生成
- Slide deck
- Canvas 可视化

### 11.4 Query 成功标准

- 回答优先基于 Wiki，而不是直接绕过 Wiki 读 raw source
- 回答能指出引用页面
- 能发现知识空白与下一步阅读路径

---

## 12. Lint 工作流

### 12.1 目标

定期体检 Wiki，降低知识库随时间失控的概率。

### 12.2 v1 检查项

第一版 Lint 检查以下项目：

1. **坏链接**
2. **孤儿页**（无入链）
3. **未收录页面**（页面存在但 index 中缺失）
4. **source 缺失**（页面未声明 `source_ids`）
5. **基础冲突提示**（同一主题页出现明显冲突表述）
6. **页面空壳**（仅标题无有效内容）
7. **长期未更新页面**（可选）

### 12.3 Lint 输出

输出到：

- `wiki/reports/lint-YYYYMMDD.md`
- `state/runs/lint-YYYYMMDD.json`

报告示例：

```markdown
# Lint Report - 2026-04-07

## Broken Links
- [[concepts/old-name]] referenced by [[topics/foo]] but file missing

## Orphan Pages
- [[analyses/bar]]

## Missing in Index
- [[concepts/baz]]

## Missing Source IDs
- [[topics/qux]]
```

### 12.4 Lint 修复策略

第一版只做：

- 报告
- 给出修复建议
- 可选生成 repair patch plan

不默认自动修复。

---

## 13. Patch 与版本治理机制

### 13.1 为什么必须有 Patch 层

如果让 LLM 直接写 Wiki，容易出现：

- 无法审查改动意图
- 难以定位问题来源
- 回滚成本高
- 大面积污染不易发现

因此 v1 采用：

> **先计划，再 diff，再应用，再 commit**

### 13.2 Patch 数据结构

建议保存为 JSON/YAML：

```yaml
patch_id: patch_20260407_001
kb_id: llm-infra
operation: ingest
source_id: src_20260407_0001
created_at: 2026-04-07T14:20:00+08:00
risk_level: medium
requires_review: true
create:
  - wiki/sources/src_20260407_0001.md
update:
  - wiki/index.md
  - wiki/concepts/transformer.md
diff_files:
  - state/patches/patch_20260407_001/index.diff
review:
  status: pending
  reviewer: null
apply:
  status: not_applied
git_commit: null
```

### 13.3 Commit 规范

建议采用统一 commit message：

```text
ingest(src_20260407_0001): add source summary and update transformer pages
query(saveback): add analysis page for transformer vs rnn
lint(repair): fix missing index entries
```

### 13.4 回滚策略

回滚优先依赖 Git：

- 回滚单次 patch：`git revert <commit>`
- 回滚批量变更：切换到指定 tag / branch

### 13.5 审计最低要求

第一版至少要能回答：

- 这个页面是谁在什么操作中改的
- 这次改动来源于哪个 source 或 query
- 对应的 patch 和 commit 是什么

---

## 14. 搜索与导航设计

### 14.1 v1 搜索策略

不引入向量库，采用两层搜索：

1. `index.md` 目录导航
2. 本地全文检索（如 ripgrep 或简单 SQLite FTS）

### 14.2 为什么不先上向量库

因为当前边界下，优先目标是：

- 让知识结构沉淀下来
- 让页面稳定可维护
- 让 patch 和 Git 路径跑通

而不是提前优化复杂检索。

### 14.3 后续演进方向

当规模达到：

- 数百 source
- 数百到上千页面

可增加：

- SQLite FTS 强化版
- BM25 检索
- qmd 或其他本地 markdown 搜索工具
- 混合检索 + rerank

---

## 15. 模型层抽象设计

### 15.1 目标

模型层必须可切换，避免系统逻辑绑定单一模型提供方。

### 15.2 角色抽象

建议抽象以下能力接口：

```python
class ParserModel:
    def summarize_source(self, parsed_source): ...

class PlannerModel:
    def plan_ingest(self, source, wiki_context): ...
    def plan_repair(self, lint_report, wiki_context): ...

class WriterModel:
    def render_pages(self, patch_plan, wiki_context): ...

class QueryModel:
    def answer(self, question, page_context): ...
```

### 15.3 v1 模型使用建议

第一版建议策略：

- 大模型：负责 ingest plan、页面写作、query synthesis
- 小模型或规则逻辑：负责基础分类、文件检查、lint 初筛

### 15.4 模型切换接口

配置层建议支持：

```yaml
models:
  planner:
    provider: openai
    model: gpt-5.4-thinking
  writer:
    provider: anthropic
    model: claude-code-like
  query:
    provider: local
    endpoint: http://127.0.0.1:8000/v1
    model: qwen-local
```

这样可以：

- 本地与 API 混用
- 逐步迁移成本更低
- 不影响上层工作流

---

## 16. CLI 命令约定

第一版优先 CLI。

建议提供以下命令：

### 16.1 Source 导入

```bash
kb ingest ./raw/inbox/example.pdf --kb llm-infra
kb ingest https://example.com/article --kb riscv-tee
```

### 16.2 Query

```bash
kb query "Transformer 的并行化优势是什么" --kb llm-infra
kb query "列出与 secure boot 相关的页面" --kb riscv-tee
```

### 16.3 Lint

```bash
kb lint --kb llm-infra
kb lint --kb all
```

### 16.4 审核与应用 Patch

```bash
kb patch list --kb llm-infra
kb patch show patch_20260407_001
kb patch approve patch_20260407_001
kb patch apply patch_20260407_001
```

### 16.5 重建索引

```bash
kb rebuild-index --kb llm-infra
```

### 16.6 保存 Query 结果

```bash
kb save-answer answer_20260407_01 --as analysis --kb llm-infra
```

---

## 17. SQLite 状态数据库建议表结构

第一版可使用以下核心表：

### 17.1 `sources`

- `source_id`
- `kb_id`
- `title`
- `source_type`
- `content_hash`
- `status`
- `created_at`
- `origin_url`
- `file_path`

### 17.2 `pages`

- `page_id`
- `kb_id`
- `path`
- `page_type`
- `title`
- `updated_at`
- `review_state`

### 17.3 `patches`

- `patch_id`
- `kb_id`
- `operation`
- `source_id`
- `risk_level`
- `requires_review`
- `status`
- `created_at`
- `commit_hash`

### 17.4 `runs`

- `run_id`
- `kb_id`
- `run_type`
- `status`
- `started_at`
- `ended_at`
- `artifact_path`

### 17.5 `page_sources`

- `page_id`
- `source_id`

用途：

- 页面与来源的多对多映射
- 便于追溯与 lint

---

## 18. MVP 范围定义

### 18.1 必做

1. 一个 kb 的基本创建能力
2. Markdown / 网页 / 文本 PDF ingest
3. source manifest 生成
4. source summary 页面生成
5. `index.md` / `log.md` 自动维护
6. patch 生成与人工审核
7. Git commit
8. 基础 query
9. 基础 lint

### 18.2 可延后

1. 多 kb 全局搜索
2. 自动回写策略精细化
3. 修复 patch 自动生成
4. 前端界面
5. 向量检索
6. Dataview / Obsidian 插件联动优化

### 18.3 不在 v1 范围

1. 企业权限
2. 多人协作并发
3. 音视频 ingest
4. OCR
5. 图谱数据库
6. 自动 schema 演化

---

## 19. 质量指标与验收标准

### 19.1 写入质量

- source ingest 成功率
- patch 审核通过率
- 页面污染率（被回滚比例）
- `index.md` 同步率
- source summary 完整率

### 19.2 查询质量

- query 命中率
- query 使用 Wiki 页面比例
- 导航建议命中感知
- 保存提案采纳率

### 19.3 知识库健康度

- 孤儿页比例
- 缺 source_id 页面比例
- 坏链接数量
- 长期未更新高价值页数量

### 19.4 工程稳定性

- ingest 幂等性
- patch 应用成功率
- Git 提交失败率
- lint 扫描耗时

---

## 20. 风险与应对

### 风险 1：混合型知识域导致 schema 过早复杂化

**应对**：

- 第一版只保留通用 page type
- 通过 `kb` 分隔知识域
- 不在 v1 引入知识域专属复杂模板

### 风险 2：LLM 大面积修改带来知识污染

**应对**：

- patch-first
- 半自动审核
- Git 回滚
- 高风险更新强制 review

### 风险 3：页面之间逐渐失去一致性

**应对**：

- 定期 lint
- 强制 frontmatter 规则
- `index.md` 与 `log.md` 作为系统锚点

### 风险 4：Query 绕过 Wiki 直接依赖原文

**应对**：

- AGENTS.md 明确要求 query 先读索引与页面
- raw source 只作为必要补充证据

### 风险 5：模型切换导致输出风格不稳定

**应对**：

- 模型层抽象
- 强 schema 约束
- 输出先经 patch 结构化再落盘

---

## 21. 实施路线图

### Phase 0：仓库初始化

目标：建立基本目录与 Git 仓库。

交付：

- workspace 初始化脚本
- kb 模板目录
- 基础 `AGENTS.md`
- SQLite 初始表结构

### Phase 1：Ingest MVP

目标：跑通 source -> summary -> index/log -> patch -> commit。

交付：

- source register
- parser
- patch plan 生成
- patch apply
- git commit

### Phase 2：Query MVP

目标：基于现有 Wiki 稳定回答问题并给导航建议。

交付：

- index first query
- page selection
- markdown structured answer
- save-back proposal

### Phase 3：Lint MVP

目标：让 Wiki 具备基本体检能力。

交付：

- broken links
- orphan pages
- missing index entries
- missing source_ids
- lint report

### Phase 4：增强与演进

候选增强：

- FTS / BM25 搜索
- repair patch
- Obsidian 联动
- 多 kb 搜索
- 更细颗粒度的 provenance

---

## 22. 推荐的 v1 技术栈

### 核心

- Python 3.11+
- Markdown 文件系统
- SQLite
- Git

### 解析

- 网页：readability / trafilatura 类正文提取
- PDF：pdf text extraction 工具
- Markdown/TXT：原生读取

### 检索

- ripgrep / SQLite FTS（后续可选）

### 模型层

- 统一 OpenAI-compatible 接口优先
- 本地模型与 API 模型都通过适配器接入

### 编辑器 / 浏览器

- Obsidian（推荐，但非强依赖）

---

## 23. 对后续文档的建议拆分

为了真正落地，建议在本文之后继续产出三份子文档：

1. **`AGENTS.md` 初稿**  
   写清系统规则与工作流。

2. **页面模板集**  
   包括 `source_summary`、`concept`、`topic`、`analysis` 模板。

3. **CLI 命令与状态机说明**  
   明确每个命令的输入、输出、失败状态和恢复逻辑。

---

## 24. 结论

在当前约束下，最合适的落地路径不是做一个“高级聊天问答系统”，而是做一个：

> **Git 驱动、Patch 驱动、Schema 驱动的本地知识编译器。**

它的核心价值不在于一次回答多聪明，而在于：

- 每新增一个 source，知识库都会真实变得更完整
- 每提出一个好问题，都可能沉淀成长期资产
- 每次修改都有痕迹、可审查、可回滚
- 知识结构会越来越稳定，而不是越来越混乱

这就是本方案的 v1 目标。

---

## 附录 A：v1 默认策略清单

- 单用户、本地 / 私有部署
- 一个 workspace 下多个 kb
- Source 限定为 Markdown / 网页 / 文本型 PDF
- 半自动写入
- 页面级 `source_id` 追溯
- Query 以快速问答 + 导航发现为主
- 回答仅在用户确认后回写
- 使用 Git 做版本治理
- 使用文件系统 + SQLite
- 不引入向量库
- 使用 CLI 为主
- 使用强约束 schema

---

## 附录 B：建议优先实现的文件

1. `schema/AGENTS.md`
2. `schema/page_templates/source_summary.md`
3. `schema/page_templates/concept.md`
4. `scripts/ingest.py`
5. `scripts/query.py`
6. `scripts/lint.py`
7. `scripts/rebuild_index.py`
8. `state/schema.sql`

