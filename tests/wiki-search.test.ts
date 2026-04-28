import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { rebuildPageIndex } from "../src/core/wiki-maintenance";
import { searchWiki } from "../src/core/wiki-search";

function makeWorkspace(prefix = "kb-wiki-search-"): string {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(kbRoot, "wiki", "concepts"), { recursive: true });
  return kbRoot;
}

test("searchWiki ignores empty resolve_link and still executes query search", () => {
  const kbRoot = makeWorkspace();
  const pagePath = path.join(kbRoot, "wiki", "concepts", "alpha.md");
  fs.writeFileSync(
    pagePath,
    `---
id: alpha_concept
type: concept
title: Alpha Concept
updated_at: 2026-04-28
status: active
---

# Alpha Concept
`,
    "utf8"
  );
  rebuildPageIndex({ kb_root: kbRoot });

  const results = searchWiki(
    { query: "alpha", resolve_link: "" },
    { kb_root: kbRoot }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].page_id, "alpha_concept");
});

test("searchWiki resolves path-like wikilink target", () => {
  const kbRoot = makeWorkspace();
  const pagePath = path.join(kbRoot, "wiki", "reports", "index.md");
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(
    pagePath,
    `---
id: reports_index
type: index
title: Reports Index
updated_at: 2026-04-28
status: active
---

# Reports Index
`,
    "utf8"
  );
  rebuildPageIndex({ kb_root: kbRoot });

  const results = searchWiki(
    { resolve_link: "[[reports/index]]" },
    { kb_root: kbRoot }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].page_id, "reports_index");
  assert.equal(results[0].path, "wiki/reports/index.md");
});
