import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appendWikiLogEntry, ensureWikiEntry } from "../src/core/wiki-log";

function makeWorkspace(prefix = "kb-wiki-log-"): string {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(kbRoot, "wiki"), { recursive: true });
  return kbRoot;
}

function writeLog(kbRoot: string): void {
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "log.md"),
    `---
id: wiki_log
type: index
title: Change Log
updated_at: 2026-04-28
status: active
---

# Change Log

## Recent
`,
    "utf8"
  );
}

function writeIndex(kbRoot: string): void {
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "index.md"),
    `---
id: wiki_index
type: index
title: Knowledge Base Index
updated_at: 2026-04-28
status: active
---

# Knowledge Base Index

## Sources
`,
    "utf8"
  );
}

function writeConceptPage(
  kbRoot: string,
  pageId: string,
  title: string,
  sourceIds: string[] = []
): void {
  const pagePath = path.join(kbRoot, "wiki", "concepts", `${pageId}.md`);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  const sourceIdsLine = sourceIds.length > 0 ? `source_ids: [${sourceIds.join(", ")}]\n` : "";
  fs.writeFileSync(
    pagePath,
    `---
id: ${pageId}
type: concept
title: ${title}
updated_at: 2026-04-28
status: active
${sourceIdsLine}---

# ${title}
`,
    "utf8"
  );
}

function writeConceptPageAtPath(
  kbRoot: string,
  relativeWikiPath: string,
  pageId: string,
  title: string
): void {
  const pagePath = path.join(kbRoot, relativeWikiPath);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(
    pagePath,
    `---
id: ${pageId}
type: concept
title: ${title}
updated_at: 2026-04-28
status: active
---

# ${title}
`,
    "utf8"
  );
}

function writeSourceSummaryPage(kbRoot: string, pageId: string, sourceId: string): void {
  const pagePath = path.join(kbRoot, "wiki", "sources", `${pageId}.md`);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(
    pagePath,
    `---
id: ${pageId}
type: source
title: Vibe Coding and Agentic Engineering
updated_at: 2026-04-28
status: active
source_ids: [${sourceId}]
---

# Vibe Coding and Agentic Engineering
`,
    "utf8"
  );
}

function writeSourceManifest(
  kbRoot: string,
  sourceId: string,
  summaryPageId: string
): void {
  const manifestPath = path.join(kbRoot, "state", "manifests", `${sourceId}.json`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        source_id: sourceId,
        ingest_status: "ingested",
        ingest_summary_page_id: summaryPageId,
      },
      null,
      2
    ),
    "utf8"
  );
}

function writePendingSourceManifest(kbRoot: string, sourceId: string): void {
  const manifestPath = path.join(kbRoot, "state", "manifests", `${sourceId}.json`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        source_id: sourceId,
        ingest_status: "registered",
      },
      null,
      2
    ),
    "utf8"
  );
}

test("appendWikiLogEntry writes structured multi-line log blocks idempotently", () => {
  const kbRoot = makeWorkspace();
  writeLog(kbRoot);
  writeConceptPage(kbRoot, "alpha", "Alpha");
  writeConceptPage(kbRoot, "beta", "Beta");

  const first = appendWikiLogEntry(
    {
      kind: "query",
      title: "Alpha comparison",
      summary: "Alpha is better supported than Beta in the current wiki.",
      date: "2026-04-28",
      run_id: "20260428T120000",
      changes: ["created alpha_analysis"],
      references: ["alpha", "[[beta]]"],
      output_page_id: "alpha_analysis",
      output_label: "Alpha Analysis",
      dedup_key: "log_query_alpha_20260428T120000",
    },
    { kb_root: kbRoot }
  );

  assert.equal(first.action, "inserted");
  assert.equal(first.path, "wiki/log.md");
  const afterFirst = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");
  assert.match(afterFirst, /updated_at: 2026-04-28/u);
  assert.match(afterFirst, /## \[2026-04-28\] query \| Alpha comparison/u);
  assert.match(afterFirst, /- run_id: 20260428T120000/u);
  assert.match(afterFirst, /- 结论: Alpha is better supported than Beta/u);
  assert.match(afterFirst, /- 参考: \[\[alpha\]\], \[\[beta\]\]/u);
  assert.match(afterFirst, /<!-- dedup:log_query_alpha_20260428T120000 -->/u);

  const second = appendWikiLogEntry(
    {
      kind: "query",
      title: "Alpha comparison",
      summary: "Alpha is better supported than Beta in the current wiki.",
      date: "2026-04-28",
      dedup_key: "log_query_alpha_20260428T120000",
    },
    { kb_root: kbRoot }
  );

  assert.equal(second.action, "already_exists");
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), afterFirst);
});

