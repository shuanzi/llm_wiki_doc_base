# 真实数据全流程测试技术方案

## 结论

使用 MCP stdio server 作为真实数据工作流的主要测试入口是合理的。当前 MCP server 与 OpenClaw plugin 共享同一个运行时分派函数 `dispatchKbTool`，并共享同一组 `KB_TOOL_DEFINITIONS`。因此，MCP E2E 能覆盖实际工具实现逻辑；再用一个小的入口一致性测试防止 MCP 与 OpenClaw plugin 未来分叉。

## 架构

新增测试由四层组成：

1. 测试数据发现：读取 `tests/test-source/markdown/*.md` 和 `tests/test-source/url.txt`。
2. 干净 KB 初始化器：为每个 source 子测试创建全新的临时 KB。
3. MCP 测试客户端：通过本地 `node_modules/.bin/tsx --tsconfig tsconfig.scripts.json src/mcp_server.ts` 启动源码 MCP server，通过 MCP SDK 调用 `tools/list` 和 `tools/call`。这样新增测试被默认 `npm test` 收入时不会依赖预先存在或最新的 `dist/`。
4. 工作流驱动器：按 `TOOLS.md`「实战工作流」执行 ingest、wiki 写入、index/log、finalize、lint、search/read 验证。

建议新增文件：

- `tests/helpers/real-data-kb-fixture.ts`：创建干净 KB、发现测试数据、读取 artifact。
- `tests/helpers/mcp-client.ts`：封装 MCP stdio server 启停、call tool、JSON 解析、错误断言。
- `tests/real-data-e2e.test.ts`：Markdown 默认真实数据 E2E、URL 显式启用 E2E、MCP/OpenClaw 入口一致性测试。

不建议复用 `scripts/e2e_v2_ingest.ts` 作为测试主体。该脚本直接 import `kbSourceAdd`、`kbReadSource` 等工具函数，适合人工 E2E 驱动器，但不能证明 MCP 工具调用链。可以复用其中的思路，例如确定性 source page 模板、产出物校验和幂等性检查。

## MCP 与 OpenClaw 等价性设计

当前调用链：

```text
MCP client
  -> src/mcp_server.ts CallTool handler
  -> dispatchKbTool(name, args, config)
  -> validateKbToolArgs
  -> src/tools/kb_*.ts

OpenClaw session
  -> src/openclaw_plugin.ts registered execute()
  -> dispatchKbTool(toolName, normalizeToolArgs(params), workspace)
  -> validateKbToolArgs
  -> src/tools/kb_*.ts
```

一致性测试分三步：

1. MCP `tools/list` 返回的工具定义与 `KB_TOOL_DEFINITIONS` 等价。
2. 模拟 OpenClaw `api.registerTool` 收集 `src/openclaw_plugin.ts` 注册出的工具定义，并与 `KB_TOOL_DEFINITIONS` 等价。
3. 在两个全新初始化的 KB 上分别用 MCP 和 OpenClaw plugin execute 调用 `kb_rebuild_index`，确认都成功生成 cache。该工具只写隔离临时 KB，适合验证入口执行路径。

这里不要求逐个工具比较 MCP 与 OpenClaw 返回 JSON 完全相同，因为两个入口的错误包装不同；重点是证明 schema、工具集合和执行分派链一致。

## 干净 KB 初始化

测试 helper `createCleanKbFixture(testName)` 执行：

1. 在 `os.tmpdir()` 下创建唯一 workspace 目录。
2. 创建 `kb/` 子目录。
3. 创建目录：
   - `raw/inbox`
   - `raw/originals`
   - `state/manifests`
   - `state/cache`
   - `state/extractions`
   - `wiki/sources`
   - `wiki/concepts`
   - `wiki/entities`
   - `wiki/analyses`
   - `wiki/reports`
   - `schema`
4. 写入 `schema/version.yaml`。
5. 写入 `wiki/index.md`：
   - frontmatter `id: wiki_index`
   - `type: index`
   - anchors: `## Navigation`, `## Sources`, `## Concepts`, `## Entities`, `## Analyses`
6. 写入 `wiki/log.md`：
   - frontmatter `id: wiki_log`
   - `type: index`
   - heading `# Change Log`
7. 通过 MCP 调用 `kb_rebuild_index({ allow_partial: false })` 生成 cache，并断言 `page-index.json` 与 `search-index.json` 存在。

每个 source 工作流子测试都只把 `KB_ROOT` 指向该子测试自己的临时 `kb/`，不写 repo root `kb/`，也不复用上一轮 source 的产物。

## 工作流驱动器

对每个 source 输入执行相同抽象流程：

