import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
  fs.mkdirSync(path.join(kbRoot, "wiki"), { recursive: true });
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
  const client = new Client({ name: "kb-run-lint-validation", version: "0.1.0" });
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

function writeCacheFile(kbRoot: string, payload: unknown): void {
  const absolutePath = path.join(kbRoot, "state", "cache", "page-index.json");
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(payload, null, 2), "utf8");
}

function collectFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const entries: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop() as string;
    const dirEntries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of dirEntries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        entries.push(absolutePath);
      }
    }
  }

  return entries.sort((left, right) => left.localeCompare(right));
}

function snapshotPaths(basePath: string, relativePaths: string[]): FilesystemSnapshot {
  const entries: Record<string, string> = {};

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(basePath, relativePath);
    if (!fs.existsSync(absolutePath)) {
      entries[relativePath] = "__MISSING__";
      continue;
    }

    if (!fs.statSync(absolutePath).isFile()) {
      entries[relativePath] = "__NON_FILE__";
      continue;
    }

    entries[relativePath] = fs.readFileSync(absolutePath, "utf8");
  }

  return { entries };
}

function snapshotKbTree(kbRoot: string): FilesystemSnapshot {
  const relativePaths = collectFiles(kbRoot).map((absolutePath) =>
    path.relative(kbRoot, absolutePath).replace(/\\/g, "/")
  );

  return snapshotPaths(kbRoot, relativePaths);
}

function assertSnapshotUnchanged(
  beforeSnapshot: FilesystemSnapshot,
  afterSnapshot: FilesystemSnapshot,
  message: string
): void {
  assertDeepEqual(afterSnapshot, beforeSnapshot, message);
}

async function callRunLint(
  client: Client,
  args: { include_semantic?: boolean } = {}
): Promise<KbLintReport> {
  const result = await client.callTool({
    name: "kb_run_lint",
    arguments: args,
  });

  assert(!result.isError, "kb_run_lint should succeed");
  assert(Array.isArray(result.content) && result.content.length === 1, "Expected a single text result");
  const payload = result.content[0];
  assert(payload.type === "text", "Expected text tool payload");
  return JSON.parse(payload.text) as KbLintReport;
}

async function callRebuildIndex(client: Client): Promise<void> {
  const result = await client.callTool({
    name: "kb_rebuild_index",
    arguments: {},
  });
  assert(!result.isError, "kb_rebuild_index should succeed during lint validation setup");
}

function assertIssueRules(
  issues: KbLintIssue[],
  expectedRules: string[],
  message: string
): void {
  const actualRules = issues.map((issue) => issue.rule).sort((left, right) => left.localeCompare(right));
  const missingRules = expectedRules.filter((rule) => !actualRules.includes(rule));
  assert(
    missingRules.length === 0,
    `${message}\nMissing rules: ${missingRules.join(", ")}\nActual rules: ${actualRules.join(", ")}`
  );
}

function assertIssueShape(
  issue: KbLintIssue,
  issuePath: string
): void {
  const keys = Object.keys(issue).sort((left, right) => left.localeCompare(right));
  const hasPage = Object.prototype.hasOwnProperty.call(issue, "page");
  assertDeepEqual(
    keys,
    hasPage ? ["detail", "page", "rule", "severity"] : ["detail", "rule", "severity"],
    `${issuePath} should contain only the expected fields`
  );
  assert(
    issue.severity === "error" || issue.severity === "warning",
    `${issuePath}.severity should be "error" or "warning"`
  );
  assert(typeof issue.rule === "string" && issue.rule.length > 0, `${issuePath}.rule should be a non-empty string`);
  assert(
    typeof issue.detail === "string" && issue.detail.length > 0,
    `${issuePath}.detail should be a non-empty string`
  );
  if (hasPage) {
    assert(typeof issue.page === "string" && issue.page.length > 0, `${issuePath}.page should be a non-empty string when present`);
  }
}

