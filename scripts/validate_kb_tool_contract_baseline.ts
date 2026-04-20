import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { kbCommit } from "../src/tools/kb_commit";
import { kbEnsureEntry } from "../src/tools/kb_ensure_entry";
import { kbReadPage } from "../src/tools/kb_read_page";
import { kbReadSource } from "../src/tools/kb_read_source";
import { kbSearchWiki } from "../src/tools/kb_search_wiki";
import { kbSourceAdd } from "../src/tools/kb_source_add";
import { kbUpdateSection } from "../src/tools/kb_update_section";
import { kbWritePage } from "../src/tools/kb_write_page";
import { writeWikiPage as coreWriteWikiPage, updateWikiSection } from "../src/core/wiki-pages";
import { ensureWikiEntry as coreEnsureWikiEntry } from "../src/core/wiki-log";
import { searchWiki as coreSearchWiki, readWikiPage as coreReadWikiPage } from "../src/core/wiki-search";
import type { PageIndex, WorkspaceConfig } from "../src/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  assert(haystack.includes(needle), `${message}\nExpected to find: ${needle}\nIn: ${haystack}`);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  assert(actualJson === expectedJson, `${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
}

function assertDefined<T>(value: T | undefined, message: string): T {
  assert(value !== undefined, message);
  return value;
}

function createTempKbRoot(): { tempRoot: string; kbRoot: string; config: WorkspaceConfig } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-contract-baseline-"));
  const kbRoot = path.join(tempRoot, "kb");
  fs.mkdirSync(path.join(kbRoot, "wiki"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "state", "cache"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "state", "manifests"), { recursive: true });
  return { tempRoot, kbRoot, config: { kb_root: kbRoot } };
}

function createFreshTempKbRoot(): { tempRoot: string; kbRoot: string; config: WorkspaceConfig } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-contract-baseline-fresh-"));
  const kbRoot = path.join(tempRoot, "kb");
  fs.mkdirSync(path.join(kbRoot, "state", "cache"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "state", "manifests"), { recursive: true });
  return { tempRoot, kbRoot, config: { kb_root: kbRoot } };
}

function repoRoot(): string {
  return path.resolve(__dirname, "..");
}

function tsxBinary(): string {
  return path.resolve(repoRoot(), "node_modules", ".bin", "tsx");
}

function mcpServerPath(): string {
  return path.resolve(repoRoot(), "src", "mcp_server.ts");
}

function scriptsTsconfigPath(): string {
  return path.resolve(repoRoot(), "tsconfig.scripts.json");
}

function childEnv(kbRoot: string): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    KB_ROOT: kbRoot,
  };
}

