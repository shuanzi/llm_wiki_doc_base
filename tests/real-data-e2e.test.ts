import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

import { KB_TOOL_DEFINITIONS } from "../src/runtime/kb_tool_contract";
import {
  createCleanKbFixture,
  listMarkdownSources,
  listUrlSources,
  type CleanKbFixture,
} from "./helpers/real-data-kb-fixture";
import {
  startKbMcpClient,
  type McpToolClient,
} from "./helpers/mcp-client";

const pluginEntry = require("../src/openclaw_plugin");

const REPO_ROOT = path.resolve(__dirname, "..");
const TEST_DATE = "2026-05-07";
const TITLE_MAX_LENGTH = 120;
const TSX_BIN_NAME = process.platform === "win32" ? "tsx.cmd" : "tsx";

type SourceInputType = "markdown" | "url";

interface RegisteredSource {
  source_id: string;
  content_hash: string;
  canonical_path: string;
  file_name?: string;
  title?: string | null;
  manifest: {
    source_id: string;
    source_origin: "file" | "url";
    source_kind: "markdown" | "plaintext" | "converted_markdown";
    canonical_path: string;
    file_name: string;
    ingest_status: "registered" | "ingested" | "failed";
    ingest_summary_page_id?: string;
    ingest_touched_pages?: string[];
    original_path?: string;
    extraction_path?: string;
    url_metadata?: {
      final_url?: string;
    };
  };
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
  };
}

interface ReadSourceChunk {
  source_id: string;
  content: string;
  offset_bytes: number;
  returned_bytes: number;
  total_bytes: number;
  truncated: boolean;
  next_offset_bytes?: number;
}

interface SearchResult {
  page_id: string;
  path: string;
  title: string;
  type: string;
}

interface ReadPageOutput {
  path: string;
  frontmatter: {
    id?: string;
    type?: string;
    title?: string;
    status?: string;
    source_ids?: string[];
  };
  body: string;
}

interface OpenClawRegisteredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(toolCallId: string, params?: unknown): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

interface RunSourceWorkflowOptions {
  mcp: McpToolClient;
  kbRoot: string;
  inputType: SourceInputType;
  inputLocator: string;
  query?: string;
  title?: string;
}

function yamlString(value: unknown): string {
  return JSON.stringify(value);
}

function sourceMcpServerCommand(): string {
  return path.join(REPO_ROOT, "node_modules", ".bin", TSX_BIN_NAME);
}

