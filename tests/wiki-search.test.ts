import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { rebuildPageIndex } from "../src/core/wiki-maintenance";
import { rebuildSearchIndex } from "../src/core/wiki-search-index";
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

test("searchWiki does not resolve bare links through file stems", () => {
  const kbRoot = makeWorkspace("kb-wiki-search-bare-stem-");
  const stemPagePath = path.join(kbRoot, "wiki", "foo.md");
  const titlePagePath = path.join(kbRoot, "wiki", "concepts", "baz.md");
  fs.writeFileSync(
    stemPagePath,
    `---
id: bar
type: concept
title: Bar
updated_at: 2026-04-28
status: active
---

# Bar
`,
    "utf8"
  );
  fs.writeFileSync(
    titlePagePath,
    `---
id: baz
type: concept
title: foo
updated_at: 2026-04-28
status: active
---

# foo
`,
    "utf8"
  );
  rebuildPageIndex({ kb_root: kbRoot });

  const results = searchWiki({ resolve_link: "foo" }, { kb_root: kbRoot });

  assert.equal(results.length, 1);
  assert.equal(results[0].page_id, "baz");
});

test("searchWiki resolves page ids before title matches", () => {
  const kbRoot = makeWorkspace("kb-wiki-search-id-priority-");
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "concepts", "alpha.md"),
    `---
id: alpha
type: concept
title: beta
updated_at: 2026-04-28
status: active
---

# beta
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "concepts", "beta.md"),
    `---
id: beta
type: concept
title: Actual Beta
updated_at: 2026-04-28
status: active
---

# Actual Beta
`,
    "utf8"
  );
  rebuildPageIndex({ kb_root: kbRoot });

  const results = searchWiki({ resolve_link: "beta" }, { kb_root: kbRoot });

  assert.equal(results.length, 1);
  assert.equal(results[0].page_id, "beta");
});

test("searchWiki fails closed on ambiguous title matches", () => {
  const kbRoot = makeWorkspace("kb-wiki-search-ambiguous-title-");
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "concepts", "alpha.md"),
    `---
id: alpha
type: concept
title: Shared Title
updated_at: 2026-04-28
status: active
---

# Shared Title
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "concepts", "beta.md"),
    `---
id: beta
type: concept
title: Shared Title
updated_at: 2026-04-28
status: active
---

# Shared Title
`,
    "utf8"
  );
  rebuildPageIndex({ kb_root: kbRoot });

  const results = searchWiki({ resolve_link: "Shared Title" }, { kb_root: kbRoot });

  assert.equal(results.length, 0);
});

test("searchWiki chunk mode searches full page body beyond page excerpt", () => {
  const kbRoot = makeWorkspace();
  const pagePath = path.join(kbRoot, "wiki", "concepts", "deep.md");
  fs.writeFileSync(
    pagePath,
    `---
id: deep_concept
type: concept
title: Deep Concept
updated_at: 2026-04-28
status: active
---

# Deep Concept

${"Filler sentence. ".repeat(40)}

## Hidden Detail

The buriedneedle appears only in the later full-body chunk.
`,
    "utf8"
  );
  rebuildPageIndex({ kb_root: kbRoot });

  const pageResults = searchWiki({ query: "buriedneedle", mode: "page" }, { kb_root: kbRoot });
  const chunkResults = searchWiki({ query: "buriedneedle", mode: "chunk" }, { kb_root: kbRoot });

  assert.equal(pageResults.length, 0);
  assert.equal(chunkResults.length, 1);
  assert.equal(chunkResults[0].page_id, "deep_concept");
  assert.deepEqual(chunkResults[0].heading_path, ["Deep Concept", "Hidden Detail"]);
  assert.match(chunkResults[0].excerpt, /buriedneedle/u);
});

test("searchWiki chunk mode rebuilds malformed cached chunk shapes", () => {
  const kbRoot = makeWorkspace("kb-wiki-search-malformed-chunk-cache-");
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

Alpha keyword appears in this body.
`,
    "utf8"
  );
  rebuildPageIndex({ kb_root: kbRoot });

  fs.writeFileSync(
    path.join(kbRoot, "state", "cache", "search-index.json"),
    JSON.stringify({ version: 1, chunks: [{}] }, null, 2),
    "utf8"
  );

  const results = searchWiki({ query: "alpha", mode: "chunk" }, { kb_root: kbRoot });
  const rebuiltIndex = JSON.parse(
    fs.readFileSync(path.join(kbRoot, "state", "cache", "search-index.json"), "utf8")
  ) as { chunks: Array<{ chunk_id?: string; page_id?: string }> };

  assert.equal(results.length, 1);
  assert.equal(results[0].page_id, "alpha_concept");
  assert.equal(typeof rebuiltIndex.chunks[0]?.chunk_id, "string");
  assert.equal(rebuiltIndex.chunks[0]?.page_id, "alpha_concept");
});

test("rebuildSearchIndex fails fast on invalid frontmatter by default", () => {
  const kbRoot = makeWorkspace("kb-wiki-search-invalid-frontmatter-");
  const pagePath = path.join(kbRoot, "wiki", "concepts", "invalid.md");
  fs.writeFileSync(
    pagePath,
    `---
id: invalid_concept
type: concept
title: Invalid Concept
updated_at: not-a-date
status: active
---

# Invalid Concept
`,
    "utf8"
  );

  assert.throws(
    () => rebuildSearchIndex({ kb_root: kbRoot }),
    /Cannot rebuild search index|Frontmatter validation/u
  );
});
