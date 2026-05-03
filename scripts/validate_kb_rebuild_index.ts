import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { PageIndex, SearchIndex } from "../src/types";

interface RebuildSkippedPage {
  path: string;
  reason: string;
  error: string;
}

interface RebuildIndexSummary {
  version: number;
  total_pages: number;
  written_to: string;
  skipped_pages: RebuildSkippedPage[];
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  assert(actualJson === expectedJson, `${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
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

function createTempKbRoot(): { tempRoot: string; kbRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-rebuild-index-"));
  const kbRoot = path.join(tempRoot, "kb");
  fs.mkdirSync(path.join(kbRoot, "wiki", "concepts"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "wiki", "entities"), { recursive: true });
  return { tempRoot, kbRoot };
}

function childEnv(kbRoot: string): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    KB_ROOT: kbRoot,
  };
}

async function withMcpClient<T>(
  kbRoot: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ name: "kb-rebuild-index-validation", version: "0.1.0" });
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

function writeWikiFile(kbRoot: string, relativePath: string, content: string): void {
  const absolutePath = path.join(kbRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function readIndex(kbRoot: string): PageIndex {
  const indexPath = path.join(kbRoot, "state", "cache", "page-index.json");
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as PageIndex;
}

function readSearchIndex(kbRoot: string): SearchIndex {
  const indexPath = path.join(kbRoot, "state", "cache", "search-index.json");
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as SearchIndex;
}

async function callRebuildIndex(
  client: Client,
  args: { allow_partial?: boolean } = {}
): Promise<RebuildIndexSummary> {
  const result = await client.callTool({
    name: "kb_rebuild_index",
    arguments: args,
  });

  assert(!result.isError, "kb_rebuild_index should succeed");
  assert(Array.isArray(result.content) && result.content.length === 1, "Expected a single text result");
  const payload = result.content[0];
  assert(payload.type === "text", "Expected text tool payload");
  return JSON.parse(payload.text) as RebuildIndexSummary;
}

async function expectRebuildIndexFailure(client: Client): Promise<string> {
  const result = await client.callTool({
    name: "kb_rebuild_index",
    arguments: {},
  });

  assert(result.isError === true, "kb_rebuild_index duplicate-id failure should be marked isError");
  assert(Array.isArray(result.content) && result.content.length === 1, "Expected a single text error result");
  const payload = result.content[0];
  assert(payload.type === "text", "Expected text error payload");
  return payload.text;
}

async function main(): Promise<void> {
  const { tempRoot, kbRoot } = createTempKbRoot();

  try {
    writeWikiFile(
      kbRoot,
      "wiki/entities/alpha.md",
      [
        "---",
        "id: alpha",
        "type: entity",
        "title: Alpha",
        "updated_at: 2026-04-20",
        "status: active",
        "aliases: [A]",
        "tags: [core, entity]",
        "---",
        "",
        "# Alpha",
        "",
        "## Summary",
        "",
        "Alpha body excerpt.",
      ].join("\n")
    );
    writeWikiFile(
      kbRoot,
      "wiki/concepts/beta.md",
      [
        "---",
        "id: beta",
        "type: concept",
        "title: Beta",
        "updated_at: 2026-04-20",
        "status: active",
        "---",
        "",
        "## Definition",
        "",
        "Beta content.",
      ].join("\n")
    );
    writeWikiFile(
      kbRoot,
      "wiki/concepts/no-index.txt",
      "This should be ignored by kb_rebuild_index."
    );
    writeWikiFile(
      kbRoot,
      "wiki/concepts/skipped.md",
      [
        "---",
        "title: Missing id and type",
        "---",
        "",
        "This page should be skipped because it is not indexable.",
      ].join("\n")
    );

    await withMcpClient(kbRoot, async (client) => {
      const toolsResult = await client.listTools();
      const rebuildTool = toolsResult.tools.find((tool) => tool.name === "kb_rebuild_index");
      assert(rebuildTool !== undefined, "Expected kb_rebuild_index to be exposed by default");
      assertDeepEqual(
        rebuildTool,
        {
          name: "kb_rebuild_index",
          description:
            "Rebuild kb/state/cache/page-index.json and kb/state/cache/search-index.json from kb/wiki/**/*.md deterministically. Fails fast on invalid pages unless allow_partial is true.",
          inputSchema: {
            type: "object",
            properties: {
              allow_partial: {
                type: "boolean",
                description:
                  "If true, write an index for valid pages and return skipped_pages for invalid pages. Default: false.",
              },
            },
          },
        },
        "kb_rebuild_index should expose the expected MCP schema"
      );

      const firstSummary = await callRebuildIndex(client, { allow_partial: true });
      assert(firstSummary.version === 2, "kb_rebuild_index summary should use version 2");
      assert(firstSummary.total_pages === 2, "kb_rebuild_index summary should count indexed pages");
      assert(firstSummary.written_to === "kb/state/cache/page-index.json", "kb_rebuild_index should report the page index path");
      assert(firstSummary.skipped_pages.length === 1, "allow_partial should report one skipped invalid page");
      assert(firstSummary.skipped_pages[0].path === "wiki/concepts/skipped.md", "Skipped page path should be reported");

      const indexPath = path.join(kbRoot, "state", "cache", "page-index.json");
      const searchIndexPath = path.join(kbRoot, "state", "cache", "search-index.json");
      assert(fs.existsSync(indexPath), "kb_rebuild_index should create the page cache file");
      assert(fs.existsSync(searchIndexPath), "kb_rebuild_index should create the search cache file");
      const firstIndexText = fs.readFileSync(indexPath, "utf8");
      const firstSearchIndexText = fs.readFileSync(searchIndexPath, "utf8");
      const firstIndex = JSON.parse(firstIndexText) as Record<string, unknown>;
      assert(
        !Object.prototype.hasOwnProperty.call(firstIndex, "version"),
        "Persisted page-index.json must remain root-compatible without a top-level version field"
      );

      assertDeepEqual(
        firstIndex,
        {
          pages: [
            {
              page_id: "alpha",
              path: "wiki/entities/alpha.md",
              type: "entity",
              title: "Alpha",
              aliases: ["A"],
              tags: ["core", "entity"],
              headings: ["Alpha", "Summary"],
              body_excerpt: "Alpha body excerpt.",
            },
            {
              page_id: "beta",
              path: "wiki/concepts/beta.md",
              type: "concept",
              title: "Beta",
              aliases: [],
              tags: [],
              headings: ["Definition"],
              body_excerpt: "Beta content.",
            },
          ],
        },
        "kb_rebuild_index should rebuild a deterministic root-compatible page-index.json"
      );

      const secondSummary = await callRebuildIndex(client, { allow_partial: true });
      const secondIndexText = fs.readFileSync(indexPath, "utf8");
      const secondSearchIndexText = fs.readFileSync(searchIndexPath, "utf8");
      assertDeepEqual(secondSummary, firstSummary, "Repeated rebuilds should return the same summary");
      assert(
        secondIndexText === firstIndexText,
        "Repeated rebuilds against the same wiki tree should write identical page-index.json content"
      );
      assert(
        secondSearchIndexText === firstSearchIndexText,
        "Repeated rebuilds against the same wiki tree should write identical search-index.json content"
      );

      const persistedIndex = readIndex(kbRoot);
      assert(
        persistedIndex.pages.every((page) => page.path.endsWith(".md")),
        "Persisted page-index.json should only contain markdown pages"
      );
      assert(
        persistedIndex.pages.every((page) => page.path !== "wiki/concepts/no-index.txt"),
        "Non-markdown files must be ignored during rebuild"
      );
      const persistedSearchIndex = readSearchIndex(kbRoot);
      assert(persistedSearchIndex.version === 1, "Persisted search-index.json should use version 1");
      assert(
        persistedSearchIndex.chunks.every((chunk) => chunk.path.endsWith(".md")),
        "Persisted search-index.json should only include markdown page chunks"
      );
      assert(
        persistedSearchIndex.chunks.some((chunk) => chunk.page_id === "alpha" && chunk.heading_path.includes("Summary")),
        "Persisted search-index.json should include full-body heading chunks"
      );
    });

    const duplicateRoot = createTempKbRoot();
    try {
      writeWikiFile(
        duplicateRoot.kbRoot,
        "wiki/entities/dup-a.md",
        [
          "---",
          "id: duplicate_id",
          "type: entity",
          "title: Duplicate A",
          "updated_at: 2026-04-20",
          "status: active",
          "---",
          "",
          "Entity A.",
        ].join("\n")
      );
      writeWikiFile(
        duplicateRoot.kbRoot,
        "wiki/concepts/dup-b.md",
        [
          "---",
          "id: duplicate_id",
          "type: concept",
          "title: Duplicate B",
          "updated_at: 2026-04-20",
          "status: active",
          "---",
          "",
          "Concept B.",
        ].join("\n")
      );

      await withMcpClient(duplicateRoot.kbRoot, async (client) => {
        const errorText = await expectRebuildIndexFailure(client);
        assert(
          errorText === "Error: Duplicate page_id values found during rebuild: duplicate_id",
          "kb_rebuild_index should fail deterministically on duplicate page_id values"
        );

        const duplicateIndexPath = path.join(
          duplicateRoot.kbRoot,
          "state",
          "cache",
          "page-index.json"
        );
        assert(
          !fs.existsSync(duplicateIndexPath),
          "kb_rebuild_index must not write an ambiguous page-index.json when duplicate page_id values exist"
        );
      });
    } finally {
      fs.rmSync(duplicateRoot.tempRoot, { recursive: true, force: true });
    }

    console.log("PASS: kb_rebuild_index validation passed.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(message);
  process.exit(1);
});