function buildSourcePage(input: {
  sourceId: string;
  title: string;
  inputType: SourceInputType;
  inputLocator: string;
  charCount: number;
}): string {
  const title = displayTitle(input.title);
  const label = wikilinkLabel(title);
  return `---
id: ${input.sourceId}
type: source
title: ${yamlString(title)}
updated_at: ${TEST_DATE}
status: active
tags: ${yamlString(["real-data-e2e", input.inputType])}
source_ids: ${yamlString([input.sourceId])}
---

# ${title}

## 摘要

- 输入类型：${input.inputType}
- 原始定位：${input.inputLocator}
- canonical Markdown 字符数：${input.charCount}

## 证据

- 已通过 MCP canonical 工具链读取原始 source 并生成确定性 source page。

## 来源

- [[${input.sourceId}|${label}]]
- source_id: ${input.sourceId}
`;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function assertFileExists(filePath: string): void {
  assert.equal(fs.existsSync(filePath), true, `Expected file to exist: ${filePath}`);
}

function cleanupFixture(
  fixture: CleanKbFixture,
  label: string,
  primaryError?: unknown
): void {
  try {
    fixture.cleanup();
  } catch (cleanupError) {
    if (primaryError === undefined) {
      throw cleanupError;
    }
    process.emitWarning(
      `清理测试 fixture 失败，保留原始测试错误：${label}；原因：${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`
    );
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim().length > 0, `${label} must be non-empty`);
}

function sourceTitleFromPath(filePath: string): string {
  return displayTitle(path.basename(filePath, path.extname(filePath)));
}

function truncateText(value: string, maxLength = TITLE_MAX_LENGTH): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function displayTitle(value: unknown, fallback = "Untitled Source"): string {
  const title = truncateText(
    String(value ?? "")
      .replace(/[\r\n|[\]]+/gu, "-")
      .replace(/\s+/gu, " ")
      .replace(/-+/gu, "-")
      .trim()
  );
  return title.length > 0 ? title : fallback;
}

function wikilinkLabel(value: unknown): string {
  return displayTitle(value).replace(/[|[\]\r\n]+/gu, "-");
}

function logSafeText(value: unknown, fallback = "Untitled Source"): string {
  const cleaned = truncateText(
    String(value ?? "")
      .replace(/\r?\n/gu, " ")
      .replace(/<!--\s*dedup:/giu, "dedup:")
      .replace(/-->/gu, "")
      .replace(/---/gu, "-")
      .replace(/\s+/gu, " ")
      .trim()
  );

  return cleaned.length > 0 ? cleaned : fallback;
}

function assertCacheContainsMetaPages(kbRoot: string): void {
  const pageIndex = readJson<{
    pages: Array<{ page_id: string; path: string }>;
  }>(path.join(kbRoot, "state", "cache", "page-index.json"));
  const searchIndex = readJson<{
    chunks: Array<{ page_id: string; path: string }>;
  }>(path.join(kbRoot, "state", "cache", "search-index.json"));

  for (const [pageId, pagePath] of [
    ["wiki_index", "wiki/index.md"],
    ["wiki_log", "wiki/log.md"],
  ] as const) {
    assert.ok(
      pageIndex.pages.some((page) => page.page_id === pageId && page.path === pagePath),
      `page-index 缺少 ${pageId}`
    );
    assert.ok(
      searchIndex.chunks.some((chunk) => chunk.page_id === pageId && chunk.path === pagePath),
      `search-index 缺少 ${pageId}`
    );
  }
}

function assertCacheContainsPage(kbRoot: string, pageId: string, pagePath: string): void {
  const pageIndex = readJson<{
    pages: Array<{ page_id: string; path: string }>;
  }>(path.join(kbRoot, "state", "cache", "page-index.json"));

  assert.ok(
    pageIndex.pages.some((page) => page.page_id === pageId && page.path === pagePath),
    `page-index 缺少 ${pageId} (${pagePath})`
  );
}

async function readFullSource(
  mcp: McpToolClient,
  sourceId: string,
  context: string
): Promise<string> {
  const chunks: string[] = [];
  let offset = 0;

  while (true) {
    const chunk = await mcp.callToolAtStage<ReadSourceChunk>(
      "read full source",
      "kb_read_source",
      {
        source_id: sourceId,
        offset_bytes: offset,
        max_bytes: 1024 * 1024,
      },
      context
    );

    assert.equal(chunk.source_id, sourceId);
    chunks.push(chunk.content);

    if (chunk.next_offset_bytes === undefined) {
      break;
    }
    assert.ok(
      chunk.next_offset_bytes > offset,
      `kb_read_source pagination did not advance for ${sourceId}`
    );
    offset = chunk.next_offset_bytes;
  }

  return chunks.join("");
}

function assertUrlArtifact(condition: unknown, message: string, url: string): asserts condition {
  assert.ok(condition, `${message}；URL=${url}；阶段=URL artifact validation`);
}

function parseIpv4Literal(hostname: string): [number, number, number, number] | undefined {
  const parts = hostname.split(".");
  if (
    parts.length !== 4 ||
    !parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
  ) {
    return undefined;
  }

  return parts.map(Number) as [number, number, number, number];
}

function isPublicIpv4Literal(hostname: string): boolean {
  const parts = parseIpv4Literal(hostname);
  if (parts === undefined) {
    return false;
  }

  const [first, second, third, fourth] = parts;
  const address =
    ((first << 24) >>> 0) + (second << 16) + (third << 8) + fourth;
  const inRange = (base: number, prefixLength: number): boolean => {
    const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
    return (address & mask) === (base & mask);
  };

  return !(
    inRange(0x00000000, 8) ||
    inRange(0x0a000000, 8) ||
    inRange(0x64400000, 10) ||
    inRange(0x7f000000, 8) ||
    inRange(0xa9fe0000, 16) ||
    inRange(0xac100000, 12) ||
    inRange(0xc0000000, 24) ||
    inRange(0xc0000200, 24) ||
    inRange(0xc01fC400, 24) ||
    inRange(0xc034C100, 24) ||
    inRange(0xc0586300, 24) ||
    inRange(0xc0af3000, 24) ||
    inRange(0xc0A80000, 16) ||
    inRange(0xc6120000, 15) ||
    inRange(0xc6336400, 24) ||
    inRange(0xcb007100, 24) ||
    inRange(0xe0000000, 4) ||
    inRange(0xf0000000, 4) ||
    address === 0xffffffff
  );
}

function expandIpv6Literal(hostname: string): string[] | undefined {
  if (net.isIP(hostname) !== 6) {
    return undefined;
  }

  let normalized = hostname.toLowerCase();
  if (normalized.includes(".")) {
    const lastColonIndex = normalized.lastIndexOf(":");
    const ipv4Parts = parseIpv4Literal(normalized.slice(lastColonIndex + 1));
    if (lastColonIndex === -1 || ipv4Parts === undefined) {
      return undefined;
    }

    const [first, second, third, fourth] = ipv4Parts;
    normalized = `${normalized.slice(0, lastColonIndex)}:${(
      first * 256 +
      second
    ).toString(16)}:${(third * 256 + fourth).toString(16)}`;
  }

  const doubleColonParts = normalized.split("::");
  if (doubleColonParts.length > 2) {
    return undefined;
  }

  const left = doubleColonParts[0]?.split(":").filter(Boolean) ?? [];
  const right = doubleColonParts[1]?.split(":").filter(Boolean) ?? [];
  const missingCount =
    doubleColonParts.length === 2 ? 8 - left.length - right.length : 0;
  if (missingCount < 0) {
    return undefined;
  }

  const groups =
    doubleColonParts.length === 2
      ? [...left, ...Array<string>(missingCount).fill("0"), ...right]
      : left;
  if (
    groups.length !== 8 ||
    !groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return undefined;
  }

  return groups.map((group) => group.padStart(4, "0"));
}

function isPublicIpv6Literal(hostname: string): boolean {
  const groups = expandIpv6Literal(hostname);
  if (groups === undefined) {
    return false;
  }

  const firstGroup = Number.parseInt(groups[0] ?? "0", 16);
  const secondGroup = Number.parseInt(groups[1] ?? "0", 16);
  const thirdGroup = Number.parseInt(groups[2] ?? "0", 16);
  const isAllZero = groups.every((group) => group === "0000");
  const isLoopback =
    groups.slice(0, 7).every((group) => group === "0000") && groups[7] === "0001";
  const isIpv4Mapped =
    groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff";
  const isIpv4Compatible = groups.slice(0, 6).every((group) => group === "0000");

  if (isIpv4Mapped || isIpv4Compatible) {
    const sixth = Number.parseInt(groups[6] ?? "0", 16);
    const seventh = Number.parseInt(groups[7] ?? "0", 16);
    return isPublicIpv4Literal(
      `${sixth >> 8}.${sixth & 0xff}.${seventh >> 8}.${seventh & 0xff}`
    );
  }

  return !(
    isAllZero ||
    isLoopback ||
    (firstGroup === 0x0064 &&
      secondGroup === 0xff9b &&
      groups.slice(2, 6).every((group) => group === "0000")) ||
    (firstGroup === 0x0064 && secondGroup === 0xff9b && thirdGroup === 0x0001) ||
    (firstGroup === 0x0100 && groups.slice(1, 4).every((group) => group === "0000")) ||
    (firstGroup === 0x2001 && secondGroup <= 0x01ff) ||
    (firstGroup === 0x2001 && secondGroup === 0x0db8) ||
    firstGroup === 0x2002 ||
    (firstGroup & 0xfe00) === 0xfc00 ||
    (firstGroup & 0xffc0) === 0xfe80 ||
    (firstGroup & 0xffc0) === 0xfec0 ||
    (firstGroup & 0xff00) === 0xff00
  );
}

function assertPublicHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    assert.fail(`URL 无法解析为 public http/https URL：${url}；原因：${String(error)}`);
  }

  assert.ok(
    parsed.protocol === "http:" || parsed.protocol === "https:",
    `URL 必须使用 http/https 协议：${url}`
  );
  assert.ok(parsed.hostname.length > 0, `URL hostname 不能为空：${url}`);

  const hostname = parsed.hostname.toLowerCase();
  assert.ok(
    hostname !== "localhost" && !hostname.endsWith(".localhost"),
    `URL hostname 不能是 localhost 或 .localhost：${url}`
  );

  const hostWithoutIpv6Brackets =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const ipVersion = net.isIP(hostWithoutIpv6Brackets);

  if (ipVersion === 4) {
    assert.ok(
      isPublicIpv4Literal(hostWithoutIpv6Brackets),
      `URL IPv4 hostname 必须是 public 地址：${url}`
    );
    return;
  }

  if (ipVersion === 6) {
    assert.ok(
      isPublicIpv6Literal(hostWithoutIpv6Brackets),
      `URL IPv6 hostname 必须是 public 地址：${url}`
    );
  }
}

