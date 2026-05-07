# 真实数据全流程测试执行计划

> **给执行 agent 的要求：** 实施本计划时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项执行。步骤使用 checkbox（`- [ ]`）语法跟踪状态。

**目标：** 新增可重复运行的真实数据 E2E 测试，通过 MCP 执行 `TOOLS.md` 的实战工作流，并证明 MCP 与 OpenClaw plugin 共享同一套 canonical 工具执行路径。

**架构：** 每个 source 子测试创建独立临时 KB，用 `tsx` 启动源码 MCP stdio server，并将 `KB_ROOT` 指向该 KB。测试通过 MCP 调用 canonical `kb_*` 工具，验证 raw/wiki/state 产物；入口一致性测试对比 MCP 工具定义、OpenClaw plugin 注册结果与 `KB_TOOL_DEFINITIONS`。

**技术栈：** Node test runner、TypeScript、`tsx`、`@modelcontextprotocol/sdk`、现有 KB tools 与 runtime contracts。

---

### 任务 1：新增干净 KB fixture helper

**文件：**
- 新建：`tests/helpers/real-data-kb-fixture.ts`

- [ ] **步骤 1：创建 helper 文件**

实现 `createCleanKbFixture`、`listMarkdownSources` 和 `listUrlSources`。

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface CleanKbFixture {
  workspaceRoot: string;
  kbRoot: string;
  cleanup(): void;
}

export function createCleanKbFixture(prefix = "kb-real-data-e2e-"): CleanKbFixture {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const kbRoot = path.join(workspaceRoot, "kb");

  for (const rel of [
    "raw/inbox",
    "raw/originals",
    "state/manifests",
    "state/cache",
    "state/extractions",
    "wiki/sources",
    "wiki/concepts",
    "wiki/entities",
    "wiki/analyses",
    "wiki/reports",
    "schema",
  ]) {
    fs.mkdirSync(path.join(kbRoot, rel), { recursive: true });
  }

  fs.writeFileSync(
    path.join(kbRoot, "schema", "version.yaml"),
    "version: 1\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(kbRoot, "wiki", "index.md"),
    `---
id: wiki_index
type: index
title: Knowledge Base Index
updated_at: 2026-05-07
status: active
---

# Knowledge Base Index

## Navigation
- [[wiki_log|Change Log]] <!-- dedup:index_nav_wiki_log -->

## Sources

## Concepts

## Entities

## Analyses
`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(kbRoot, "wiki", "log.md"),
    `---
id: wiki_log
type: index
title: Change Log
updated_at: 2026-05-07
status: active
---

# Change Log
`,
    "utf8"
  );

  return {
    workspaceRoot,
    kbRoot,
    cleanup: () => fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  };
}

export function listMarkdownSources(repoRoot: string): string[] {
  const root = path.join(repoRoot, "tests", "test-source", "markdown");
  return fs.readdirSync(root)
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(root, name));
}