function assertMachineReadableShape(report: KbLintReport, expectedSemanticEnabled: boolean): void {
  assert(typeof report.ok === "boolean", "report.ok should be boolean");
  assert(typeof report.generated_at === "string" && report.generated_at.length > 0, "report.generated_at should be a non-empty string");
  assert(typeof report.total_pages === "number", "report.total_pages should be a number");
  assertDeepEqual(
    Object.keys(report).sort((left, right) => left.localeCompare(right)),
    ["cache", "deterministic", "generated_at", "ok", "semantic", "total_pages"],
    "kb_run_lint report top-level shape should stay stable"
  );
  assert(typeof report.cache.path === "string", "report.cache.path should be a string");
  assert(typeof report.cache.exists === "boolean", "report.cache.exists should be a boolean");
  assert(typeof report.cache.stale === "boolean", "report.cache.stale should be a boolean");
  assert(typeof report.cache.drift === "boolean", "report.cache.drift should be a boolean");
  assert(typeof report.deterministic.errors === "number", "report.deterministic.errors should be a number");
  assert(typeof report.deterministic.warnings === "number", "report.deterministic.warnings should be a number");
  assert(Array.isArray(report.deterministic.issues), "report.deterministic.issues should be an array");
  assert(report.semantic.enabled === expectedSemanticEnabled, "report.semantic.enabled should match the include_semantic mode");
  assert(typeof report.semantic.warnings === "number", "report.semantic.warnings should be a number");
  assert(Array.isArray(report.semantic.issues), "report.semantic.issues should be an array");

  for (const [index, issue] of report.deterministic.issues.entries()) {
    assertIssueShape(issue, `report.deterministic.issues[${index}]`);
  }

  for (const [index, issue] of report.semantic.issues.entries()) {
    assertIssueShape(issue, `report.semantic.issues[${index}]`);
    assert(
      issue.severity === "warning",
      `report.semantic.issues[${index}] should only contain warning severity issues`
    );
  }

  const deterministicErrorCount = report.deterministic.issues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const deterministicWarningCount = report.deterministic.issues.filter(
    (issue) => issue.severity === "warning"
  ).length;
  assert(
    report.deterministic.errors === deterministicErrorCount,
    "report.deterministic.errors should equal the number of error-severity deterministic issues"
  );
  assert(
    report.deterministic.warnings === deterministicWarningCount,
    "report.deterministic.warnings should equal the number of warning-severity deterministic issues"
  );
  assert(
    report.semantic.warnings === report.semantic.issues.length,
    "report.semantic.warnings should equal the number of semantic issues"
  );
  assert(
    report.ok === (report.deterministic.errors === 0),
    "report.ok should be true if and only if deterministic.errors is zero"
  );
  if (!expectedSemanticEnabled) {
    assert(
      report.semantic.issues.length === 0,
      "semantic issues should be empty when semantic checks are disabled"
    );
  }
}