```text
预查询
  kb_search_wiki({ query: sourceTitleOrLocator, type_filter: "source", mode: "page" })

注册 source
  Markdown: kb_source_add({ file_path })
URL:      kb_url_add({ url, accept_language: "zh-CN,zh;q=0.9,en;q=0.8" })

读取 source
  kb_read_source({ source_id })

写入 wiki
  kb_write_page({ path: "wiki/sources/{source_id}.md", content })
  optional kb_update_section({ path, heading: "## 来源", content, append: false })

维护 index/log
  kb_ensure_entry({ path: "wiki/index.md", anchor: "## Sources", dedup_key, entry })
  kb_append_log_entry({ kind: "ingest", title, summary, changes, references, output_page_id, dedup_key })

完成 ingest
  kb_ingest_finalize({ source_id, status: "ingested", summary_page_id: source_id, touched_pages })

质量检查与回读
  kb_run_lint({ include_semantic: false })
  kb_search_wiki({ query: sourceTitle, type_filter: "source" })
  kb_read_page({ path_or_id: source_id })
```

页面内容由测试驱动器确定性生成，不调用模型。推荐 source page 模板：

```markdown
---
id: {source_id}
type: source
title: {title}
updated_at: 2026-05-07
status: active
tags:
  - real-data-e2e
source_ids:
  - {source_id}
---

# {title}

## 摘要

真实数据 E2E 测试生成的 source summary 页面。canonical source 长度：{char_count} 字符。

## 证据

- source_id: `{source_id}`
- 输入类型: `{markdown|url}`
- 输入位置: `{file path or url}`

## 来源

- [[{source_id}|{title}]]
```

如果测试需要覆盖 `kb_update_section`，在 `kb_write_page` 后用 `kb_update_section` 替换 `## 来源` section。这样既覆盖完整写入，也覆盖 section 更新路径。

## Markdown 测试策略

默认 `npm test` 可以包含 Markdown 真实数据 E2E，因为它不依赖网络，且 MCP server 由 `tsx` 从源码启动，不依赖 `dist/`。为控制运行时间有两种策略：

- 推荐默认策略：全量遍历 `tests/test-source/markdown/*.md`，每个文件使用独立干净 KB，只生成 source page，不生成实体/概念页面。
- 如运行时间过长，再拆成冒烟和全量两个命令：默认冒烟取前 3 个文件，`RUN_REAL_DATA_E2E_FULL=1` 跑全量。

本轮优先按全量 Markdown 设计，因为当前数据量约二十余个文件，仍属于可接受规模。

## URL 测试策略

URL 使用真实网络，应显式启用：

```bash
RUN_REAL_DATA_E2E_URLS=1 npm test -- tests/real-data-e2e.test.ts
```

未启用时：

- `real-data-e2e.test.ts` 仍读取并校验 `url.txt` 非空、URL 格式为 public http/https。
- 未启用时仍为每个 URL 创建 skipped 子测试，输出清晰 skip 信息，不发起网络请求。

启用时：

- 按 `url.txt` 顺序全量执行 `kb_url_add` 工作流。
- 每个 URL 单独作为子测试，并使用独立干净 KB；失败时报告 URL 和工具阶段。
- 不 mock fetch；这条测试的价值是覆盖真实站点 HTML -> Defuddle -> canonical Markdown -> wiki 工作流。

## 产出物校验

Markdown source 必须断言：

- `raw/inbox/{source_id}.md` 存在。
- `state/manifests/{source_id}.json` 存在。
- manifest `canonical_path` 指向存在文件。
- manifest `ingest_status` 在 finalize 后为 `ingested`。
- `wiki/sources/{source_id}.md` 存在，frontmatter id/type/status/source_ids 正确。
- `wiki/index.md` 包含 `[[{source_id}|` 和 dedup key。
- `wiki/log.md` 包含 log dedup key 和 `source_id`。
- `state/cache/page-index.json` 包含 `source_id`。
- `state/cache/search-index.json` 存在且可被 `kb_search_wiki` 使用。

URL source 额外断言：

- `kb_url_add` 返回 `source_id`、`canonical_path` 和 `manifest`；`manifest.url_metadata.final_url` 为非空字符串。`title` 允许为 `null`，页面标题在 `title` 为空时降级到 `file_name` 或 URL。
- manifest `source_origin` 为 `url`。
- manifest `source_kind` 为 `converted_markdown`。
- manifest `original_path` 指向存在的 HTML artifact。
- manifest `extraction_path` 指向存在的 extraction JSON。
- canonical Markdown 包含 provenance 注释 `kb-source-provenance:v1`。

## 错误处理

MCP call helper 应在错误时抛出结构化异常：

```text
ToolCallError: {toolName} failed during {stage}: {message}
```

URL 测试失败必须包含：

- URL
- tool name
- stage
- MCP error text

这样可以区分远端网络问题、URL 安全策略拒绝、Defuddle 输出为空、wiki 写入失败、lint 失败。

## 验证命令

实现完成后至少运行：

```bash
npm run build
npm test -- tests/real-data-e2e.test.ts
npm test
```

真实 URL 测试单独运行：

```bash
RUN_REAL_DATA_E2E_URLS=1 npm test -- tests/real-data-e2e.test.ts
```
