import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appendWikiLogEntry } from "../src/core/wiki-log";

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

test("appendWikiLogEntry writes structured multi-line log blocks idempotently", () => {
  const kbRoot = makeWorkspace();
  writeLog(kbRoot);

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