async function testDeterministicLintReport(): Promise<void> {
  const { tempRoot, kbRoot } = createTempKbRoot("kb-run-lint-deterministic-");

  try {
    writeWikiFile(
      kbRoot,
      "wiki/index.md",
      [
        "---",
        "id: kb_index",
        "type: index",
        "title: Knowledge Base Index",
        "updated_at: 2026-04-20",
        "status: active",
        "---",
        "",
        "# Knowledge Base Index",
      ].join("\n")
    );
    writeWikiFile(
      kbRoot,
      "wiki/entities/dup-a.md",
      [
        "---",
        "id: dup",
        "type: entity",
        "title: Duplicate A",
        "updated_at: 2026-04-20",
        "status: active",
        "related: [dup]",
        "---",
        "",
        "# Duplicate A",
        "",
        "Broken body [[ghost-page]].",
      ].join("\n")
    );
    writeWikiFile(
      kbRoot,
      "wiki/concepts/dup-b.md",
      [
        "---",
        "id: dup",
        "type: concept",
        "title: Duplicate B",
        "updated_at: 2026-04-20",
        "status: active",
        "related: [dup]",
        "---",
        "",
        "# Duplicate B",
      ].join("\n")
    );
    writeWikiFile(
      kbRoot,
      "wiki/reports/invalid.md",
      [
        "---",
        "id: invalid_report",
        "type: report",
        "title: Invalid Report",
        "updated_at: 2026-04-20",
        "---",
        "",
        "# Invalid",
      ].join("\n")
    );
    writeCacheFile(kbRoot, {
      pages: [
        {
          page_id: "dup",
          path: "wiki/entities/not-the-real-file.md",
          type: "entity",
          title: "Duplicate A",
          aliases: [],
          tags: [],
          headings: ["Wrong"],
          body_excerpt: "Wrong excerpt.",
        },
      ],
    });

    await withMcpClient(kbRoot, async (client) => {
      const toolsResult = await client.listTools();
      const lintTool = toolsResult.tools.find((tool) => tool.name === "kb_run_lint");
      assert(lintTool !== undefined, "Expected kb_run_lint to be exposed by default");
      assertDeepEqual(
        lintTool,
        {
          name: "kb_run_lint",
          description:
            "Run deterministic and semantic lint checks for the KB. Deterministic checks are strict and semantic checks are advisory.",
          inputSchema: {
            type: "object",
            properties: {
              include_semantic: {
                type: "boolean",
                description: "Include semantic advisory checks in the report. Default: true.",
              },
            },
          },
        },
        "kb_run_lint should expose the expected MCP schema"
      );

      const beforeLintSnapshot = snapshotKbTree(kbRoot);
      const report = await callRunLint(client, { include_semantic: false });
      const afterLintSnapshot = snapshotKbTree(kbRoot);

      assertSnapshotUnchanged(
        beforeLintSnapshot,
        afterLintSnapshot,
        "kb_run_lint should not mutate any files under kb/ in deterministic mode"
      );
      assertMachineReadableShape(report, false);
      assert(report.ok === false, "Deterministic lint failures should set ok=false");
      assert(report.cache.exists === true, "Lint should report cache existence");
      assert(report.cache.stale === true, "Lint should report stale cache");
      assert(report.deterministic.errors >= 4, "Expected multiple deterministic errors");
      assertIssueRules(
        report.deterministic.issues,
        [
          "broken-wikilink",
          "cache-drift",
          "cache-stale",
          "duplicate-page-id",
          "invalid-frontmatter",
          "missing-meta-page",
        ],
        "Deterministic lint report should contain the expected rules"
      );
      assert(
        report.semantic.warnings === 0 && report.semantic.issues.length === 0,
        "include_semantic=false should suppress semantic findings"
      );
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testSemanticLintSeparation(): Promise<void> {
  const { tempRoot, kbRoot } = createTempKbRoot("kb-run-lint-semantic-");

  try {
    writeWikiFile(
      kbRoot,
      "wiki/index.md",
      [
        "---",
        "id: kb_index",
        "type: index",
        "title: Knowledge Base Index",
        "updated_at: 2026-04-20",
        "status: active",
        "---",
        "",
        "# Knowledge Base Index",
      ].join("\n")
    );
    writeWikiFile(
      kbRoot,
      "wiki/log.md",
      [
        "---",
        "id: kb_log",
        "type: index",
        "title: Knowledge Base Log",
        "updated_at: 2026-04-20",
        "status: active",
        "---",
        "",
        "# Knowledge Base Log",
      ].join("\n")
    );
    writeWikiFile(
      kbRoot,
      "wiki/sources/source-a.md",
      [
        "---",
        "id: source_a",
        "type: source",
        "title: Source A",
        "updated_at: 2024-01-01",
        "status: active",
        "---",
        "",
        "# Source A",
        "",
        "Source notes.",
      ].join("\n")
    );
    writeWikiFile(
      kbRoot,
      "wiki/analyses/analysis-a.md",
      [
        "---",
        "id: analysis_a",
        "type: analysis",
        "title: Analysis A",
        "updated_at: 2026-04-20",
        "status: active",
        "---",
        "",
        "# Analysis A",
        "",
        "## Summary",
        "",
        "Findings without uncertainty tracking.",
      ].join("\n")
    );

    await withMcpClient(kbRoot, async (client) => {
      await callRebuildIndex(client);
      const beforeLintSnapshot = snapshotKbTree(kbRoot);
      const report = await callRunLint(client);
      const afterLintSnapshot = snapshotKbTree(kbRoot);

      assertSnapshotUnchanged(
        beforeLintSnapshot,
        afterLintSnapshot,
        "kb_run_lint should not mutate any files under kb/ in semantic mode"
      );

      assertMachineReadableShape(report, true);
      assert(report.deterministic.errors === 0, "Semantic-only scenario should have zero deterministic errors");
      assert(report.cache.exists === true, "Rebuilt cache should exist before lint");
      assert(report.semantic.warnings >= 4, "Expected semantic warnings in the default lint mode");
      assertIssueRules(
        report.semantic.issues,
        [
          "semantic-missing-concept-entity-pages",
          "semantic-missing-related-links",
          "semantic-missing-uncertainties",
          "semantic-stale-page",
        ],
        "Semantic findings should be separated from deterministic findings"
      );
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await testDeterministicLintReport();
  await testSemanticLintSeparation();
  console.log("PASS: kb_run_lint validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