test("ensureWikiEntry treats an empty anchor as append-at-end", () => {
  const kbRoot = makeWorkspace("kb-ensure-empty-anchor-");
  writeIndex(kbRoot);

  const result = ensureWikiEntry(
    {
      path: "wiki/index.md",
      entry: "- [[alpha|Alpha]] — first source",
      anchor: "",
      dedup_key: "index_alpha",
      bump_updated_at: false,
    },
    { kb_root: kbRoot }
  );

  const updated = fs.readFileSync(path.join(kbRoot, "wiki", "index.md"), "utf8");
  assert.equal(result.action, "inserted");
  assert.ok(
    updated.indexOf("# Knowledge Base Index") <
      updated.indexOf("- [[alpha|Alpha]] — first source"),
    "empty anchor should not insert before the page heading"
  );
  assert.match(updated, /## Sources\n- \[\[alpha\|Alpha\]\] — first source <!-- dedup:index_alpha -->\n$/u);
});

test("appendWikiLogEntry maps source_id references through source summary pages", () => {
  const kbRoot = makeWorkspace("kb-log-source-ref-");
  const sourceId = "src_sha256_6b4e3609";
  writeLog(kbRoot);
  writeConceptPage(kbRoot, "simon-willison", "Simon Willison");
  writeSourceSummaryPage(
    kbRoot,
    "src-vibe-coding-agentic-engineering",
    sourceId
  );
  writeSourceManifest(kbRoot, sourceId, "src-vibe-coding-agentic-engineering");

  appendWikiLogEntry(
    {
      kind: "ingest",
      title: "Vibe Coding and Agentic Engineering",
      summary: "Registered source and updated related pages.",
      date: "2026-04-28",
      references: [sourceId, "simon-willison"],
      dedup_key: "log_ingest_src_sha256_6b4e3609",
    },
    { kb_root: kbRoot }
  );

  const updated = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");
  assert.match(
    updated,
    /- 参考: \[\[src-vibe-coding-agentic-engineering\|src_sha256_6b4e3609\]\], \[\[simon-willison\]\]/u
  );
});

test("appendWikiLogEntry maps pending source manifests through source summary pages", () => {
  const kbRoot = makeWorkspace("kb-log-pending-source-ref-");
  const sourceId = "src_sha256_6b4e3609";
  writeLog(kbRoot);
  writeSourceSummaryPage(
    kbRoot,
    "src-vibe-coding-agentic-engineering",
    sourceId
  );
  writePendingSourceManifest(kbRoot, sourceId);

  appendWikiLogEntry(
    {
      kind: "ingest",
      title: "Vibe Coding and Agentic Engineering",
      summary: "Registered source before finalize.",
      date: "2026-04-28",
      references: [sourceId],
      dedup_key: "log_ingest_pending_src_sha256_6b4e3609",
    },
    { kb_root: kbRoot }
  );

  const updated = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");
  assert.match(
    updated,
    /- 参考: \[\[src-vibe-coding-agentic-engineering\|src_sha256_6b4e3609\]\]/u
  );
});

test("appendWikiLogEntry prefers source summary pages for source_id references", () => {
  const kbRoot = makeWorkspace("kb-log-source-ref-prefer-source-");
  const sourceId = "src_sha256_6b4e3609";
  writeLog(kbRoot);
  writeConceptPage(kbRoot, "vibe-coding", "Vibe Coding", [sourceId]);
  writeSourceSummaryPage(
    kbRoot,
    "src-vibe-coding-agentic-engineering",
    sourceId
  );
  writeSourceManifest(kbRoot, sourceId, "src-vibe-coding-agentic-engineering");

  appendWikiLogEntry(
    {
      kind: "ingest",
      title: "Vibe Coding and Agentic Engineering",
      summary: "Registered source and updated related pages.",
      date: "2026-04-28",
      references: [sourceId],
      dedup_key: "log_ingest_src_sha256_6b4e3609",
    },
    { kb_root: kbRoot }
  );

  const updated = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");
  assert.match(
    updated,
    /- 参考: \[\[src-vibe-coding-agentic-engineering\|src_sha256_6b4e3609\]\]/u
  );
  assert.doesNotMatch(updated, /\[\[vibe-coding\|src_sha256_6b4e3609\]\]/u);
});

test("appendWikiLogEntry normalizes path-like references to page ids", () => {
  const kbRoot = makeWorkspace("kb-log-path-ref-");
  writeLog(kbRoot);
  writeConceptPageAtPath(
    kbRoot,
    "wiki/concepts/vibe_coding.md",
    "vibe-coding",
    "Vibe Coding"
  );

  appendWikiLogEntry(
    {
      kind: "query",
      title: "Path-like reference",
      summary: "Path-like references are canonicalized.",
      date: "2026-04-28",
      references: ["wiki/concepts/vibe_coding.md"],
      dedup_key: "log_query_path_ref",
    },
    { kb_root: kbRoot }
  );

  const updated = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");
  assert.match(updated, /- 参考: \[\[vibe-coding\]\]/u);
  assert.doesNotMatch(updated, /\[\[wiki\/concepts\/vibe_coding\.md\]\]/u);
});

test("appendWikiLogEntry resolves page ids before title matches", () => {
  const kbRoot = makeWorkspace("kb-log-reference-id-priority-");
  writeLog(kbRoot);
  writeConceptPageAtPath(kbRoot, "wiki/concepts/a.md", "alpha", "beta");
  writeConceptPageAtPath(kbRoot, "wiki/concepts/b.md", "beta", "Actual Beta");

  appendWikiLogEntry(
    {
      kind: "query",
      title: "Reference id priority",
      summary: "Page ids should not be shadowed by titles.",
      date: "2026-04-28",
      references: ["beta"],
      dedup_key: "log_query_reference_id_priority",
    },
    { kb_root: kbRoot }
  );

  const updated = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");
  assert.match(updated, /- 参考: \[\[beta\]\]/u);
  assert.doesNotMatch(updated, /- 参考: \[\[alpha\]\]/u);
});

test("appendWikiLogEntry rejects reference labels that can inject wikilinks", () => {
  const kbRoot = makeWorkspace("kb-log-reference-label-injection-");
  writeLog(kbRoot);
  writeConceptPage(kbRoot, "alpha", "Alpha");
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "query",
          title: "Reference label injection",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: ["alpha|ok]], [[missing"],
          dedup_key: "log_query_reference_label_injection",
        },
        { kb_root: kbRoot }
      ),
    /references\[\] label must not contain wikilink delimiters/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects output labels that can inject wikilinks", () => {
  const kbRoot = makeWorkspace("kb-log-output-label-injection-");
  writeLog(kbRoot);
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "query",
          title: "Output label injection",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          output_page_id: "alpha",
          output_label: "ok]], [[missing",
          dedup_key: "log_query_output_label_injection",
        },
        { kb_root: kbRoot }
      ),
    /output_label must not contain wikilink delimiters/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects output page ids that can inject wikilinks", () => {
  const kbRoot = makeWorkspace("kb-log-output-page-id-injection-");
  writeLog(kbRoot);
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "query",
          title: "Output page id injection",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          output_page_id: "alpha|ok]], [[missing",
          dedup_key: "log_query_output_page_id_injection",
        },
        { kb_root: kbRoot }
      ),
    /output_page_id must not contain wikilink delimiters/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects output page id injection even with a safe label", () => {
  const kbRoot = makeWorkspace("kb-log-output-page-id-safe-label-");
  writeLog(kbRoot);
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "query",
          title: "Output page id injection with safe label",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          output_page_id: "alpha|ok]], [[missing",
          output_label: "Alpha",
          dedup_key: "log_query_output_page_id_safe_label",
        },
        { kb_root: kbRoot }
      ),
    /output_page_id must not contain wikilink delimiters/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry does not treat bare references as file stems", () => {
  const kbRoot = makeWorkspace("kb-log-reference-bare-title-");
  writeLog(kbRoot);
  writeConceptPageAtPath(kbRoot, "wiki/foo.md", "bar", "Bar");
  writeConceptPageAtPath(kbRoot, "wiki/concepts/baz.md", "baz", "foo");

  appendWikiLogEntry(
    {
      kind: "query",
      title: "Bare reference title priority",
      summary: "Bare references should not use file stem matching.",
      date: "2026-04-28",
      references: ["foo"],
      dedup_key: "log_query_bare_reference_title_priority",
    },
    { kb_root: kbRoot }
  );

  const updated = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");
  assert.match(updated, /- 参考: \[\[baz\]\]/u);
  assert.doesNotMatch(updated, /- 参考: \[\[bar\]\]/u);
});

