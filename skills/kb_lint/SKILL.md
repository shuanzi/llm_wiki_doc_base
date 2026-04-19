---
name: kb_lint
description: 检查知识库健康度，发现矛盾、孤岛、缺失、过时内容
user-invocable: true
---

当用户要求检查知识库质量、健康度、或查找问题时：

### 第 1 步：建立全局视图

1. 使用 `kb_read_page({ path_or_id: "wiki/index.md" })` 读取 index.md 获取人类可见的页面清单
2. 直接使用 Read 工具读取 `kb/state/cache/page-index.json` 获取全部页面的机器清单
   - 注意：`kb_search_wiki` 是关键词搜索，不能用作"列出全部"——必须直接读 JSON
3. 可选：直接读 `kb/state/manifests/` 目录列出所有已注册源文件
4. 对比 index.md 与 page-index.json，识别不一致

### 第 2 步：结构健康检查

**孤岛页面**：
- 在 page-index.json 中存在，但 index.md 没有链接到它
- 修复建议：`kb_ensure_entry` 添加到 index.md 对应 section

**幽灵链接**：
- 页面中 `[[wikilink]]` 指向不存在的页面
- 使用 `kb_search_wiki(resolve_link: "[[target]]")` 检查链接目标是否存在
- 修复建议：创建缺失页面（stub）或修正链接

**缺失页面**：
- 多个页面提到某个 entity/concept 但没有独立页面
- 修复建议：创建 stub 页面

**missing cross-references**：
- 已有相关页面，但没有建立必要的 `[[wikilink]]` 或 index 交叉引用
- 与“孤岛页面 / 缺失页面”不同：不是页面不存在，也不是 index 漏挂单页，而是应互相引用的已存在页面未建立关联
- 修复建议：补充必要 wikilink 与 index 入口（如需）

**Stub 堆积**：
- 统计 `status: stub` 的页面数量
- 检查是否有足够的源信息可以充实它们
- 修复建议：基于已有源信息充实 stub 页面

### 第 3 步：内容健康检查

**矛盾检测**：
- 抽样阅读同一主题的多个页面（`kb_read_page`）
- 对比关键论断，发现冲突结论
- 修复建议：在矛盾页面添加 ⚠️ 标注，建议用户裁定

**过时内容**：
- 检查页面的 `updated_at` 日期
- 新源是否推翻了旧页面的结论
- 修复建议：标记为需要更新或 deprecated

**覆盖度分析**：
- 列出所有已注册源文件（通过 manifests 目录）
- 检查每个源是否有对应的 source 摘要页
- 检查源中的关键 entity/concept 是否已有独立页面
- 修复建议：建议用户对覆盖不足的源重新 ingest

**data gaps that could be filled with a web search**：
- 仅标记候选搜索问题或待外部检索点（当前 `kb/wiki` + `kb/raw` 无法支持的事实空缺）
- 不自动补事实，不在 lint 阶段生成未经核实的新结论
- 修复建议：由用户确认后再进行外部检索与回写

### 第 4 步：报告与修复

**报告格式**：

按严重性排序输出发现，使用以下分类：

```
🔴 错误 — 必须修复（幽灵链接、数据不一致）
🟡 警告 — 建议修复（孤岛页面、stub 堆积）
🔵 建议 — 可选改进（覆盖度不足、可充实的 stub）
```

- `missing cross-references` 通常归为 `🟡 警告`；`data gaps that could be filled with a web search` 通常归为 `🔵 建议`。

**交互式修复**：
- 报告完成后，询问用户想修复哪些项目
- 用户选择后，使用 `kb_write_page`、`kb_update_section`、`kb_ensure_entry` 执行修复
- 修复完成后 `kb_commit` — message: `kb: lint fix — {简短描述}`

### Lint 日志（完整 pass，含 clean pass）

完成一次完整 lint pass（即完成结构/内容检查并输出结果）后，必须追加简短日志到 `wiki/log.md`，即使不保存 report 页面、即使结果是 `No findings`。  
这里的“零输出”仅指半途终止或未产出结果；`No findings` 是有效结果（`0/0/0`）并且必须记录。

- 不保存 report 时：
  - 先生成本次 lint 的唯一 `run_id`（建议 `YYYYMMDDTHHMMSS`，如 `20260419T142010`）
  - `kb_ensure_entry({ path: "wiki/log.md", anchor: null, dedup_key: "log_lint_{scope}_{run_id}", entry: "## [{date}] lint | {scope}\n- run_id: {run_id}\n- 结果: {一句话总结（可为 No findings / clean pass）}\n- 发现: {错误数}/{警告数}/{建议数}" })`

### 可选：保存报告

如果检查发现较多问题，建议用户将报告保存为 wiki 页面。选定 `report_id`（如 `lint_2026_04_12`）：

- `kb_write_page({ path: "wiki/reports/{report_id}.md", content: ... })` — type: report
  - 检查返回的 `warnings[]`
- `kb_ensure_entry({ path: "wiki/index.md", anchor: "## Reports", dedup_key: "index_{report_id}", entry: "- [[{report_id}|Lint Report {date}]] — summary" })`
- 在同一次 lint pass 语义下记录结果（包含 report 产出，沿用同一个 `run_id`）：
  - `kb_ensure_entry({ path: "wiki/log.md", anchor: null, dedup_key: "log_lint_{scope}_{run_id}", entry: "## [{date}] lint | {scope}\n- run_id: {run_id}\n- 结果: {一句话总结}\n- 发现: {错误数}/{警告数}/{建议数}\n- 产出: [[{report_id}|Lint Report {date}]] (report)" })`
- `kb_commit` — message: `kb: lint report — {date}`

### 内容约定

- 遵守 `kb/schema/wiki-conventions.md` 中的所有约定
- 修复操作应保守——优先标注问题而非自动修改内容
- 矛盾处理交由用户裁定，不自行决定哪方正确
