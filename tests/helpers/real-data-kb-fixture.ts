import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface CleanKbFixture {
  workspaceRoot: string;
  kbRoot: string;
  cleanup(): void;
}

const WIKI_UPDATED_AT = "2026-05-07";

function validateFixturePrefix(prefix: string): string {
  if (
    prefix.length === 0 ||
    prefix === "." ||
    prefix === ".." ||
    prefix.includes("/") ||
    prefix.includes("\\") ||
    path.basename(prefix) !== prefix
  ) {
    throw new Error(
      "Clean KB fixture prefix must be a non-empty basename without path separators"
    );
  }

  return prefix;
}

function compareByCodePoint(a: string, b: string): number {
  const aCodePoints = Array.from(a);
  const bCodePoints = Array.from(b);
  const length = Math.min(aCodePoints.length, bCodePoints.length);

  for (let index = 0; index < length; index += 1) {
    const aCodePoint = aCodePoints[index]?.codePointAt(0) ?? 0;
    const bCodePoint = bCodePoints[index]?.codePointAt(0) ?? 0;

    if (aCodePoint !== bCodePoint) {
      return aCodePoint - bCodePoint;
    }
  }

  return aCodePoints.length - bCodePoints.length;
}

export function createCleanKbFixture(prefix = "kb-real-data-e2e-"): CleanKbFixture {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), validateFixturePrefix(prefix)));
  const kbRoot = path.join(workspaceRoot, "kb");

  for (const relativeDir of [
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
    fs.mkdirSync(path.join(kbRoot, relativeDir), { recursive: true });
  }

  fs.writeFileSync(path.join(kbRoot, "schema", "version.yaml"), "version: 1\n", "utf8");
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "index.md"),
    `---
id: wiki_index
type: index
title: Knowledge Base Index
updated_at: ${WIKI_UPDATED_AT}
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
updated_at: ${WIKI_UPDATED_AT}
status: active
---

# Change Log
`,
    "utf8"
  );

  return {
    workspaceRoot,
    kbRoot,
    cleanup(): void {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    },
  };
}

export function listMarkdownSources(repoRoot: string): string[] {
  const markdownRoot = path.resolve(repoRoot, "tests", "test-source", "markdown");

  return fs
    .readdirSync(markdownRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name) === ".md")
    .map((entry) => entry.name)
    .sort(compareByCodePoint)
    .map((fileName) => path.join(markdownRoot, fileName));
}

export function listUrlSources(repoRoot: string): string[] {
  const urlSourcePath = path.resolve(repoRoot, "tests", "test-source", "url.txt");

  return fs
    .readFileSync(urlSourcePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
