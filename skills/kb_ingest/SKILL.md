---
name: kb_ingest
description: 将新源文件整合到知识库中，创建/更新多个 wiki 页面
user-invocable: true
---

当用户要求添加新源、更新知识库、或将新材料整合到 wiki 时：

### 第 1 步：注册与阅读

1. `kb_source_add(file_path)` → 获取 source_id、file_name
2. `kb_read_source(source_id)` → 获取完整原文
3. 仔细阅读原文，理解核心内容、关键实体和概念

### 第 2 步：分析与规划（向用户报告）

阅读完原文后，告诉用户你的分析结果：

- **文档概述**（2-3 句话概括文档内容）
- **你将创建的页面**：源摘要页 + 新 entity/concept 页面列表
- **你将更新的已有页面**：通过 `kb_search_wiki` 查找匹配，列出具体页面和更新原因
- **发现的矛盾或值得注意的关联**

等用户确认后继续。如果用户要求调整，按调整后的方案执行。

### 第 3 步：写入源摘要页

使用 `kb_write_page` 创建 `wiki/sources/{source_id}.md`：

```yaml
---
id: {source_id}
type: source
title: {LLM 概括的标题}
updated_at: {今天日期}
status: active
source_ids: [{source_id}]
tags: [{从内容提取的标签}]
---
```

Body 内容由你撰写——结构化摘要，包含：
- 文档概述
- 关键要点（提炼，不是原文截取）
- 核心论断和结论
- 与其他 wiki 页面的关联（使用 `[[wikilinks]]`）

### 第 4 步：创建/更新 Entity 页面

对每个识别出的关键实体（技术、产品、组织、人物等）：

1. `kb_search_wiki(query)` 检查是否已有页面
2. **已有页面** → `kb_read_page` 读取，使用 `kb_update_section` **追加** 新源信息
   - **必须传 `append: true`**——默认是 replace，会静默覆盖原 section 内容
   - 向 `## 来源` section append: `- 基于 [[{source_id}|{title}]]`
   - 向 `## 关键特性` 等内容 section append 新源带来的补充信息
   - 不要重写已有内容，只追加
3. **新实体** → `kb_write_page` 创建 `wiki/entities/{id}.md`
   - 信息充足时 status: active
   - 信息不足时 status: stub（后续 ingest 持续充实）
   - 建立与相关 entity/concept 页面的 wikilinks
4. 检查 `kb_write_page` 返回的 `warnings[]`：
   - 非空时向用户报告警告（如 unknown type、目录不匹配）
   - 等用户确认或修正后再继续

### 第 5 步：创建/更新 Concept 页面

对每个识别出的核心概念（方法、理论、主题、设计模式等），流程同 Entity：

1. 搜索已有页面
2. 已有 → `kb_update_section` **带 `append: true`** 追加更新
3. 新概念 → `kb_write_page` 创建 `wiki/concepts/{id}.md`，检查 warnings

### 第 6 步：更新索引和日志

1. 对每个新建的页面，使用 `kb_ensure_entry` 在 `wiki/index.md` 对应 section 下添加条目
   - `path`: `"wiki/index.md"`
   - `anchor`: 对应的 section heading（如 `"## Sources"`、`"## Entities"`、`"## Concepts"`）
   - `dedup_key`: `"index_{page_id}"`（稳定、每个页面只能有一个索引条目）
   - `entry`: `- [[page_id|Title]] — 一行摘要`

2. 使用 `kb_ensure_entry` 在 `wiki/log.md` 添加本次 ingest 日志
   - `path`: `"wiki/log.md"`
   - `anchor`: `null`（追加到末尾）
   - `dedup_key`: `"log_ingest_{source_id}"`（每次 ingest 一条，重跑不重复）
   - `entry`: 结构化日志，格式 `## [日期] ingest | {标题}`，后跟变更列表

### 第 7 步：提交

`kb_commit` — message 格式: `kb: ingest {source_id} — {简短描述}`

---

### 矛盾检测（Ingest 时）

阅读新源时，对每个关键论断：

1. 通过 `kb_search_wiki` 查找相关页面
2. 通过 `kb_read_page` 阅读相关内容
3. 发现与已有页面矛盾时：
   - 在源摘要页标注: `> ⚠️ 本文称 X，但 [[Y]] 认为 Z`
   - 在被矛盾页面的相关 section 追加说明
   - 在报告中告知用户

### 内容约定

- 遵守 `kb/schema/wiki-conventions.md` 中的所有约定
- 使用 `[[wikilinks]]` 建立页面间引用
- 引用源文件使用 `[[source_id|显示标题]]`
- ID 使用小写英文 + 下划线
- 摘要应提炼关键洞见，不是原文截取
