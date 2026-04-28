import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { rebuildPageIndex, repairKb, runKbLint } from "../src/core/wiki-maintenance";
import { ensureWikiEntry } from "../src/core/wiki-log";

function makeWorkspace(prefix: string): string {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(kbRoot, "wiki", "concepts"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "state", "cache"), { recursive: true });
  return kbRoot;
}

function writeFile(kbRoot: string, relativePath: string, content: string): void {
  const absolutePath = path.join(kbRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

const VALID_INDEX = `---
id: wiki_index
type: index
title: Knowledge Base Index
updated_at: 2026-04-28
status: active
---

# Knowledge Base Index

## Navigation
`;

const VALID_LOG = `---
id: wiki_log
type: index
title: Change Log
updated_at: 2026-04-28
status: active
---

# Change Log

## Recent
`;

const VALID_CONCEPT = `---
id: alpha_concept
type: concept
title: Alpha Concept
updated_at: 2026-04-28
status: active
related: [wiki_index]
---

# Alpha Concept
`;

test("repairKb non-force skips malformed meta rewrite and does not rebuild page-index", () => {
  const kbRoot = makeWorkspace("kb-repair-non-force-");
  const malformedLog = `---
id: wiki_log
type: index
title: "Broken
updated_at: 2026-04-28
status: active
---

# Broken Log
`;

  writeFile(kbRoot, "wiki/index.md", VALID_INDEX);
  writeFile(kbRoot, "wiki/log.md", malformedLog);
  writeFile(kbRoot, "wiki/concepts/alpha.md", VALID_CONCEPT);

  const result = repairKb({ kb_root: kbRoot }, {});

  const rewriteFix = result.applied_fixes.find(
    (fix) => fix.rule === "invalid-meta-page" && fix.path === "kb/wiki/log.md"
  );
  const rebuildFix = result.applied_fixes.find(
    (fix) => fix.rule === "rebuild-page-index"
  );

  assert.equal(result.force, false);
  assert.equal(rewriteFix?.applied, false);
  assert.equal(rewriteFix?.action, "rewrite");
  assert.equal(rebuildFix?.applied, false);
  assert.match(rebuildFix?.detail ?? "", /force: true/u);
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki/log.md"), "utf8"), malformedLog);
  assert.equal(fs.existsSync(path.join(kbRoot, "state", "cache", "page-index.json")), false);
});

test("repairKb non-force rewrites structural page when only id/type drifted", () => {
  const kbRoot = makeWorkspace("kb-repair-non-malformed-rewrite-");

  writeFile(kbRoot, "wiki/index.md", VALID_INDEX);
  writeFile(
    kbRoot,
    "wiki/log.md",
    `---
id: not_wiki_log
type: report
title: Change Log
updated_at: 2026-04-28
status: active
---

# Change Log
`
  );
  writeFile(kbRoot, "wiki/concepts/alpha.md", VALID_CONCEPT);

  const result = repairKb({ kb_root: kbRoot }, {});

  const rewriteFix = result.applied_fixes.find(
    (fix) => fix.rule === "invalid-meta-page" && fix.path === "kb/wiki/log.md"
  );
  const rebuildFix = result.applied_fixes.find(
    (fix) => fix.rule === "rebuild-page-index"
  );

  assert.equal(result.force, false);
  assert.equal(rewriteFix?.applied, true);
  assert.equal(rewriteFix?.action, "rewrite");
  assert.equal(rebuildFix?.applied, true);
  assert.match(fs.readFileSync(path.join(kbRoot, "wiki/log.md"), "utf8"), /id: wiki_log/u);
  assert.equal(fs.existsSync(path.join(kbRoot, "state", "cache", "page-index.json")), true);
});

test("repairKb force=true rewrites malformed meta page and rebuilds page-index", () => {
  const kbRoot = makeWorkspace("kb-repair-force-");

  writeFile(kbRoot, "wiki/index.md", VALID_INDEX);
  writeFile(
    kbRoot,
    "wiki/log.md",
    `---
id: wiki_log
type: index
title: "Broken
updated_at: 2026-04-28
status: active
---

# Broken Log
`
  );
  writeFile(kbRoot, "wiki/concepts/alpha.md", VALID_CONCEPT);

  const result = repairKb({ kb_root: kbRoot }, { force: true });

  const rewriteFix = result.applied_fixes.find(
    (fix) => fix.rule === "invalid-meta-page" && fix.path === "kb/wiki/log.md"
  );
  const rebuildFix = result.applied_fixes.find(
    (fix) => fix.rule === "rebuild-page-index"
  );

  assert.equal(result.force, true);
  assert.equal(rewriteFix?.applied, true);
  assert.equal(rebuildFix?.applied, true);
  assert.match(fs.readFileSync(path.join(kbRoot, "wiki/log.md"), "utf8"), /id: wiki_log/u);
  assert.equal(fs.existsSync(path.join(kbRoot, "state", "cache", "page-index.json")), true);
});

test("ensureWikiEntry validates frontmatter even when bump_updated_at is false", () => {
  const kbRoot = makeWorkspace("kb-ensure-entry-");

  writeFile(
    kbRoot,
    "wiki/log.md",
    `---
id: wiki_log
type: index
title: Change Log
updated_at: 2026-04-28
---

# Change Log

## Recent
`
  );

  assert.throws(
    () =>
      ensureWikiEntry(
        {
          path: "wiki/log.md",
          entry: "- change",
          anchor: "## Recent",
          dedup_key: "test-entry",
          bump_updated_at: false,
        },
        { kb_root: kbRoot }
      ),
    /Frontmatter validation failed before entry insert/u
  );

  const updated = fs.readFileSync(path.join(kbRoot, "wiki/log.md"), "utf8");
  assert.doesNotMatch(updated, /dedup:test-entry/u);
});

test("runKbLint reports invalid manifest canonical_path instead of throwing", () => {
  const kbRoot = makeWorkspace("kb-lint-invalid-canonical-path-");
  const sourceId = "src_sha256_badpath";

  writeFile(kbRoot, "wiki/index.md", VALID_INDEX);
  writeFile(kbRoot, "wiki/log.md", VALID_LOG);
  writeFile(
    kbRoot,
    "wiki/sources/src_sha256_badpath.md",
    `---
id: ${sourceId}
type: source
title: Bad Manifest Source
updated_at: 2026-04-28
status: active
---

# Bad Manifest Source
`
  );
  writeFile(
    kbRoot,
    `state/manifests/${sourceId}.json`,
    JSON.stringify(
      {
        source_id: sourceId,
        canonical_path: "../escape.md",
      },
      null,
      2
    )
  );

  rebuildPageIndex({ kb_root: kbRoot }, { allow_partial: true });
  const report = runKbLint({ kb_root: kbRoot }, { include_semantic: false });
  const issue = report.deterministic.issues.find(
    (candidate) =>
      candidate.rule === "source-manifest-malformed" &&
      candidate.page === "wiki/sources/src_sha256_badpath.md"
  );

  assert.equal(report.deterministic.errors, 1);
  assert.match(issue?.detail ?? "", /invalid canonical_path/u);
});

test("runKbLint resolves path-like wikilink target to wiki relative path", () => {
  const kbRoot = makeWorkspace("kb-lint-path-like-");

  writeFile(
    kbRoot,
    "wiki/index.md",
    `---
id: wiki_index
type: index
title: Knowledge Base Index
updated_at: 2026-04-28
status: active
---

# Knowledge Base Index

## Reports
- [[reports/index]]
`
  );
  writeFile(
    kbRoot,
    "wiki/log.md",
    `---
id: wiki_log
type: index
title: Change Log
updated_at: 2026-04-28
status: active
---

# Change Log

## Recent
`
  );
  writeFile(
    kbRoot,
    "wiki/reports/index.md",
    `---
id: reports_index
type: index
title: Reports Index
updated_at: 2026-04-28
status: active
---

# Reports Index
`
  );

  rebuildPageIndex({ kb_root: kbRoot });
  const report = runKbLint({ kb_root: kbRoot }, { include_semantic: false });

  const brokenLinks = report.deterministic.issues.filter(
    (issue) => issue.rule === "broken-wikilink"
  );
  assert.equal(brokenLinks.length, 0);
  assert.equal(report.deterministic.errors, 0);
});