async function runSourceWorkflow(options: RunSourceWorkflowOptions): Promise<string> {
  const { mcp, kbRoot, inputType, inputLocator } = options;
  const initialTitle =
    options.title ??
    (inputType === "markdown" ? sourceTitleFromPath(inputLocator) : displayTitle(inputLocator));
  const query = options.query ?? initialTitle;

  await mcp.callToolAtStage<SearchResult[]>(
    "pre-search source page",
    "kb_search_wiki",
    { query, type_filter: "source", mode: "page" },
    inputLocator
  );

  const registered =
    inputType === "markdown"
      ? await mcp.callToolAtStage<RegisteredSource>(
          "register markdown source",
          "kb_source_add",
          { file_path: inputLocator },
          inputLocator
        )
      : await mcp.callToolAtStage<RegisteredSource>(
          "register url source",
          "kb_url_add",
          {
            url: inputLocator,
            accept_language: "zh-CN,zh;q=0.9,en;q=0.8",
          },
          inputLocator
        );

  assertNonEmptyString(registered.source_id, "source_id");
  assertNonEmptyString(registered.canonical_path, "canonical_path");
  assert.equal(registered.manifest.canonical_path, registered.canonical_path);
  const titleSeed =
    options.title ??
    (inputType === "url" ? registered.title ?? registered.file_name ?? initialTitle : initialTitle);
  const title = displayTitle(titleSeed);
  const linkLabel = wikilinkLabel(title);
  const logTitle = logSafeText(`real-data-e2e ${registered.source_id}`, "real-data-e2e");
  const logSummary = logSafeText(
    `Registered ${inputType} source and wrote source page.`,
    "Registered source and wrote source page."
  );
  const logOutputLabel = logSafeText(title);

  if (inputType === "markdown") {
    assertNonEmptyString(registered.file_name, "file_name");
  } else {
    assertNonEmptyString(
      registered.manifest.url_metadata?.final_url,
      "manifest.url_metadata.final_url"
    );
  }

  const sourceContent = await readFullSource(mcp, registered.source_id, inputLocator);
  assertNonEmptyString(sourceContent, "canonical source content");

  if (inputType === "markdown") {
    const firstSourceLine = fs
      .readFileSync(inputLocator, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(
        (line) =>
          line.length > 0 &&
          line !== "---" &&
          !/^[A-Za-z_][A-Za-z0-9_-]*:\s*.*$/u.test(line)
      );
    assertNonEmptyString(firstSourceLine, "first source line");
    assert.ok(
      sourceContent.includes(firstSourceLine),
      `canonical source should contain first source line: ${firstSourceLine}`
    );
  }

  const pagePath = `wiki/sources/${registered.source_id}.md`;
  const pageContent = buildSourcePage({
    sourceId: registered.source_id,
    title,
    inputType,
    inputLocator,
    charCount: sourceContent.length,
  });

  await mcp.callToolAtStage(
    "write source page",
    "kb_write_page",
    { path: pagePath, content: pageContent, create_only: true },
    registered.source_id
  );
  await mcp.callToolAtStage(
    "update source page source section",
    "kb_update_section",
    {
      path: pagePath,
      heading: "## 来源",
      content: `- [[${registered.source_id}|${linkLabel}]]\n- canonical_path: ${registered.canonical_path}\n- input: ${inputLocator}`,
      append: false,
      create_if_missing: false,
    },
    registered.source_id
  );
  await mcp.callToolAtStage(
    "ensure index source entry",
    "kb_ensure_entry",
    {
      path: "wiki/index.md",
      entry: `- [[${registered.source_id}|${linkLabel}]]`,
      anchor: "## Sources",
      dedup_key: `index_source_${registered.source_id}`,
    },
    registered.source_id
  );
  await mcp.callToolAtStage(
    "append ingest log",
    "kb_append_log_entry",
    {
      path: "wiki/log.md",
      kind: "ingest",
      title: logTitle,
      summary: logSummary,
      date: TEST_DATE,
      changes: [pagePath, "wiki/index.md", "wiki/log.md"],
      references: [registered.source_id],
      output_page_id: registered.source_id,
      output_label: logOutputLabel,
      dedup_key: `log_ingest_${registered.source_id}_real_data_e2e`,
    },
    registered.source_id
  );
  await mcp.callToolAtStage(
    "finalize ingest",
    "kb_ingest_finalize",
    {
      source_id: registered.source_id,
      status: "ingested",
      summary_page_id: registered.source_id,
      touched_pages: [pagePath, "wiki/index.md", "wiki/log.md"],
    },
    registered.source_id
  );

  const lint = await mcp.callToolAtStage<KbLintReport>(
    "run lint",
    "kb_run_lint",
    { include_semantic: false },
    registered.source_id
  );
  assert.equal(lint.ok, true);
  assert.equal(lint.deterministic.errors, 0);

  const searchResults = await mcp.callToolAtStage<SearchResult[]>(
    "search written source page",
    "kb_search_wiki",
    { query: title, type_filter: "source", mode: "page" },
    registered.source_id
  );
  assert.ok(
    searchResults.some(
      (result) => result.page_id === registered.source_id && result.path === pagePath
    ),
    `search results should include ${pagePath}`
  );

  const readPage = await mcp.callToolAtStage<ReadPageOutput>(
    "read written source page",
    "kb_read_page",
    { path_or_id: registered.source_id },
    registered.source_id
  );
  assert.equal(readPage.frontmatter.id, registered.source_id);
  assert.equal(readPage.frontmatter.type, "source");
  assert.equal(readPage.frontmatter.status, "active");
  assert.deepEqual(readPage.frontmatter.source_ids, [registered.source_id]);
  assert.ok(readPage.body.includes(`[[${registered.source_id}|`));

  const rawInboxPath = path.join(kbRoot, "raw", "inbox", `${registered.source_id}.md`);
  const canonicalPath = path.resolve(kbRoot, registered.canonical_path);
  assert.equal(canonicalPath, rawInboxPath);
  assertFileExists(rawInboxPath);
  assert.equal(fs.readFileSync(rawInboxPath, "utf8"), sourceContent);
  assertFileExists(path.join(kbRoot, "state", "manifests", `${registered.source_id}.json`));
  assertFileExists(path.join(kbRoot, pagePath));

  const indexContent = fs.readFileSync(path.join(kbRoot, "wiki", "index.md"), "utf8");
  const logContent = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");
  assert.ok(indexContent.includes(`<!-- dedup:index_source_${registered.source_id} -->`));
  assert.ok(
    logContent.includes(`<!-- dedup:log_ingest_${registered.source_id}_real_data_e2e -->`)
  );
  assertCacheContainsMetaPages(kbRoot);
  assertCacheContainsPage(kbRoot, registered.source_id, pagePath);

  const manifest = readJson<RegisteredSource["manifest"]>(
    path.join(kbRoot, "state", "manifests", `${registered.source_id}.json`)
  );
  assert.equal(manifest.source_origin, inputType === "markdown" ? "file" : "url");
  assert.equal(manifest.canonical_path, registered.canonical_path);
  assert.equal(manifest.ingest_status, "ingested");
  assert.equal(manifest.ingest_summary_page_id, registered.source_id);
  assert.deepEqual(manifest.ingest_touched_pages, [pagePath, "wiki/index.md", "wiki/log.md"]);

  return registered.source_id;
}

test("MCP 与 OpenClaw plugin 暴露同一套 canonical KB tool contract", async () => {
  const mcpFixture = createCleanKbFixture("kb-real-data-e2e-mcp-");
  const openclawFixture = createCleanKbFixture("kb-real-data-e2e-openclaw-");
  const previousKbRoot = process.env.KB_ROOT;
  let mcp: McpToolClient | undefined;
  let primaryError: unknown;

  try {
    mcp = await startKbMcpClient({
      serverCommand: sourceMcpServerCommand(),
      serverArgs: ["--tsconfig", "tsconfig.scripts.json", "src/mcp_server.ts"],
      kbRoot: mcpFixture.kbRoot,
      cwd: REPO_ROOT,
    });

    const expectedToolNames = KB_TOOL_DEFINITIONS.map((tool) => tool.name);
    const expectedInputSchemas = KB_TOOL_DEFINITIONS.map((tool) => tool.inputSchema);
    const mcpTools = await mcp.listTools();
    assert.deepEqual(
      (mcpTools as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name),
      expectedToolNames
    );
    assert.deepEqual(
      (mcpTools as { tools: Array<{ inputSchema: Record<string, unknown> }> }).tools.map(
        (tool) => tool.inputSchema
      ),
      expectedInputSchemas
    );

    const openclawTools: OpenClawRegisteredTool[] = [];
    pluginEntry.register({
      registerTool(tool: OpenClawRegisteredTool): void {
        openclawTools.push(tool);
      },
    });

    assert.deepEqual(
      openclawTools.map((tool) => tool.name),
      expectedToolNames
    );
    assert.deepEqual(
      openclawTools.map((tool) => tool.parameters),
      expectedInputSchemas
    );

    const mcpRebuild = await mcp.callTool<RebuildPageIndexOutput>("kb_rebuild_index", {
      allow_partial: false,
    });
    assert.equal(mcpRebuild.version, 2);
    assert.equal(mcpRebuild.total_pages, 2);
    assert.equal(mcpRebuild.written_to, "kb/state/cache/page-index.json");
    assert.deepEqual(mcpRebuild.skipped_pages, []);
    assertCacheContainsMetaPages(mcpFixture.kbRoot);

    process.env.KB_ROOT = openclawFixture.kbRoot;
    const openclawRebuildTool = openclawTools.find(
      (tool) => tool.name === "kb_rebuild_index"
    );
    assert.ok(openclawRebuildTool, "OpenClaw should register kb_rebuild_index");
    const openclawResponse = await openclawRebuildTool.execute("real-data-e2e", {
      allow_partial: false,
    });
    const openclawText = openclawResponse.content.find((item) => item.type === "text")?.text;
    assertNonEmptyString(openclawText, "OpenClaw kb_rebuild_index text response");
    const openclawRebuild = JSON.parse(openclawText) as RebuildPageIndexOutput;

    assert.equal(openclawRebuild.version, mcpRebuild.version);
    assert.equal(openclawRebuild.total_pages, mcpRebuild.total_pages);
    assert.equal(openclawRebuild.written_to, mcpRebuild.written_to);
    assert.deepEqual(openclawRebuild.skipped_pages, mcpRebuild.skipped_pages);
    assertCacheContainsMetaPages(openclawFixture.kbRoot);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await mcp?.close().catch(() => undefined);
    if (previousKbRoot === undefined) {
      delete process.env.KB_ROOT;
    } else {
      process.env.KB_ROOT = previousKbRoot;
    }
    cleanupFixture(mcpFixture, "MCP fixture", primaryError);
    cleanupFixture(openclawFixture, "OpenClaw fixture", primaryError);
  }
});

test("真实 Markdown source 可通过 MCP 完成 TOOLS.md 工作流", async (t) => {
  const markdownSources = listMarkdownSources(REPO_ROOT);
  assert.ok(markdownSources.length > 0, "应至少包含一个真实 Markdown source");

  for (const filePath of markdownSources) {
    await t.test(`Markdown 工作流：${path.basename(filePath)}`, async () => {
      const fixture = createCleanKbFixture();
      let mcp: McpToolClient | undefined;
      let primaryError: unknown;

      try {
        mcp = await startKbMcpClient({
          serverCommand: sourceMcpServerCommand(),
          serverArgs: ["--tsconfig", "tsconfig.scripts.json", "src/mcp_server.ts"],
          kbRoot: fixture.kbRoot,
          cwd: REPO_ROOT,
        });

        const rebuild = await mcp.callTool<RebuildPageIndexOutput>("kb_rebuild_index", {
          allow_partial: false,
        });
        assert.equal(rebuild.version, 2);
        assert.equal(rebuild.total_pages, 2);
        assert.deepEqual(rebuild.skipped_pages, []);
        assertCacheContainsMetaPages(fixture.kbRoot);

        await runSourceWorkflow({
          mcp,
          kbRoot: fixture.kbRoot,
          inputType: "markdown",
          inputLocator: filePath,
        });
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        await mcp?.close().catch(() => undefined);
        cleanupFixture(fixture, `Markdown fixture: ${filePath}`, primaryError);
      }
    });
  }
});

test("真实 URL source 在显式启用时可通过 MCP 完成 TOOLS.md 工作流", async (t) => {
  const urls = listUrlSources(REPO_ROOT);
  assert.ok(urls.length > 0, "应至少包含一个真实 URL source");

  for (const url of urls) {
    assertPublicHttpUrl(url);

    if (process.env.RUN_REAL_DATA_E2E_URLS !== "1") {
      await t.test(`URL 工作流：${url}`, {
        skip: "设置 RUN_REAL_DATA_E2E_URLS=1 后才会发起真实 URL ingest。",
      });
      continue;
    }

    await t.test(`URL 工作流：${url}`, async () => {
      const fixture = createCleanKbFixture();
      let mcp: McpToolClient | undefined;
      let primaryError: unknown;

      try {
        mcp = await startKbMcpClient({
          serverCommand: sourceMcpServerCommand(),
          serverArgs: ["--tsconfig", "tsconfig.scripts.json", "src/mcp_server.ts"],
          kbRoot: fixture.kbRoot,
          cwd: REPO_ROOT,
        });

        const rebuild = await mcp.callTool<RebuildPageIndexOutput>("kb_rebuild_index", {
          allow_partial: false,
        });
        assert.equal(rebuild.version, 2);
        assert.equal(rebuild.total_pages, 2);
        assert.deepEqual(rebuild.skipped_pages, []);
        assertCacheContainsMetaPages(fixture.kbRoot);

        const sourceId = await runSourceWorkflow({
          mcp,
          kbRoot: fixture.kbRoot,
          inputType: "url",
          inputLocator: url,
        });
        const manifest = readJson<RegisteredSource["manifest"]>(
          path.join(fixture.kbRoot, "state", "manifests", `${sourceId}.json`)
        );

        assertUrlArtifact(manifest.source_origin === "url", "source_origin 应为 url", url);
        assertUrlArtifact(
          manifest.source_kind === "converted_markdown",
          "source_kind 应为 converted_markdown",
          url
        );
        assertUrlArtifact(
          typeof manifest.original_path === "string",
          "original_path 应为字符串",
          url
        );
        assertUrlArtifact(
          fs.existsSync(path.join(fixture.kbRoot, manifest.original_path)),
          "original_path 指向的文件应存在",
          url
        );
        assertUrlArtifact(
          typeof manifest.extraction_path === "string",
          "extraction_path 应为字符串",
          url
        );
        assertUrlArtifact(
          fs.existsSync(path.join(fixture.kbRoot, manifest.extraction_path)),
          "extraction_path 指向的文件应存在",
          url
        );
        assertUrlArtifact(
          typeof manifest.url_metadata?.final_url === "string" &&
            manifest.url_metadata.final_url.trim().length > 0,
          "url_metadata.final_url 应非空",
          url
        );

        const canonicalMarkdown = fs.readFileSync(
          path.join(fixture.kbRoot, manifest.canonical_path),
          "utf8"
        );
        assertUrlArtifact(
          canonicalMarkdown.includes("kb-source-provenance:v1"),
          "canonical Markdown 应包含 provenance 注释",
          url
        );
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        await mcp?.close().catch(() => undefined);
        cleanupFixture(fixture, `URL fixture: ${url}`, primaryError);
      }
    });
  }
});
