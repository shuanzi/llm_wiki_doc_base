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

### 查询日志（满足 meaningful query 条件时）

将一次查询记为 meaningful query（需写 `wiki/log.md`）时，必须同时满足以下操作条件：
- 使用过 `kb_search_wiki`
- 使用 `kb_read_page` 精读了 **至少 2 个不同 wiki 页面**
- 最终回答包含综合性产出（如对比、取舍结论、冲突归并、明确的证据缺口），并引用了相关页面

不记日志的边界：
- trivial chat / 仅寒暄式问答（未进入 wiki 检索）
- one-hop lookup（仅查 1 个页面并直接摘录事实或定义，无综合结论）

- 无 analysis 落盘时，也要记录：
  - 先生成本次 query 的唯一 `run_id`（建议 `YYYYMMDDTHHMMSS`，如 `20260419T141530`）
  - `kb_ensure_entry({ path: "wiki/log.md", anchor: null, dedup_key: "log_query_{topic}_{run_id}", entry: "## [{date}] query | {topic}\n- run_id: {run_id}\n- 结论: {一句话结论}\n- 参考: [[page_a]], [[page_b]]" })`

### 结果回写（当回答有长期价值时）

如果你的回答是 **深度分析、对比、综合**——即超越了简单检索的知识产出——建议用户将其沉淀为 wiki 页面：

1. 向用户提议："这个分析有长期参考价值，是否要保存到 wiki？"
2. 用户同意后，选定一个稳定的 `topic_id`（如 `riscv_security_comparison`）：
   - `kb_write_page({ path: "wiki/analyses/{topic_id}.md", content: ... })` — type: analysis
     - 检查返回的 `warnings[]`，非空时向用户报告并修正
   - `kb_ensure_entry({ path: "wiki/index.md", anchor: "## Analyses", dedup_key: "index_{topic_id}", entry: "- [[{topic_id}|Title]] — summary" })`
   - 在同一次 query 语义下记录结果（包含 analysis 产出，沿用同一个 `run_id`）：
     - `kb_ensure_entry({ path: "wiki/log.md", anchor: null, dedup_key: "log_query_{topic}_{run_id}", entry: "## [{date}] query | {topic}\n- run_id: {run_id}\n- 结论: {一句话结论}\n- 产出: [[{topic_id}|Title]] (analysis)\n- 参考: [[page_a]], [[page_b]]" })`
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
