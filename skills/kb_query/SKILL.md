---
name: kb_query
description: 基于 wiki 知识层回答问题，高价值回答可沉淀为分析页
user-invocable: true
---

当用户基于知识库提问时：

### 回答问题

1. `kb_search_wiki(query)` 搜索相关页面
   - 使用多个关键词组合搜索，确保覆盖面
   - 利用 type_filter 和 tags 缩小范围
2. `kb_read_page` 精读 top 结果（通常 3-5 篇）
3. 综合 wiki 内容回答，引用具体页面：`[[页面名]]`
4. 缺少关键信息时 **明确说明**，不要推测

### 回答原则

- **wiki 优先**：优先使用 wiki 层已整合的知识，而非回忆原始源内容
- **明确溯源**：回答中引用具体的 wiki 页面和源文件
- **诚实缺失**：如果 wiki 中没有相关信息，直接告知用户，建议通过 `kb_ingest` 添加相关材料
- **结构化回答**：对比类问题用表格，列举类问题用列表

### 结果回写（当回答有长期价值时）

如果你的回答是 **深度分析、对比、综合**——即超越了简单检索的知识产出——建议用户将其沉淀为 wiki 页面：

1. 向用户提议："这个分析有长期参考价值，是否要保存到 wiki？"
2. 用户同意后，选定一个稳定的 `topic_id`（如 `riscv_security_comparison`）：
   - `kb_write_page({ path: "wiki/analyses/{topic_id}.md", content: ... })` — type: analysis
     - 检查返回的 `warnings[]`，非空时向用户报告并修正
   - `kb_ensure_entry({ path: "wiki/index.md", anchor: "## Analyses", dedup_key: "index_{topic_id}", entry: "- [[{topic_id}|Title]] — summary" })`
   - `kb_ensure_entry({ path: "wiki/log.md", anchor: null, dedup_key: "log_analysis_{topic_id}_{YYYY-MM-DD}", entry: "## [{date}] analysis | {title}\n- 新建: [[{topic_id}|Title]]" })`
   - `kb_commit` — message: `kb: analysis — {简短描述}`

### Analysis 页面格式

```yaml
---
id: {topic_id}
type: analysis
title: {分析标题}
updated_at: {今天日期}
status: active
tags: [{相关标签}]
source_ids: [{引用的 source_id 列表}]
related: [{相关的 entity/concept}]
---
```

Body 包含：
- 分析问题和背景
- 综合分析内容
- 引用的 wiki 页面（`[[wikilinks]]`）
- 结论和局限性说明

### 内容约定

- 遵守 `kb/schema/wiki-conventions.md` 中的所有约定
- 使用 `[[wikilinks]]` 引用 wiki 页面
- Analysis 页面应明确标注分析依据和局限性