test("appendWikiLogEntry rejects ambiguous title or alias references", () => {
  const kbRoot = makeWorkspace("kb-log-ambiguous-title-ref-");
  writeLog(kbRoot);
  writeConceptPageAtPath(kbRoot, "wiki/concepts/alpha.md", "alpha", "Shared Title");
  writeConceptPageAtPath(kbRoot, "wiki/concepts/beta.md", "beta", "Shared Title");
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "query",
          title: "Ambiguous title reference",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: ["Shared Title"],
          dedup_key: "log_query_ambiguous_title_ref",
        },
        { kb_root: kbRoot }
      ),
    /references\[\] target Shared Title resolves to multiple wiki pages/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects manifest source summary pages for a different source_id", () => {
  const kbRoot = makeWorkspace("kb-log-wrong-manifest-summary-");
  writeLog(kbRoot);
  writeSourceSummaryPage(kbRoot, "source-y", "src_sha256_yyyyyyyy");
  writeSourceManifest(kbRoot, "src_sha256_xxxxxxxx", "source-y");
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "ingest",
          title: "Wrong manifest summary",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: ["src_sha256_xxxxxxxx"],
          dedup_key: "log_ingest_wrong_manifest_summary",
        },
        { kb_root: kbRoot }
      ),
    /does not reference source_id src_sha256_xxxxxxxx/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects source_id references without source manifests", () => {
  const kbRoot = makeWorkspace("kb-log-missing-source-manifest-");
  const sourceId = "src_sha256_xxxxxxxx";
  writeLog(kbRoot);
  writeSourceSummaryPage(kbRoot, "source-x", sourceId);
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "ingest",
          title: "Missing source manifest",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: [sourceId],
          dedup_key: "log_ingest_missing_source_manifest",
        },
        { kb_root: kbRoot }
      ),
    /must resolve to an existing source manifest/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects source manifests with mismatched source_id", () => {
  const kbRoot = makeWorkspace("kb-log-mismatched-manifest-source-id-");
  const sourceId = "src_sha256_xxxxxxxx";
  writeLog(kbRoot);
  writeSourceSummaryPage(kbRoot, "source-x", sourceId);
  writeSourceManifest(kbRoot, sourceId, "source-x");
  const manifestPath = path.join(kbRoot, "state", "manifests", `${sourceId}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        source_id: "src_sha256_yyyyyyyy",
        ingest_status: "ingested",
        ingest_summary_page_id: "source-x",
      },
      null,
      2
    ),
    "utf8"
  );
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "ingest",
          title: "Mismatched manifest source id",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: [sourceId],
          dedup_key: "log_ingest_mismatched_manifest_source_id",
        },
        { kb_root: kbRoot }
      ),
    /manifest source_id src_sha256_yyyyyyyy does not match src_sha256_xxxxxxxx/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects source manifest fallback after failed ingest", () => {
  const kbRoot = makeWorkspace("kb-log-failed-manifest-fallback-");
  const sourceId = "src_sha256_xxxxxxxx";
  writeLog(kbRoot);
  writeSourceSummaryPage(kbRoot, "source-x", sourceId);
  const manifestPath = path.join(kbRoot, "state", "manifests", `${sourceId}.json`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        source_id: sourceId,
        ingest_status: "failed",
        ingest_error: "conversion failed",
      },
      null,
      2
    ),
    "utf8"
  );
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "ingest",
          title: "Failed manifest fallback",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: [sourceId],
          dedup_key: "log_ingest_failed_manifest_fallback",
        },
        { kb_root: kbRoot }
      ),
    /manifest ingest_status failed cannot use source summary fallback/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects finalized manifests without summary pages", () => {
  const kbRoot = makeWorkspace("kb-log-ingested-manifest-no-summary-");
  const sourceId = "src_sha256_xxxxxxxx";
  writeLog(kbRoot);
  writeSourceSummaryPage(kbRoot, "source-x", sourceId);
  const manifestPath = path.join(kbRoot, "state", "manifests", `${sourceId}.json`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        source_id: sourceId,
        ingest_status: "ingested",
      },
      null,
      2
    ),
    "utf8"
  );
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "ingest",
          title: "Ingested manifest without summary",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: [sourceId],
          dedup_key: "log_ingest_manifest_missing_summary",
        },
        { kb_root: kbRoot }
      ),
    /manifest ingest_status ingested cannot use source summary fallback/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects missing manifest source summary pages", () => {
  const kbRoot = makeWorkspace("kb-log-missing-manifest-summary-");
  writeLog(kbRoot);
  writeSourceManifest(kbRoot, "src_sha256_xxxxxxxx", "missing-summary-page");
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "ingest",
          title: "Missing manifest summary",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: ["src_sha256_xxxxxxxx"],
          dedup_key: "log_ingest_missing_manifest_summary",
        },
        { kb_root: kbRoot }
      ),
    /must resolve to an existing source summary page/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects manifest summary pages that are not source pages", () => {
  const kbRoot = makeWorkspace("kb-log-non-source-manifest-summary-");
  const sourceId = "src_sha256_xxxxxxxx";
  writeLog(kbRoot);
  writeConceptPage(kbRoot, "concept-summary", "Concept Summary", [sourceId]);
  writeSourceManifest(kbRoot, sourceId, "concept-summary");
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "ingest",
          title: "Non-source manifest summary",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: [sourceId],
          dedup_key: "log_ingest_non_source_manifest_summary",
        },
        { kb_root: kbRoot }
      ),
    /manifest summary_page_id concept-summary is not a source page/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects ambiguous source summary page candidates", () => {
  const kbRoot = makeWorkspace("kb-log-ambiguous-source-summary-");
  const sourceId = "src_sha256_xxxxxxxx";
  writeLog(kbRoot);
  writeSourceSummaryPage(kbRoot, "source-summary-a", sourceId);
  writeSourceSummaryPage(kbRoot, "source-summary-b", sourceId);
  writePendingSourceManifest(kbRoot, sourceId);
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "ingest",
          title: "Ambiguous source summary",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: [sourceId],
          dedup_key: "log_ingest_ambiguous_source_summary",
        },
        { kb_root: kbRoot }
      ),
    /resolves to multiple source summary pages: source-summary-a, source-summary-b/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});

test("appendWikiLogEntry rejects unresolved references before writing broken wikilinks", () => {
  const kbRoot = makeWorkspace("kb-log-unresolved-ref-");
  writeLog(kbRoot);
  const before = fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8");

  assert.throws(
    () =>
      appendWikiLogEntry(
        {
          kind: "query",
          title: "Broken reference check",
          summary: "Should fail before writing.",
          date: "2026-04-28",
          references: ["missing-page"],
          dedup_key: "log_query_missing_ref",
        },
        { kb_root: kbRoot }
      ),
    /references\[\] must resolve to an existing wiki page/u
  );
  assert.equal(fs.readFileSync(path.join(kbRoot, "wiki", "log.md"), "utf8"), before);
});