export function listUrlSources(repoRoot: string): string[] {
  const urlFile = path.join(repoRoot, "tests", "test-source", "url.txt");
  return fs.readFileSync(urlFile, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
```

- [ ] **步骤 2：运行 typecheck**

运行：

```bash
npm run typecheck
```

预期：typecheck 通过；如果此时仅因为 helper 尚未被引用而出现告警，后续任务接入后再验证。

---

### 任务 2：新增 MCP 测试客户端 helper

**文件：**
- 新建：`tests/helpers/mcp-client.ts`

- [ ] **步骤 1：实现 MCP harness**

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpToolClient {
  listTools(): Promise<unknown>;
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  callToolAtStage<T = unknown>(
    stage: string,
    name: string,
    args?: Record<string, unknown>,
    context?: string
  ): Promise<T>;
  close(): Promise<void>;
}

type McpTextToolResponse = {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
};

function isMcpTextToolResponse(value: unknown): value is McpTextToolResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function parseMcpToolJson<T>(name: string, response: unknown): T {
  if (!isMcpTextToolResponse(response)) {
    throw new Error(`MCP 工具 ${name} 返回了不支持的响应形态。`);
  }
  if (response.isError) {
    const text = response.content
      .map((item) => item.type === "text" ? item.text ?? "" : "")
      .join("\n");
    throw new Error(text);
  }
  const firstText = response.content.find((item) => item.type === "text");
  if (!firstText?.text) {
    throw new Error("未返回文本内容");
  }
  return JSON.parse(firstText.text) as T;
}

export async function startKbMcpClient(options: {
  serverCommand: string;
  serverArgs: string[];
  kbRoot: string;
  cwd: string;
}): Promise<McpToolClient> {
  const env = {
    ...getDefaultEnvironment(),
    KB_ROOT: options.kbRoot,
  };
  const transport = new StdioClientTransport({
    command: options.serverCommand,
    args: options.serverArgs,
    cwd: options.cwd,
    env,
  });

  const client = new Client({ name: "real-data-e2e-test", version: "0.1.0" });
  await client.connect(transport);

  return {
    listTools: () => client.listTools(),
    callTool: async <T>(name: string, args: Record<string, unknown> = {}) => {
      try {
        return parseMcpToolJson<T>(name, await client.callTool({ name, arguments: args }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`MCP 工具 ${name} 调用失败：${message}`);
      }
    },
    callToolAtStage: async <T>(
      stage: string,
      name: string,
      args: Record<string, unknown> = {},
      context = ""
    ) => {
      try {
        return parseMcpToolJson<T>(name, await client.callTool({ name, arguments: args }));
      } catch (error) {
        const suffix = context ? `；上下文：${context}` : "";
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`阶段 ${stage} 调用 MCP 工具 ${name} 失败${suffix}：${message}`);
      }
    },
    close: () => client.close(),
  };
}
```

- [ ] **步骤 2：运行定向 typecheck**

运行：

```bash
npm run typecheck
```

预期：通过。注意 `npm run typecheck` 不覆盖 `tests/`，最终以 `tsx --test tests/real-data-e2e.test.ts` 作为测试文件类型与运行时验证；如果 SDK response 类型比示例更严格，只在该 helper 内补充本地 type guard。

---

### 任务 3：新增确定性工作流 helper

**文件：**
- 新建：`tests/real-data-e2e.test.ts`

- [ ] **步骤 1：加入 imports 与基础类型**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import pluginEntry = require("../src/openclaw_plugin");
import { KB_TOOL_DEFINITIONS } from "../src/runtime/kb_tool_contract";
import { createCleanKbFixture, listMarkdownSources, listUrlSources } from "./helpers/real-data-kb-fixture";
import { startKbMcpClient } from "./helpers/mcp-client";

const REPO_ROOT = path.resolve(__dirname, "..");
const TEST_DATE = "2026-05-07";

interface RegisteredSource {
  source_id: string;
  file_name?: string;
  title?: string | null;
  canonical_path?: string;
  manifest?: Record<string, unknown>;
}

interface RebuildPageIndexOutput {
  version: number;
  total_pages: number;
  written_to: string;
  skipped_pages: unknown[];
}

interface KbLintReport {
  ok: boolean;
  deterministic: {
    errors: number;
    issues: unknown[];
  };
}

interface ReadSourceChunk {
  content: string;
  file_name?: string;
  truncated?: boolean;
  next_offset_bytes?: number;
}
```

- [ ] **步骤 2：加入 source page 构造函数**

```ts
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function buildSourcePage(input: {
  sourceId: string;
  title: string;
  inputType: "markdown" | "url";
  inputLocator: string;
  charCount: number;
}): string {
  return `---
id: ${input.sourceId}
type: source
title: ${yamlString(input.title)}
updated_at: ${TEST_DATE}
status: active
tags:
  - real-data-e2e
source_ids:
  - ${input.sourceId}
---

# ${input.title}

## 摘要

真实数据 E2E 测试生成的 source summary 页面。canonical source 长度：${input.charCount} 字符。

## 证据

- source_id: \`${input.sourceId}\`
- 输入类型: \`${input.inputType}\`
- 输入位置: \`${input.inputLocator}\`

## 来源

- [[${input.sourceId}|${input.title}]]
`;
}
```

- [ ] **步骤 3：加入产物断言 helper**

```ts
function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function assertFileExists(filePath: string): void {
  assert.equal(fs.existsSync(filePath), true, `预期文件存在：${filePath}`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  assert.equal(typeof value, "string", `${label} 必须是字符串`);
  assert.ok(value.length > 0, `${label} 不能为空`);
}

function sourceTitleFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function safeTitle(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  return raw.replace(/[\r\n]+/gu, " ").replace(/\|/gu, "-").trim().slice(0, 120) || "Untitled Source";
}

function assertCacheContainsMetaPages(kbRoot: string): void {
  const pageIndexPath = path.join(kbRoot, "state", "cache", "page-index.json");
  const searchIndexPath = path.join(kbRoot, "state", "cache", "search-index.json");
  assertFileExists(pageIndexPath);
  assertFileExists(searchIndexPath);
  const pageIndex = readJson<{ pages: Array<{ page_id: string; path: string; type: string }> }>(pageIndexPath);
  assert.equal(pageIndex.pages.some((page) => page.page_id === "wiki_index"), true);
  assert.equal(pageIndex.pages.some((page) => page.page_id === "wiki_log"), true);
}

async function readFullSource(
  mcp: Awaited<ReturnType<typeof startKbMcpClient>>,
  sourceId: string,
  context: string
): Promise<ReadSourceChunk> {
  const chunks: string[] = [];
  let fileName: string | undefined;
  let offset = 0;
  for (;;) {
    const chunk = await mcp.callToolAtStage<ReadSourceChunk>(
      "读取 source",
      "kb_read_source",
      { source_id: sourceId, offset_bytes: offset, max_bytes: 1024 * 1024 },
      context
    );
    chunks.push(chunk.content);
    fileName = fileName ?? chunk.file_name;
    if (!chunk.truncated || typeof chunk.next_offset_bytes !== "number") {
      return { ...chunk, content: chunks.join(""), file_name: fileName };
    }
    offset = chunk.next_offset_bytes;
  }
}

function assertUrlArtifact(condition: unknown, message: string, url: string): asserts condition {
  assert.ok(condition, `URL 产物验收失败；URL: ${url}；阶段: URL 产物验收；${message}`);
}
```

---

### 任务 4：实现 MCP 工作流驱动器

**文件：**
- 修改：`tests/real-data-e2e.test.ts`

- [ ] **步骤 1：加入 `runSourceWorkflow` helper**

```ts
async function runSourceWorkflow(options: {
  mcp: Awaited<ReturnType<typeof startKbMcpClient>>;
  kbRoot: string;
  inputType: "markdown" | "url";
  inputLocator: string;
}): Promise<string> {
  const context = `${options.inputType}:${options.inputLocator}`;
  const preQueryText = options.inputType === "markdown"
    ? sourceTitleFromPath(options.inputLocator)
    : options.inputLocator;
  const preQuery = await options.mcp.callToolAtStage<Array<{ page_id: string }>>(
    "预查询",
    "kb_search_wiki",
    { query: preQueryText, type_filter: "source", mode: "page" },
    context
  );
  assert.equal(Array.isArray(preQuery), true);

  const registerTool = options.inputType === "markdown" ? "kb_source_add" : "kb_url_add";
  const registerArgs = options.inputType === "markdown"
    ? { file_path: options.inputLocator }
    : {
        url: options.inputLocator,
        accept_language: "zh-CN,zh;q=0.9,en;q=0.8",
      };
  const registered = await options.mcp.callToolAtStage<RegisteredSource>(
    "注册 source",
    registerTool,
    registerArgs,
    context
  );
  assert.match(registered.source_id, /^src_sha256_[0-9a-f]+$/u);
  assertNonEmptyString(registered.canonical_path, "registered.canonical_path");

  if (options.inputType === "markdown") {
    assertNonEmptyString(registered.file_name, "kb_source_add.file_name");
  } else {
    assert.equal(typeof registered.manifest, "object", "kb_url_add 必须返回 manifest");
    const returnedManifest = registered.manifest as Record<string, unknown>;
    const returnedUrlMetadata = returnedManifest.url_metadata as Record<string, unknown> | undefined;
    assertNonEmptyString(
      returnedUrlMetadata?.final_url,
      "kb_url_add.manifest.url_metadata.final_url"
    );
  }

  const readSource = await readFullSource(options.mcp, registered.source_id, context);
  assert.ok(readSource.content.length > 0, "canonical source content 不能为空");

  if (options.inputType === "markdown") {
    const original = fs.readFileSync(options.inputLocator, "utf8");
    const firstMeaningfulLine = original
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && line !== "---");
    if (firstMeaningfulLine) {
      assert.match(readSource.content, new RegExp(firstMeaningfulLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    }
  }

  const title = safeTitle(
    registered.title,
    registered.file_name ?? sourceTitleFromPath(options.inputLocator)
  );
  const pagePath = `wiki/sources/${registered.source_id}.md`;
  const page = buildSourcePage({
    sourceId: registered.source_id,
    title,
    inputType: options.inputType,
    inputLocator: options.inputLocator,
    charCount: readSource.content.length,
  });

  await options.mcp.callToolAtStage("写入 source page", "kb_write_page", { path: pagePath, content: page }, context);

  await options.mcp.callToolAtStage(
    "更新来源章节",
    "kb_update_section",
    {
      path: pagePath,
      heading: "## 来源",
      content: `- [[${registered.source_id}|${title}]]`,
      append: false,
      create_if_missing: false,
    },
    context
  );

  const indexDedupKey = `index_source_${registered.source_id}`;
  await options.mcp.callToolAtStage(
    "维护 index",
    "kb_ensure_entry",
    {
      path: "wiki/index.md",
      anchor: "## Sources",
      entry: `- [[${registered.source_id}|${title}]] — real-data-e2e ${options.inputType}`,
      dedup_key: indexDedupKey,
    },
    context
  );

  const logDedupKey = `log_ingest_${registered.source_id}_real_data_e2e`;
  await options.mcp.callToolAtStage(
    "维护 log",
    "kb_append_log_entry",
    {
      kind: "ingest",
      title,
      summary: `real-data-e2e ${options.inputType} ingest completed`,
      date: TEST_DATE,
      changes: [pagePath, "wiki/index.md", "wiki/log.md"],
      references: [registered.source_id],
      output_page_id: registered.source_id,
      dedup_key: logDedupKey,
    },
    context
  );

  const touchedPages = [pagePath, "wiki/index.md", "wiki/log.md"];
  await options.mcp.callToolAtStage(
    "完成 ingest",
    "kb_ingest_finalize",
    {
      source_id: registered.source_id,
      status: "ingested",
      summary_page_id: registered.source_id,
      touched_pages: touchedPages,
    },
    context
  );

  const lint = await options.mcp.callToolAtStage<KbLintReport>(
    "质量检查",
    "kb_run_lint",
    { include_semantic: false },
    context
  );
  assert.equal(lint.ok, true, `lint deterministic issues: ${JSON.stringify(lint.deterministic.issues)}`);
  assert.equal(lint.deterministic.errors, 0);

  const search = await options.mcp.callToolAtStage<Array<{ page_id: string }>>(
    "搜索回读",
    "kb_search_wiki",
    { query: title, type_filter: "source", mode: "page" },
    context
  );
  assert.equal(search.some((hit) => hit.page_id === registered.source_id), true);

  const pageRead = await options.mcp.callToolAtStage<{ frontmatter: { id: string; type: string; status: string; source_ids?: string[] } }>(
    "页面回读",
    "kb_read_page",
    { path_or_id: registered.source_id },
    context
  );
  assert.equal(pageRead.frontmatter.id, registered.source_id);
  assert.equal(pageRead.frontmatter.type, "source");
  assert.equal(pageRead.frontmatter.status, "active");
  assert.deepEqual(pageRead.frontmatter.source_ids, [registered.source_id]);

  const canonicalPath = path.join(options.kbRoot, registered.canonical_path);
  const rawInboxPath = path.join(options.kbRoot, "raw", "inbox", `${registered.source_id}.md`);
  assert.equal(path.resolve(canonicalPath), path.resolve(rawInboxPath));
  assertFileExists(rawInboxPath);
  assert.equal(fs.readFileSync(rawInboxPath, "utf8"), readSource.content);
  const manifestPath = path.join(options.kbRoot, "state", "manifests", `${registered.source_id}.json`);
  assertFileExists(manifestPath);
  assertFileExists(path.join(options.kbRoot, pagePath));

  const manifest = readJson<Record<string, unknown>>(manifestPath);
  assert.equal(manifest.source_id, registered.source_id);
  assert.equal(manifest.source_origin, options.inputType === "url" ? "url" : "file");
  assert.equal(manifest.canonical_path, registered.canonical_path);
  assert.equal(manifest.ingest_status, "ingested");
  assert.equal(manifest.ingest_summary_page_id, registered.source_id);
  assert.deepEqual(manifest.ingest_touched_pages, touchedPages);

  const indexContent = fs.readFileSync(path.join(options.kbRoot, "wiki", "index.md"), "utf8");
  assert.match(indexContent, new RegExp(`\\[\\[${registered.source_id}\\|`, "u"));
  assert.match(indexContent, new RegExp(`dedup:${indexDedupKey}`, "u"));
  const logContent = fs.readFileSync(path.join(options.kbRoot, "wiki", "log.md"), "utf8");
  assert.match(logContent, new RegExp(registered.source_id, "u"));
  assert.match(logContent, new RegExp(`dedup:${logDedupKey}`, "u"));

  const pageIndexPath = path.join(options.kbRoot, "state", "cache", "page-index.json");
  const searchIndexPath = path.join(options.kbRoot, "state", "cache", "search-index.json");
  assertFileExists(pageIndexPath);
  assertFileExists(searchIndexPath);
  const pageIndex = readJson<{ pages: Array<{ page_id: string; path: string; type: string }> }>(pageIndexPath);
  assert.equal(pageIndex.pages.some((page) => page.page_id === registered.source_id && page.path === pagePath), true);

  return registered.source_id;
}
```

- [ ] **步骤 2：运行定向测试暴露编译问题**

运行：

```bash
npm test -- tests/real-data-e2e.test.ts
```

预期：如果此时测试尚未完整接入或类型有误，应失败并暴露具体编译问题；修正类型不匹配后继续。

---

### 任务 5：新增 MCP/OpenClaw 入口一致性测试

**文件：**
- 修改：`tests/real-data-e2e.test.ts`

- [ ] **步骤 1：加入测试**

```ts
test("MCP 与 OpenClaw plugin 暴露同一套 canonical KB tool contract", async () => {
  const mcpFixture = createCleanKbFixture();
  const openclawFixture = createCleanKbFixture();
  let mcp: Awaited<ReturnType<typeof startKbMcpClient>> | undefined;

  const previousKbRoot = process.env.KB_ROOT;
  try {
    mcp = await startKbMcpClient({
      serverCommand: path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      serverArgs: ["--tsconfig", "tsconfig.scripts.json", "src/mcp_server.ts"],
      kbRoot: mcpFixture.kbRoot,
      cwd: REPO_ROOT,
    });

    const listed = await mcp.listTools() as { tools: Array<{ name: string; inputSchema: unknown }> };
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      KB_TOOL_DEFINITIONS.map((tool) => tool.name)
    );

    const registered: Array<{ name: string; parameters: unknown; execute: (id: string, params?: unknown) => Promise<unknown> }> = [];
    pluginEntry.register({
      registerTool(tool: { name: string; parameters: unknown; execute: (id: string, params?: unknown) => Promise<unknown> }) {
        registered.push(tool);
      },
    });

    assert.deepEqual(
      registered.map((tool) => tool.name),
      KB_TOOL_DEFINITIONS.map((tool) => tool.name)
    );

    for (const definition of KB_TOOL_DEFINITIONS) {
      const mcpTool = listed.tools.find((tool) => tool.name === definition.name);
      const openclawTool = registered.find((tool) => tool.name === definition.name);
      assert.deepEqual(mcpTool?.inputSchema, definition.inputSchema);
      assert.deepEqual(openclawTool?.parameters, definition.inputSchema);
    }

    const mcpRebuild = await mcp.callToolAtStage<RebuildPageIndexOutput>(
      "MCP 初始化索引",
      "kb_rebuild_index",
      { allow_partial: false },
      "mcpFixture"
    );
    assert.equal(mcpRebuild.version, 2);
    assert.equal(mcpRebuild.total_pages, 2);
    assert.equal(mcpRebuild.written_to, "kb/state/cache/page-index.json");
    assert.deepEqual(mcpRebuild.skipped_pages, []);
    assertCacheContainsMetaPages(mcpFixture.kbRoot);

    process.env.KB_ROOT = openclawFixture.kbRoot;
    const openclawRebuild = registered.find((tool) => tool.name === "kb_rebuild_index");
    assert.ok(openclawRebuild, "OpenClaw plugin 必须注册 kb_rebuild_index");
    const openclawResponse = await openclawRebuild.execute("real-data-e2e", { allow_partial: false }) as {
      content: Array<{ type: "text"; text: string }>;
    };
    const openclawText = openclawResponse.content.find((item) => item.type === "text")?.text;
    assertNonEmptyString(openclawText, "OpenClaw kb_rebuild_index response text");
    const openclawRebuildResult = JSON.parse(openclawText) as RebuildPageIndexOutput;
    assert.equal(openclawRebuildResult.version, mcpRebuild.version);
    assert.equal(openclawRebuildResult.total_pages, mcpRebuild.total_pages);
    assert.equal(openclawRebuildResult.written_to, mcpRebuild.written_to);
    assert.deepEqual(openclawRebuildResult.skipped_pages, mcpRebuild.skipped_pages);
    assertCacheContainsMetaPages(openclawFixture.kbRoot);
  } finally {
    if (previousKbRoot === undefined) {
      delete process.env.KB_ROOT;
    } else {
      process.env.KB_ROOT = previousKbRoot;
    }
    await mcp?.close();
    mcpFixture.cleanup();
    openclawFixture.cleanup();
  }
});
```

- [ ] **步骤 2：运行 MCP 入口一致性测试**

运行：

```bash
npm test -- tests/real-data-e2e.test.ts
```

预期：入口一致性测试通过。

---

### 任务 6：新增 Markdown 真实数据 E2E 测试

**文件：**
- 修改：`tests/real-data-e2e.test.ts`

- [ ] **步骤 1：加入 Markdown 测试**

```ts
test("真实 Markdown source 可通过 MCP 完成 TOOLS.md 工作流", async (t) => {
  const markdownSources = listMarkdownSources(REPO_ROOT);
  assert.ok(markdownSources.length > 0, "tests/test-source/markdown 必须包含 Markdown fixtures");

  for (const filePath of markdownSources) {
    await t.test(`Markdown 工作流：${path.basename(filePath)}`, async () => {
      const fixture = createCleanKbFixture();
      let mcp: Awaited<ReturnType<typeof startKbMcpClient>> | undefined;

      try {
        mcp = await startKbMcpClient({
          serverCommand: path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
          serverArgs: ["--tsconfig", "tsconfig.scripts.json", "src/mcp_server.ts"],
          kbRoot: fixture.kbRoot,
          cwd: REPO_ROOT,
        });
        const rebuild = await mcp.callToolAtStage<RebuildPageIndexOutput>(
          "初始化索引",
          "kb_rebuild_index",
          { allow_partial: false },
          filePath
        );
        assert.equal(rebuild.total_pages, 2);
        assert.deepEqual(rebuild.skipped_pages, []);
        assertCacheContainsMetaPages(fixture.kbRoot);
        await runSourceWorkflow({
          mcp,
          kbRoot: fixture.kbRoot,
          inputType: "markdown",
          inputLocator: filePath,
        });
      } finally {
        await mcp?.close();
        fixture.cleanup();
      }
    });
  }
});
```

- [ ] **步骤 2：运行定向测试**

运行：

```bash
npm run build
npm test -- tests/real-data-e2e.test.ts
```

预期：Markdown E2E 在无网络情况下通过。

---

### 任务 7：新增 URL 真实数据 E2E 测试

**文件：**
- 修改：`tests/real-data-e2e.test.ts`

- [ ] **步骤 1：加入带环境变量开关的 URL 测试**

```ts
test("真实 URL source 在显式启用时可通过 MCP 完成 TOOLS.md 工作流", async (t) => {
  const urls = listUrlSources(REPO_ROOT);
  assert.ok(urls.length > 0, "tests/test-source/url.txt 必须包含 URL fixtures");
  for (const url of urls) {
    assert.match(url, /^https?:\/\//u);
  }

  if (process.env.RUN_REAL_DATA_E2E_URLS !== "1") {
    for (const url of urls) {
      await t.test(`URL 工作流：${url}`, { skip: "设置 RUN_REAL_DATA_E2E_URLS=1 后才会发起真实 URL ingest。" }, () => {});
    }
    return;
  }

  for (const url of urls) {
    await t.test(`URL 工作流：${url}`, async () => {
      const fixture = createCleanKbFixture();
      let mcp: Awaited<ReturnType<typeof startKbMcpClient>> | undefined;

      try {
        mcp = await startKbMcpClient({
          serverCommand: path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
          serverArgs: ["--tsconfig", "tsconfig.scripts.json", "src/mcp_server.ts"],
          kbRoot: fixture.kbRoot,
          cwd: REPO_ROOT,
        });
        const rebuild = await mcp.callToolAtStage<RebuildPageIndexOutput>(
          "初始化索引",
          "kb_rebuild_index",
          { allow_partial: false },
          url
        );
        assert.equal(rebuild.total_pages, 2);
        assert.deepEqual(rebuild.skipped_pages, []);
        assertCacheContainsMetaPages(fixture.kbRoot);
        const sourceId = await runSourceWorkflow({
          mcp,
          kbRoot: fixture.kbRoot,
          inputType: "url",
          inputLocator: url,
        });

        const manifest = readJson<Record<string, unknown>>(
          path.join(fixture.kbRoot, "state", "manifests", `${sourceId}.json`)
        );
        assertUrlArtifact(manifest.source_origin === "url", "manifest.source_origin 必须为 url", url);
        assertUrlArtifact(manifest.source_kind === "converted_markdown", "manifest.source_kind 必须为 converted_markdown", url);
        assertUrlArtifact(typeof manifest.original_path === "string", "manifest.original_path 必须是字符串", url);
        assertUrlArtifact(typeof manifest.extraction_path === "string", "manifest.extraction_path 必须是字符串", url);
        const urlMetadata = manifest.url_metadata as Record<string, unknown> | undefined;
        assertUrlArtifact(typeof urlMetadata?.final_url === "string" && urlMetadata.final_url.length > 0, "manifest.url_metadata.final_url 不能为空", url);
        assertFileExists(path.join(fixture.kbRoot, manifest.original_path as string));
        assertFileExists(path.join(fixture.kbRoot, manifest.extraction_path as string));

        const canonical = fs.readFileSync(path.join(fixture.kbRoot, manifest.canonical_path as string), "utf8");
        assertUrlArtifact(/kb-source-provenance:v1/u.test(canonical), "canonical Markdown 必须包含 provenance 注释", url);
      } finally {
        await mcp?.close();
        fixture.cleanup();
      }
    });
  }
});
```

- [ ] **步骤 2：运行带 URL 开关的定向测试**

运行：

```bash
RUN_REAL_DATA_E2E_URLS=1 npm test -- tests/real-data-e2e.test.ts
```

预期：远端站点可访问时，URL 工作流通过。如果某个 URL 失败，先记录具体 URL 和工具错误，再决定是否将该 URL 设为可选或移入隔离清单。

---

### 任务 8：新增 package script

**文件：**
- 修改：`package.json`

- [ ] **步骤 1：加入脚本**

加入：

```json
"test:real-data-e2e": "tsx --test tests/real-data-e2e.test.ts",
"test:real-data-e2e:urls": "RUN_REAL_DATA_E2E_URLS=1 tsx --test tests/real-data-e2e.test.ts"
```

保留现有 scripts，不做无关调整。

- [ ] **步骤 2：验证 JSON 格式和脚本可运行**

运行：

```bash
npm run test:real-data-e2e
```

预期：Markdown 工作流通过；除非显式启用环境变量，否则 URL 测试跳过。该脚本直接用 `tsx` 启动源码 MCP server，不依赖 `dist/`。

---

### 任务 9：最终验证

**文件：**
- 检查：`tests/helpers/real-data-kb-fixture.ts`
- 检查：`tests/helpers/mcp-client.ts`
- 检查：`tests/real-data-e2e.test.ts`
- 检查：`package.json`

- [ ] **步骤 1：运行完整本地验证**

运行：

```bash
npm run build
npm run typecheck
npm test
npm run test:real-data-e2e
```

预期：

- build 通过。
- typecheck 通过。
- 全量测试通过。
- real-data E2E 默认跑 Markdown，URL live ingest 默认跳过。

- [ ] **步骤 2：需要验证真实 URL 时运行 live URL 测试**

运行：

```bash
npm run test:real-data-e2e:urls
```

预期：

- `tests/test-source/url.txt` 中所有 URL 完成 `kb_url_add` 工作流；若失败，失败信息能定位到具体 URL、阶段和工具。

- [ ] **步骤 3：检查 git 状态**

运行：

```bash
git status --short
```

预期：tracked 变更仅限新增测试/helper、package script 和三份规划文档。`tests/test-source/` 仍保持用户提供的 fixture 文件状态，不做内容改写。
