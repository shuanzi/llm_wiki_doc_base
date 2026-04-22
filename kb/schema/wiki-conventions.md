# Wiki 约定

本文档是 LLM Agent 在操作 wiki 知识层时的行为指南。工具层（`kb_write_page`、`kb_update_section` 等）处理 I/O 和校验；本文档定义 **内容层面的约定**，由 Agent 自觉遵守。

---

## 页面类型与目录映射

| type | 目录 | 说明 |
|------|------|------|
| `source` | `wiki/sources/` | 源文件的 LLM 提炼摘要 |
| `entity` | `wiki/entities/` | 实体：技术、产品、组织、人物、项目 |
| `concept` | `wiki/concepts/` | 概念：方法、理论、主题、设计模式 |
| `analysis` | `wiki/analyses/` | 分析：对比、综合、深度研究（通常由 query 回写产生） |
| `report` | `wiki/reports/` | 报告：lint 报告、专题报告 |
| `index` | `wiki/` | 索引页（如 index.md、各子目录的 index.md） |

自定义类型允许使用，但工具会发出 warning。优先使用核心类型。

---

## Frontmatter 规范

### 必填字段

```yaml
---
id: risc_v                          # 全局唯一 | 仅 [a-z0-9_-]
type: entity                        # 核心类型或自定义
title: RISC-V                       # 页面标题
updated_at: 2026-04-12              # ISO 日期 (YYYY-MM-DD)
status: active                      # active | stub | deprecated
---
```

### 可选字段

```yaml
tags: [architecture, open-source]   # 自由标签，用于搜索过滤
aliases: [RISC-V ISA, riscv]        # 别名，支持 [[别名]] 搜索和 wikilink 解析
source_ids: [src_sha256_xxx]        # 关联的源文件 ID
related: [U-Boot, TEE]              # 相关页面（wikilink 目标）
```

### Status 语义

- **active**: 内容充实，信息可靠
- **stub**: 页面已建立但内容待充实（知道有这个实体/概念，但信息不足）
- **deprecated**: 内容已过时或被合并到其他页面

---

## 链接约定

- 页面间引用使用 `[[wikilinks]]` 格式
- 引用源文件使用 `[[source_id|显示标题]]` 管道语法
- Entity/concept 页面 **首次提到** 其他 entity/concept 时建立链接
- 不要过度链接——同一页面内对同一目标只链接第一次出现

---

## ID 命名约定

- 使用小写英文 + 下划线：`risc_v`、`secure_boot`、`docker`
- 源页面 ID 使用 source_id 原值：`src_sha256_xxxxxxxx`
- 避免过长的 ID，保持简洁可读
- 复合概念用下划线连接：`trusted_execution_environment`

---

## 内容约定

### Source 页面

- 提炼关键洞见，**不是原文截取**
- 包含结构化摘要：文档概述、关键要点、核心论断
- 建立与相关 entity/concept 页面的 wikilinks
- 包含 `## 来源` section 标注原始文件信息

### Entity / Concept 页面

- 综合 **所有** 相关源的信息，而非只反映最近一次 ingest
- 新 ingest 时优先 `kb_update_section` 追加，避免重写已有内容
- 信息不足时使用 `status: stub`，后续 ingest 持续充实
- 推荐的 section 结构：

```markdown
# {title}

{概述段落}

## 关键特性
{综合多源的要点}

## 关联
- [[Entity A]] — 关系说明
- [[Concept B]] — 关系说明

## 来源
- 基于 [[src_sha256_xxx|Source Title]]
- 基于 [[src_sha256_yyy|Another Source]]
```

### Analysis 页面

- 由 `kb_query` 回写产生，通常是深度对比或综合分析
- 应明确列出分析依据（引用的 wiki 页面和源文件）
- 标注分析的局限性和假设

---

## 矛盾处理

发现新源与已有页面矛盾时：
1. 在源摘要页用 `> ⚠️` 标注：`> ⚠️ 本文称 X，但 [[Y]] 认为 Z`
2. 在被矛盾的页面相关 section 追加说明
3. 如果矛盾重大，告知用户并等待判断

---

## index.md 格式

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

每个条目：wikilink + 一行摘要 + 可选的 source 计数。

## log.md 格式（操作时间线）

`log.md` 记录操作时间线，至少覆盖：
- ingest
- meaningful query（满足下列操作条件的 wiki synthesis）
- 完整 lint pass（含 `No findings` 的 clean pass）

meaningful query 的可执行判定（需同时满足）：
1. 执行过 `kb_search_wiki`
2. 执行 `kb_read_page` 且精读了至少 2 个不同 wiki 页面
3. 最终回答包含综合性产出（对比/取舍结论/冲突归并/证据缺口）并引用相关页面

不记录：
- trivial chat / 仅寒暄式问答
- one-hop lookup（仅查 1 个页面并直接摘录事实或定义，无综合结论）
- 半途终止操作（未形成有效结果）

`dedup_key` 粒度约定（避免同日同主题或同 scope 的多次操作被合并）：
- query: `log_query_{topic}_{run_id}`
- lint: `log_lint_{scope}_{run_id}`
- `run_id` 使用唯一值，建议 `YYYYMMDDTHHMMSS`（例如 `20260419T141530`）

```markdown
## [2026-04-12] ingest | Docker Containers on RISC-V Architecture
- 新建: [[src_sha256_xxx|Source Summary]]
- 新建: [[risc_v|RISC-V]] (entity)
- 更新: [[docker|Docker]] — 新增 RISC-V 相关段落
- 更新: index.md — 3 entries added

## [2026-04-12] query | RISC-V 安全方案对比
- run_id: 20260412T153045
- 结论: 场景 A 优先方案 X，场景 B 优先方案 Y
- 参考: [[risc_v]], [[secure_boot]]
- 产出: [[riscv_security_comparison|RISC-V 安全方案对比]] (analysis)

## [2026-04-12] lint | wiki 全量
- run_id: 20260412T160010
- 结果: 存在少量结构问题，建议本轮修复幽灵链接
- 发现: 2/5/3
- 产出: [[lint_2026_04_12|Lint Report 2026-04-12]] (report)

## [2026-04-13] lint | wiki 全量
- run_id: 20260413T090500
- 结果: No findings（clean pass）
- 发现: 0/0/0
```

结构化前缀 `## [日期] 操作 | 标题`，方便 grep 解析。
