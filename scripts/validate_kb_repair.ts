import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { PageIndex } from "../src/types";

interface KbLintIssue {
  severity: "error" | "warning";
  rule: string;
  detail: string;
  page?: string;
}

interface KbLintReport {
  ok: boolean;
  generated_at: string;
  total_pages: number;
  cache: {
    path: string;
    exists: boolean;
    stale: boolean;
    drift: boolean;
  };
  deterministic: {
    errors: number;
    warnings: number;
    issues: KbLintIssue[];
  };
  semantic: {
    enabled: boolean;
    warnings: number;
    issues: KbLintIssue[];
  };
}

interface KbRepairFix {
  rule: "missing-meta-page" | "invalid-meta-page" | "rebuild-page-index";
  path: string;
  action: "create" | "rewrite" | "rebuild";
  applied: boolean;
  detail: string;
}

interface KbRepairResult {
  dry_run: boolean;
  applied_fixes: KbRepairFix[];
  lint: KbLintReport;
}

interface FilesystemSnapshot {
  entries: Record<string, string>;
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

function createTempKbRoot(prefix: string): { tempRoot: string; kbRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const kbRoot = path.join(tempRoot, "kb");
  fs.mkdirSync(path.join(kbRoot, "wiki", "concepts"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "state", "cache"), { recursive: true });
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
  const client = new Client({ name: "kb-repair-validation", version: "0.1.0" });
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

function writeFile(kbRoot: string, relativePath: string, content: string): void {
  const absolutePath = path.join(kbRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function readFileIfExists(kbRoot: string, relativePath: string): string | null {
  const absolutePath = path.join(kbRoot, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : null;
}

function readPageIndex(kbRoot: string): PageIndex {
  return JSON.parse(
    fs.readFileSync(path.join(kbRoot, "state", "cache", "page-index.json"), "utf8")
  ) as PageIndex;
}

function collectFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const collected: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop() as string;
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        collected.push(absolutePath);
      }
    }
  }

  return collected.sort((left, right) => left.localeCompare(right));
}

function snapshotKbTree(kbRoot: string): FilesystemSnapshot {
  const entries: Record<string, string> = {};

  for (const absolutePath of collectFiles(kbRoot)) {
    const relativePath = path.relative(kbRoot, absolutePath).replace(/\\/g, "/");
    entries[relativePath] = fs.readFileSync(absolutePath, "utf8");
  }

  return { entries };
}

function changedPaths(beforeSnapshot: FilesystemSnapshot, afterSnapshot: FilesystemSnapshot): string[] {
  const paths = Array.from(
    new Set([
      ...Object.keys(beforeSnapshot.entries),
      ...Object.keys(afterSnapshot.entries),
    ])
  ).sort((left, right) => left.localeCompare(right));

  return paths.filter(
    (relativePath) => beforeSnapshot.entries[relativePath] !== afterSnapshot.entries[relativePath]
  );
}

async function callRepair(
  client: Client,
  args: { dry_run?: boolean } = {}
): Promise<KbRepairResult> {
  const result = await client.callTool({
    name: "kb_repair",
    arguments: args,
  });

  assert(!result.isError, "kb_repair should succeed");
  assert(Array.isArray(result.content) && result.content.length === 1, "Expected a single text result");
  const payload = result.content[0];
  assert(payload.type === "text", "Expected text tool payload");
  return JSON.parse(payload.text) as KbRepairResult;
}

function writeConceptPage(kbRoot: string): string {
  const content = [
    "---",
    "id: alpha_concept",
    "type: concept",
    "title: Alpha Concept",
    "updated_at: 2026-04-20",
    "status: active",
    "tags: [core]",
    "related: [wiki_index]",
    "---",
    "",
    "# Alpha Concept",
    "",
    "## Summary",
    "",
    "Alpha concept body.",
  ].join("\n");
  writeFile(kbRoot, "wiki/concepts/alpha.md", content);
  return content;
}

async function testDryRunDoesNotMutate(): Promise<void> {
  const { tempRoot, kbRoot } = createTempKbRoot("kb-repair-dry-run-");

  try {
    const originalConcept = writeConceptPage(kbRoot);
    writeFile(
      kbRoot,
      "state/cache/page-index.json",
      JSON.stringify(
        {
          pages: [
            {
              page_id: "stale",
              path: "wiki/concepts/stale.md",
              type: "concept",
              title: "Stale",
              aliases: [],
              tags: [],
              headings: [],
              body_excerpt: "",
            },
          ],
        },
        null,
        2
      )
    );

    const beforeSnapshot = snapshotKbTree(kbRoot);

    await withMcpClient(kbRoot, async (client) => {
      const toolsResult = await client.listTools();
      const repairTool = toolsResult.tools.find((tool) => tool.name === "kb_repair");
      assert(repairTool !== undefined, "Expected kb_repair to be exposed by default");
      assertDeepEqual(
        repairTool,
        {
          name: "kb_repair",
          description:
            "Repair structural KB artifacts only: restore missing or malformed meta pages and rebuild page-index.json. Does not modify content pages.",
          inputSchema: {
            type: "object",
            properties: {
              dry_run: {
                type: "boolean",
                description: "If true, report intended structural fixes without mutating kb/.",
              },
            },
          },
        },
        "kb_repair should expose the expected MCP schema"
      );

      const repairResult = await callRepair(client, { dry_run: true });
      assert(repairResult.dry_run === true, "dry_run=true should be echoed in the response");
      assert(repairResult.applied_fixes.length === 3, "Dry run should plan both meta pages and index rebuild");
      assertDeepEqual(
        repairResult.applied_fixes.map((fix) => ({
          rule: fix.rule,
          path: fix.path,
          action: fix.action,
          applied: fix.applied,
        })),
        [
          {
            rule: "missing-meta-page",
            path: "kb/wiki/index.md",
            action: "create",
            applied: false,
          },
          {
            rule: "missing-meta-page",
            path: "kb/wiki/log.md",
            action: "create",
            applied: false,
          },
          {
            rule: "rebuild-page-index",
            path: "kb/state/cache/page-index.json",
            action: "rebuild",
            applied: false,
          },
        ],
        "Dry run should report the intended structural fixes without applying them"
      );
      assert(
        repairResult.lint.deterministic.errors >= 2,
        "Dry run lint should still reflect the missing structural artifacts"
      );
    });

    const afterSnapshot = snapshotKbTree(kbRoot);
    assertDeepEqual(afterSnapshot, beforeSnapshot, "Dry run must not mutate any kb/ files");
    assert(
      readFileIfExists(kbRoot, "wiki/concepts/alpha.md") === originalConcept,
      "Dry run must not modify page-content files"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testApplyRepairsOnlyStructuralArtifacts(): Promise<void> {
  const { tempRoot, kbRoot } = createTempKbRoot("kb-repair-apply-");

  try {
    const originalConcept = writeConceptPage(kbRoot);
    writeFile(
      kbRoot,
      "state/cache/page-index.json",
      JSON.stringify(
        {
          pages: [
            {
              page_id: "legacy",
              path: "wiki/concepts/legacy.md",
              type: "concept",
              title: "Legacy",
              aliases: [],
              tags: [],
              headings: [],
              body_excerpt: "",
            },
          ],
        },
        null,
        2
      )
    );

    const beforeSnapshot = snapshotKbTree(kbRoot);

    await withMcpClient(kbRoot, async (client) => {
      const repairResult = await callRepair(client);
      assert(repairResult.dry_run === false, "Default kb_repair mode should apply fixes");
      assert(repairResult.applied_fixes.every((fix) => fix.applied), "Apply mode should mark fixes as applied");
      assert(
        repairResult.lint.deterministic.errors === 0,
        "Apply mode should clear deterministic structural lint errors"
      );
      assert(repairResult.lint.cache.exists, "Apply mode should leave a rebuilt page index behind");
      assert(!repairResult.lint.cache.stale, "Apply mode should leave a non-stale page index");
    });

    const afterSnapshot = snapshotKbTree(kbRoot);
    const diffPaths = changedPaths(beforeSnapshot, afterSnapshot);
    assertDeepEqual(
      diffPaths,
      ["state/cache/page-index.json", "wiki/index.md", "wiki/log.md"],
      "Apply mode should only modify the allowed structural artifact paths"
    );

    assert(
      readFileIfExists(kbRoot, "wiki/concepts/alpha.md") === originalConcept,
      "Apply mode must not modify existing page-content files"
    );

    const indexContent = readFileIfExists(kbRoot, "wiki/index.md");
    const logContent = readFileIfExists(kbRoot, "wiki/log.md");
    assert(indexContent !== null && indexContent.includes("id: wiki_index"), "Repair should create wiki/index.md");
    assert(logContent !== null && logContent.includes("id: wiki_log"), "Repair should create wiki/log.md");

    const pageIndex = readPageIndex(kbRoot);
    assertDeepEqual(
      pageIndex,
      {
        pages: [
          {
            page_id: "alpha_concept",
            path: "wiki/concepts/alpha.md",
            type: "concept",
            title: "Alpha Concept",
            aliases: [],
            tags: ["core"],
            headings: ["Alpha Concept", "Summary"],
            body_excerpt: "Alpha concept body.",
          },
          {
            page_id: "wiki_index",
            path: "wiki/index.md",
            type: "index",
            title: "Knowledge Base Index",
            aliases: [],
            tags: [],
            headings: ["Knowledge Base Index", "Navigation", "Sources", "Concepts", "Entities", "Analyses"],
            body_excerpt: "- [[wikilog|Change Log]] — ingest and edit history <!-- dedup:indexnavwikilog -->",
          },
          {
            page_id: "wiki_log",
            path: "wiki/log.md",
            type: "index",
            title: "Change Log",
            aliases: [],
            tags: [],
            headings: ["Change Log", "Recent"],
            body_excerpt: "",
          },
        ],
      },
      "Repair should rebuild page-index.json from the structural files plus existing page content"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await testDryRunDoesNotMutate();
  await testApplyRepairsOnlyStructuralArtifacts();
  process.stdout.write("PASS: kb_repair validation passed.\n");
}

main().catch((error) => {
  process.stderr.write(`FAIL: ${(error as Error).message}\n`);
  process.exit(1);
});