function writePageIndex(kbRoot: string, index: PageIndex): void {
  const indexPath = path.join(kbRoot, "state", "cache", "page-index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
}

function readText(absPath: string): string {
  return fs.readFileSync(absPath, "utf8");
}

async function withMcpClient<T>(
  kbRoot: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ name: "kb-contract-baseline", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: tsxBinary(),
    args: ["--tsconfig", scriptsTsconfigPath(), mcpServerPath()],
    cwd: repoRoot(),
    env: childEnv(kbRoot),
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function testMcpServerSurfaceMatchesInventory(): Promise<void> {
  const { tempRoot, kbRoot } = createTempKbRoot();
  try {
    await withMcpClient(kbRoot, async (client) => {
      const toolsResult = await client.listTools();
      const actualTools = toolsResult.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }));
      const actualToolMap = new Map(actualTools.map((tool) => [tool.name, tool]));

      const expectedWorkflowTools = [
        {
          name: "kb_source_add",
          description:
            "Register a source file (.md or .txt) into the knowledge base. Returns manifest and source_id.",
          inputSchema: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Absolute or relative path to the source file to ingest.",
              },
            },
            required: ["file_path"],
          },
        },
        {
          name: "kb_read_source",
          description: "Read raw source content by source_id. Large files are truncated at 200 KB.",
          inputSchema: {
            type: "object",
            properties: {
              source_id: {
                type: "string",
                description: "The source_id returned by kb_source_add.",
              },
            },
            required: ["source_id"],
          },
        },
        {
          name: "kb_write_page",
          description:
            "Create or update a wiki page. Validates YAML frontmatter and refreshes page-index.json.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the wiki page, relative to kb/ (e.g. wiki/concepts/foo.md).",
              },
              content: {
                type: "string",
                description: "Full Markdown content including YAML frontmatter block.",
              },
              create_only: {
                type: "boolean",
                description: "If true, fail if the file already exists. Default: false.",
              },
            },
            required: ["path", "content"],
          },
        },
        {
          name: "kb_update_section",
          description:
            "Update (replace or append to) a specific heading section in an existing wiki page.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the wiki page, relative to kb/.",
              },
              heading: {
                type: "string",
                description: "Exact heading line to find (e.g. '## Summary').",
              },
              content: {
                type: "string",
                description: "New content to place under the heading.",
              },
              append: {
                type: "boolean",
                description: "If true, append content after existing section content. Default: false.",
              },
              create_if_missing: {
                type: "boolean",
                description:
                  "If true, create the section at end of file when heading is not found. Default: true.",
              },
            },
            required: ["path", "heading", "content"],
          },
        },
        {
          name: "kb_ensure_entry",
          description:
            "Idempotently insert a line entry into an index or log page. Uses a dedup_key to prevent duplicates.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the wiki page, relative to kb/.",
              },
              entry: {
                type: "string",
                description: "The line content to insert.",
              },
              anchor: {
                type: ["string", "null"],
                description:
                  "Exact anchor line after which to insert the entry. Pass null to append at end of file.",
              },
              dedup_key: {
                type: "string",
                description: "Unique key used for idempotency — if already present, no-op.",
              },
            },
            required: ["path", "entry", "anchor", "dedup_key"],
          },
        },
        {
          name: "kb_search_wiki",
          description:
            "Search the wiki via page-index.json. Supports keyword search, type/tag filtering, and wikilink resolution.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Keyword query string.",
              },
              type_filter: {
                type: "string",
                description: "Filter results to a specific page type (e.g. 'concept', 'entity').",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Require all listed tags to be present on matching pages.",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return. Default: 10.",
              },
              resolve_link: {
                type: "string",
                description:
                  "If set, resolve this wikilink (e.g. '[[Foo]]' or 'Foo') and return the matching page (ignores query).",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "kb_read_page",
          description: "Read a wiki page by path or page_id. Returns frontmatter and body separately.",
          inputSchema: {
            type: "object",
            properties: {
              path_or_id: {
                type: "string",
                description:
                  "Path relative to kb/ (e.g. wiki/concepts/foo.md) OR a page_id (e.g. 'foo').",
              },
            },
            required: ["path_or_id"],
          },
        },
        {
          name: "kb_commit",
          description:
            "Stage all kb/ changes and create a Git commit. Message should follow: 'kb: <action> <source_id> and <description>'.",
          inputSchema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "Git commit message.",
              },
            },
            required: ["message"],
          },
        },
      ];

      assert(
        actualTools.length >= expectedWorkflowTools.length,
        "MCP tools/list surface must include the original 8 workflow tools"
      );

      for (const expectedTool of expectedWorkflowTools) {
        const actualTool = assertDefined(
          actualToolMap.get(expectedTool.name),
          `Missing expected workflow tool from MCP surface: ${expectedTool.name}`
        );
        assertDeepEqual(
          actualTool,
          expectedTool,
          `Workflow tool contract changed unexpectedly for ${expectedTool.name}`
        );
      }

      const unknownToolResult = await client.callTool({
        name: "kb_not_a_real_tool",
        arguments: {},
      });
      assert(unknownToolResult.isError === true, "Unknown tool calls should be marked isError");
      assert(
        unknownToolResult.content.length === 1 && unknownToolResult.content[0].type === "text",
        "Unknown tool calls should return a single text content item"
      );
      assert(
        unknownToolResult.content[0].type === "text" &&
          unknownToolResult.content[0].text === "Error: Unknown tool: kb_not_a_real_tool",
        "Unknown tool calls should be wrapped with the current transport error style"
      );

      const invalidFrontmatterMarkdown = `---
title: Bad Frontmatter
updated_at: 2026-04-20
status: active

Body.
`;
      const wrappedError = await client.callTool({
        name: "kb_write_page",
        arguments: {
          path: "wiki/concepts/bad-frontmatter.md",
          content: invalidFrontmatterMarkdown,
        },
      });
      assert(wrappedError.isError === true, "Tool failures should be marked isError");
      assert(
        wrappedError.content.length === 1 && wrappedError.content[0].type === "text",
        "Tool failures should return a single text content item"
      );
      assert(
        wrappedError.content[0].type === "text" &&
          wrappedError.content[0].text.startsWith("Error: Frontmatter validation failed:"),
        "Tool failures should be wrapped in the current Error: prefix"
      );
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testWritePageRejectsInvalidFrontmatter(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const result = await kbWritePage(
      {
        path: "wiki/concepts/bad-frontmatter.md",
        content: `---
title: Bad Frontmatter
updated_at: 2026-04-20
status: active

Body.
`,
      },
      config
    );

    assert(!result.success, "kb_write_page unexpectedly accepted invalid frontmatter");
    assertIncludes(
      result.error ?? "",
      "Frontmatter validation failed",
      "kb_write_page should reject invalid frontmatter"
    );
    assert(
      !fs.existsSync(path.join(kbRoot, "wiki", "concepts", "bad-frontmatter.md")),
      "kb_write_page wrote a file even though frontmatter validation failed"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testWritePageRejectsPathsOutsideWiki(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const result = await kbWritePage(
      {
        path: "raw/escape.md",
        content: `---
id: escape
type: concept
title: Escape
updated_at: 2026-04-20
status: active

Body.
`,
      },
      config
    );

    assert(!result.success, "kb_write_page unexpectedly accepted a path outside kb/wiki");
    assertIncludes(
      result.error ?? "",
      "outside kb/wiki/",
      "kb_write_page should reject writes outside kb/wiki"
    );
    assert(
      !fs.existsSync(path.join(kbRoot, "raw", "escape.md")),
      "kb_write_page wrote a file outside kb/wiki"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testSourceAddHappyPathAndDuplicateContent(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const sourcePath = path.join(tempRoot, "source.md");
    fs.writeFileSync(sourcePath, "# Source\n\nBody.\n", "utf8");

    const first = await kbSourceAdd({ file_path: sourcePath }, config);
    assert(first.success, `kb_source_add failed on happy path: ${first.error ?? "unknown error"}`);
    assert(first.data?.file_name === "source.md", "kb_source_add should preserve the source file name");
    assert(
      first.data?.canonical_path === `raw/inbox/${first.data?.source_id}.md`,
      "kb_source_add should report the copied canonical path"
    );
    assert(
      fs.existsSync(path.join(kbRoot, first.data?.canonical_path ?? "")),
      "kb_source_add should copy the source into kb/raw/inbox"
    );
    assert(
      fs.existsSync(path.join(kbRoot, "state", "manifests", `${first.data?.source_id}.json`)),
      "kb_source_add should write a manifest record"
    );

    const duplicatePath = path.join(tempRoot, "duplicate.md");
    fs.writeFileSync(duplicatePath, "# Source\n\nBody.\n", "utf8");
    const duplicate = await kbSourceAdd({ file_path: duplicatePath }, config);
    assert(!duplicate.success, "kb_source_add unexpectedly accepted duplicate content");
    assert(
      duplicate.error ===
        `Duplicate content: source already registered as ${first.data?.source_id} (${path.resolve(sourcePath)})`,
      "kb_source_add should preserve duplicate-content error text"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testReadSourceHappyPathAndManifestErrors(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const sourcePath = path.join(tempRoot, "read-source.txt");
    fs.writeFileSync(sourcePath, "Plaintext source body.\n", "utf8");
    const added = await kbSourceAdd({ file_path: sourcePath }, config);
    assert(added.success && added.data, "kb_source_add should succeed for kb_read_source setup");

    const read = await kbReadSource({ source_id: added.data.source_id }, config);
    assert(read.success, `kb_read_source happy path failed: ${read.error ?? "unknown error"}`);
    assert(read.data?.source_id === added.data.source_id, "kb_read_source should echo the requested source_id");
    assert(read.data?.source_kind === "plaintext", "kb_read_source should read source_kind from the manifest");
    assert(read.data?.file_name === "read-source.txt", "kb_read_source should return the manifest file_name");
    assertIncludes(read.data?.content ?? "", "Plaintext source body.", "kb_read_source should read content through the manifest canonical_path");

    const missing = await kbReadSource({ source_id: "missing_source" }, config);
    assert(!missing.success, "kb_read_source unexpectedly succeeded for a missing manifest");
    assert(
      missing.error === "Manifest not found for source_id: missing_source",
      "kb_read_source should preserve missing-manifest behavior"
    );

    fs.writeFileSync(
      path.join(kbRoot, "state", "manifests", "broken_source.json"),
      "{ this is not valid json",
      "utf8"
    );
    const malformed = await kbReadSource({ source_id: "broken_source" }, config);
    assert(!malformed.success, "kb_read_source unexpectedly succeeded for a malformed manifest");
    assert(
      malformed.error === "Malformed manifest for source_id: broken_source",
      "kb_read_source should preserve malformed-manifest behavior"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testEnsureEntryIsIdempotent(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const logPath = path.join(kbRoot, "wiki", "log.md");
    fs.writeFileSync(
      logPath,
      `---
id: log
type: index
title: Log
updated_at: 2026-04-20
status: active
---

## Entries

`,
      "utf8"
    );
    const entry = "2026-04-20 Baseline contract check";
    const dedupKey = "baseline-contract-entry";

    const first = await kbEnsureEntry(
      {
        path: "wiki/log.md",
        entry,
        anchor: "## Entries",
        dedup_key: dedupKey,
      },
      config
    );
    assert(first.success, `kb_ensure_entry first run failed: ${first.error ?? "unknown error"}`);
    assert(first.data?.action === "inserted", "First kb_ensure_entry call should insert the entry");

    const afterFirst = readText(logPath);

    const second = await kbEnsureEntry(
      {
        path: "wiki/log.md",
        entry,
        anchor: "## Entries",
        dedup_key: dedupKey,
      },
      config
    );
    assert(second.success, `kb_ensure_entry second run failed: ${second.error ?? "unknown error"}`);
    assert(
      second.data?.action === "already_exists",
      "Second kb_ensure_entry call should be idempotent"
    );
    assert(
      readText(logPath) === afterFirst,
      "kb_ensure_entry changed the file on the second identical call"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testUpdateSectionPreservesLegacySuccessPayloadPath(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const canonicalPath = path.join(kbRoot, "wiki", "concepts", "compat-path.md");
    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
    fs.writeFileSync(
      canonicalPath,
      `---
id: compat_path
type: concept
title: Compat Path
updated_at: 2026-04-20
status: active
---

## Summary

Old body.
`,
      "utf8"
    );

    const inputPath = "wiki/concepts/../concepts/compat-path.md";
    const result = await kbUpdateSection(
      {
        path: inputPath,
        heading: "## Summary",
        content: "Updated body.",
      },
      config
    );

    assert(result.success, `kb_update_section failed: ${result.error ?? "unknown error"}`);
    assert(
      result.data?.path === inputPath,
      "kb_update_section should preserve the legacy success payload path: input.path"
    );
    assert(result.data?.action === "replaced", "kb_update_section should still report the section action");
    assertIncludes(
      readText(canonicalPath),
      "Updated body.",
      "kb_update_section should still update the target file while preserving the legacy payload path"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testSearchWikiResolveLinkIsStable(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const index: PageIndex = {
      pages: [
        {
          page_id: "risc_v",
          path: "wiki/entities/risc_v.md",
          type: "entity",
          title: "RISC-V",
          aliases: ["RISC V"],
          tags: ["isa"],
          headings: ["Summary"],
          body_excerpt: "RISC-V entity page",
        },
        {
          page_id: "decoy_matrix_article",
          path: "wiki/concepts/decoy_matrix_article.md",
          type: "concept",
          title: "From Vector to Matrix: The Future of RISC-V Matrix Extensions",
          aliases: [],
          tags: ["decoy"],
          headings: ["Main"],
          body_excerpt: "Decoy page to ensure parser uses pipe-left target instead of display text",
        },
        {
          page_id: "src_sha256_08e04538",
          path: "wiki/sources/src_sha256_08e04538.md",
          type: "source",
          title: "From Vector to Matrix: The Future of RISC-V Matrix Extensions",
          aliases: [],
          tags: ["risc-v", "matrix"],
          headings: ["Main"],
          body_excerpt: "Source page",
        },
      ],
    };
    writePageIndex(kbRoot, index);

    const resolve = async (resolve_link: string) => {
      const result = await kbSearchWiki({ query: "", resolve_link }, config);
      assert(result.success, `kb_search_wiki failed for ${resolve_link}: ${result.error ?? "unknown error"}`);
      return result.data ?? [];
    };

    const byId = await resolve("[[risc_v]]");
    assert(byId.length === 1 && byId[0].page_id === "risc_v", "Expected [[risc_v]] to resolve to risc_v");

    const byIdWithOuterWhitespace = await resolve(" [[risc_v]] ");
    assert(
      byIdWithOuterWhitespace.length === 1 && byIdWithOuterWhitespace[0].page_id === "risc_v",
      'Expected " [[risc_v]] " to resolve to risc_v'
    );

    const byTitle = await resolve("[[RISC-V]]");
    assert(byTitle.length === 1 && byTitle[0].page_id === "risc_v", "Expected [[RISC-V]] to resolve to risc_v");

    const byPipeWithSpaces = await resolve("[[ risc_v | Label ]]");
    assert(
      byPipeWithSpaces.length === 1 && byPipeWithSpaces[0].page_id === "risc_v",
      "Expected [[ risc_v | Label ]] to resolve using pipe-left target risc_v"
    );

    const byPipe = await resolve(
      "[[src_sha256_08e04538|From Vector to Matrix: The Future of RISC-V Matrix Extensions]]"
    );
    assert(
      byPipe.length === 1 && byPipe[0].page_id === "src_sha256_08e04538" && byPipe[0].type === "source",
      "Expected [[id|title]] to resolve by id to source page (not display text decoy)"
    );

    const miss = await resolve("[[not_exists_page]]");
    assert(miss.length === 0, "Expected unresolved link to return empty results");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCommitNoOpMappingIsPreserved(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const fakeBinDir = path.join(tempRoot, "fake-bin");
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeGitPath = path.join(fakeBinDir, "git");
    fs.writeFileSync(
      fakeGitPath,
      "#!/bin/sh\n" +
        "cmd=\"$1\"\n" +
        "shift\n" +
        "case \"$cmd\" in\n" +
        "  add)\n" +
        "    exit 0\n" +
        "    ;;\n" +
        "  diff)\n" +
        "    printf 'kb/wiki/tracked.md\\n'\n" +
        "    exit 0\n" +
        "    ;;\n" +
        "  commit)\n" +
        "    printf 'nothing to commit, working tree clean\\n' >&2\n" +
        "    exit 1\n" +
        "    ;;\n" +
        "  rev-parse)\n" +
        "    printf 'deadbeef\\n'\n" +
        "    exit 0\n" +
        "    ;;\n" +
        "  *)\n" +
        "    printf 'unexpected fake git command: %s\\n' \"$cmd\" >&2\n" +
        "    exit 99\n" +
        "    ;;\n" +
        "esac\n",
      { encoding: "utf8", mode: 0o755 }
    );

    const originalPath = process.env.PATH ?? "";
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath}`;
    try {
      const result = await kbCommit({ message: "kb: test no-op mapping" }, config);
      assert(!result.success, "kb_commit unexpectedly succeeded for a forced no-op commit");
      assert(
        result.error === "No changes in kb/ to commit.",
        "kb_commit should preserve the special no-op commit error-text mapping"
      );
    } finally {
      process.env.PATH = originalPath;
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testReadPageResolvesPageIdViaPageIndex(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const pagePath = path.join(kbRoot, "wiki", "concepts", "indexed-page.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(
      pagePath,
      `---
id: indexed_page
type: concept
title: Indexed Page
updated_at: 2026-04-20
status: active
---

# Indexed Page

Body text.
`,
      "utf8"
    );
    writePageIndex(kbRoot, {
      pages: [
        {
          page_id: "indexed_page",
          path: "wiki/concepts/indexed-page.md",
          type: "concept",
          title: "Indexed Page",
          aliases: [],
          tags: [],
          headings: ["Indexed Page"],
          body_excerpt: "Body text.",
        },
      ],
    });

    const result = await kbReadPage({ path_or_id: "indexed_page" }, config);
    assert(result.success, `kb_read_page failed: ${result.error ?? "unknown error"}`);
    assert(result.data?.path === "wiki/concepts/indexed-page.md", "kb_read_page did not resolve page_id via page-index.json");
    assert(result.data?.frontmatter.id === "indexed_page", "kb_read_page returned the wrong frontmatter for the page_id");
    assertIncludes(result.data?.body ?? "", "Body text.", "kb_read_page returned the wrong body for the page_id");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCoreWriteWikiPageAllowsFreshKbWithoutWikiDir(): Promise<void> {
  const { tempRoot, kbRoot, config } = createFreshTempKbRoot();
  try {
    const result = coreWriteWikiPage(
      {
        path: "wiki/concepts/fresh-page.md",
        content: `---
id: fresh_page
type: concept
title: Fresh Page
updated_at: 2026-04-20
status: active
---

Fresh body.
`,
      },
      config
    );

    assert(result.path === "wiki/concepts/fresh-page.md", "core writeWikiPage should return the canonical wiki path on a fresh KB");
    assert(
      fs.existsSync(path.join(kbRoot, "wiki", "concepts", "fresh-page.md")),
      "core writeWikiPage should create parent wiki directories on a fresh KB"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCoreStrictPageIndexRejectsMalformedEntries(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    writePageIndex(kbRoot, { pages: [{} as never] });

    let searchError: unknown;
    try {
      coreSearchWiki({ query: "foo" }, config);
    } catch (error) {
      searchError = error;
    }

    assert(searchError instanceof Error, "core searchWiki should throw for malformed strict page-index entries");
    assertIncludes(
      searchError instanceof Error ? searchError.message : "",
      "Malformed page index",
      "core searchWiki should fail deterministically for malformed page-index entries"
    );

    let readError: unknown;
    try {
      coreReadWikiPage("broken_page", config);
    } catch (error) {
      readError = error;
    }

    assert(readError instanceof Error, "core readWikiPage should throw for malformed strict page-index entries");
    assertIncludes(
      readError instanceof Error ? readError.message : "",
      "Malformed page index",
      "core readWikiPage should fail deterministically for malformed page-index entries"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCoreUpdateAndEnsureRejectSymlinkFileTargets(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const escapedFile = path.join(kbRoot, "state", "escaped.md");
    fs.writeFileSync(
      escapedFile,
      `---
id: escaped
type: concept
title: Escaped
updated_at: 2026-04-20
status: active
---

## Summary

Old body.
`,
      "utf8"
    );
    const symlinkPath = path.join(kbRoot, "wiki", "concepts", "escaped.md");
    fs.mkdirSync(path.dirname(symlinkPath), { recursive: true });
    fs.symlinkSync(escapedFile, symlinkPath);

    let updateError: unknown;
    try {
      updateWikiSection(
        {
          path: "wiki/concepts/escaped.md",
          heading: "## Summary",
          content: "New body.",
        },
        config
      );
    } catch (error) {
      updateError = error;
    }
    assert(updateError instanceof Error, "core updateWikiSection should reject symlink file targets");
    assertIncludes(
      updateError instanceof Error ? updateError.message : "",
      "symlink",
      "core updateWikiSection should reject symlink file targets consistently"
    );

    const escapedLogFile = path.join(kbRoot, "state", "escaped-log.md");
    fs.writeFileSync(
      escapedLogFile,
      `---
id: log
type: index
title: Log
updated_at: 2026-04-20
status: active
---

## Entries
`,
      "utf8"
    );
    const logSymlinkPath = path.join(kbRoot, "wiki", "log.md");
    fs.symlinkSync(escapedLogFile, logSymlinkPath);

    let ensureError: unknown;
    try {
      coreEnsureWikiEntry(
        {
          path: "wiki/log.md",
          entry: "2026-04-20 test",
          anchor: "## Entries",
          dedup_key: "symlink-log",
        },
        config
      );
    } catch (error) {
      ensureError = error;
    }
    assert(ensureError instanceof Error, "core ensureWikiEntry should reject symlink file targets");
    assertIncludes(
      ensureError instanceof Error ? ensureError.message : "",
      "symlink",
      "core ensureWikiEntry should reject symlink file targets consistently"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCoreRejectsSymlinkedParentDirectoryAliases(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const conceptsDir = path.join(kbRoot, "wiki", "concepts");
    fs.mkdirSync(conceptsDir, { recursive: true });
    const aliasDir = path.join(kbRoot, "wiki", "alias");
    fs.symlinkSync(conceptsDir, aliasDir, "dir");

    let writeError: unknown;
    try {
      coreWriteWikiPage(
        {
          path: "wiki/alias/alias-page.md",
          content: `---
id: alias_page
type: concept
title: Alias Page
updated_at: 2026-04-20
status: active
---

Alias body.
`,
        },
        config
      );
    } catch (error) {
      writeError = error;
    }
    assert(writeError instanceof Error, "core writeWikiPage should reject symlinked parent-directory aliases");
    assertIncludes(
      writeError instanceof Error ? writeError.message : "",
      "symlink",
      "core writeWikiPage should reject alias-directory ancestors"
    );

    const targetPagePath = path.join(conceptsDir, "existing.md");
    fs.writeFileSync(
      targetPagePath,
      `---
id: existing
type: concept
title: Existing
updated_at: 2026-04-20
status: active
---

## Summary

Existing body.
`,
      "utf8"
    );

    let updateError: unknown;
    try {
      updateWikiSection(
        {
          path: "wiki/alias/existing.md",
          heading: "## Summary",
          content: "Updated body.",
        },
        config
      );
    } catch (error) {
      updateError = error;
    }
    assert(updateError instanceof Error, "core updateWikiSection should reject symlinked parent-directory aliases");
    assertIncludes(
      updateError instanceof Error ? updateError.message : "",
      "symlink",
      "core updateWikiSection should reject alias-directory ancestors"
    );

    const logPath = path.join(conceptsDir, "log.md");
    fs.writeFileSync(
      logPath,
      `---
id: log
type: index
title: Log
updated_at: 2026-04-20
status: active
---

## Entries
`,
      "utf8"
    );

    let ensureError: unknown;
    try {
      coreEnsureWikiEntry(
        {
          path: "wiki/alias/log.md",
          entry: "2026-04-20 alias",
          anchor: "## Entries",
          dedup_key: "alias-dir",
        },
        config
      );
    } catch (error) {
      ensureError = error;
    }
    assert(ensureError instanceof Error, "core ensureWikiEntry should reject symlinked parent-directory aliases");
    assertIncludes(
      ensureError instanceof Error ? ensureError.message : "",
      "symlink",
      "core ensureWikiEntry should reject alias-directory ancestors"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCoreWriteWikiPagePreservesLegacyIndexEntries(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const legacyIndex = {
      pages: [
        {
          page_id: "legacy_page",
          path: "wiki/concepts/legacy.md",
          type: "concept",
          title: "Legacy Page",
          aliases: [],
          tags: [],
          body_excerpt: "Legacy excerpt",
          legacy_field: "preserve-me",
        },
      ],
    };
    writePageIndex(kbRoot, legacyIndex as PageIndex);

    const result = coreWriteWikiPage(
      {
        path: "wiki/concepts/new-page.md",
        content: `---
id: new_page
type: concept
title: New Page
updated_at: 2026-04-20
status: active
---

New body.
`,
      },
      config
    );

    assert(result.path === "wiki/concepts/new-page.md", "core writeWikiPage should succeed when legacy page-index entries exist");

    const writtenIndex = JSON.parse(
      fs.readFileSync(path.join(kbRoot, "state", "cache", "page-index.json"), "utf8")
    ) as { pages: Array<Record<string, unknown>> };

    assert(
      writtenIndex.pages.some((page) => page.page_id === "legacy_page"),
      "core writeWikiPage should preserve existing legacy page-index entries instead of dropping them"
    );
    assert(
      writtenIndex.pages.some((page) => page.page_id === "new_page"),
      "core writeWikiPage should append the new page entry"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCoreReadWikiPageByIdSupportsLegacyIndexEntry(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const pagePath = path.join(kbRoot, "wiki", "concepts", "legacy-read.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(
      pagePath,
      `---
id: legacy_read
type: concept
title: Legacy Read
updated_at: 2026-04-20
status: active
---

Legacy body.
`,
      "utf8"
    );

    fs.writeFileSync(
      path.join(kbRoot, "state", "cache", "page-index.json"),
      JSON.stringify({ pages: [{ page_id: "legacy_read", path: "wiki/concepts/legacy-read.md" }] }, null, 2),
      "utf8"
    );

    const result = coreReadWikiPage("legacy_read", config);
    assert(result.path === "wiki/concepts/legacy-read.md", "core readWikiPage should resolve legacy page_id/path-only entries");
    assertIncludes(result.body, "Legacy body.", "core readWikiPage should still read the target page for legacy page_id/path-only entries");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCoreSearchWikiSupportsLegacyEntriesWithSafeDefaults(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    fs.writeFileSync(
      path.join(kbRoot, "state", "cache", "page-index.json"),
      JSON.stringify(
        {
          pages: [
            { page_id: "legacy_link", path: "wiki/concepts/legacy-link.md" },
            { page_id: "legacy_search", path: "wiki/concepts/legacy-search.md", title: "Legacy Search" },
          ],
        },
        null,
        2
      ),
      "utf8"
    );

    const resolved = coreSearchWiki({ query: "", resolve_link: "[[legacy_link]]" }, config);
    assert(resolved.length === 1, "core searchWiki resolve_link should work with legacy page_id/path-only entries");
    assert(resolved[0].page_id === "legacy_link", "core searchWiki resolve_link should resolve by legacy page_id");
    assert(resolved[0].title === "", "core searchWiki should normalize missing legacy title to an empty string");

    const searched = coreSearchWiki({ query: "legacy" }, config);
    assert(
      searched.some((page) => page.page_id === "legacy_search"),
      "core searchWiki keyword search should work with legacy entries missing optional fields"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCoreWriteWikiPageRejectsBadTopLevelIndexShapeWithoutRewrite(): Promise<void> {
  const { tempRoot, kbRoot, config } = createTempKbRoot();
  try {
    const indexPath = path.join(kbRoot, "state", "cache", "page-index.json");
    fs.writeFileSync(indexPath, JSON.stringify({ pages: null }, null, 2), "utf8");
    const before = fs.readFileSync(indexPath, "utf8");

    let writeError: unknown;
    try {
      coreWriteWikiPage(
        {
          path: "wiki/concepts/shape-fail.md",
          content: `---
id: shape_fail
type: concept
title: Shape Fail
updated_at: 2026-04-20
status: active
---

Body.
`,
        },
        config
      );
    } catch (error) {
      writeError = error;
    }

    assert(writeError instanceof Error, "core writeWikiPage should fail for top-level malformed page-index shape");
    assertIncludes(
      writeError instanceof Error ? writeError.message : "",
      "Malformed page index",
      "core writeWikiPage should report malformed page-index shape deterministically"
    );
    assert(
      fs.readFileSync(indexPath, "utf8") === before,
      "core writeWikiPage should not rewrite page-index.json when the top-level shape is malformed"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await testMcpServerSurfaceMatchesInventory();
  await testWritePageRejectsInvalidFrontmatter();
  await testWritePageRejectsPathsOutsideWiki();
  await testSourceAddHappyPathAndDuplicateContent();
  await testReadSourceHappyPathAndManifestErrors();
  await testEnsureEntryIsIdempotent();
  await testUpdateSectionPreservesLegacySuccessPayloadPath();
  await testSearchWikiResolveLinkIsStable();
  await testCommitNoOpMappingIsPreserved();
  await testReadPageResolvesPageIdViaPageIndex();
  await testCoreWriteWikiPageAllowsFreshKbWithoutWikiDir();
  await testCoreStrictPageIndexRejectsMalformedEntries();
  await testCoreUpdateAndEnsureRejectSymlinkFileTargets();
  await testCoreRejectsSymlinkedParentDirectoryAliases();
  await testCoreWriteWikiPagePreservesLegacyIndexEntries();
  await testCoreReadWikiPageByIdSupportsLegacyIndexEntry();
  await testCoreSearchWikiSupportsLegacyEntriesWithSafeDefaults();
  await testCoreWriteWikiPageRejectsBadTopLevelIndexShapeWithoutRewrite();
  console.log("PASS: kb tool contract baseline checks passed.");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(message);
  process.exit(1);
});
