import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { writeWikiPage, updateWikiSection } from "../src/core/wiki-pages";
import {
  getSearchIndexStatus,
  rebuildSearchIndexes,
  searchWiki,
} from "../src/core/wiki-search";

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kb-wiki-search-"));
}

function writePage(
  kbRoot: string,
  relativePath: string,
  id: string,
  title: string,
  body: string,
  tags: string[] = []
): void {
  const tagBlock = tags.length > 0
    ? `tags:\n${tags.map((tag) => `  - ${tag}`).join("\n")}\n`
    : "tags: []\n";
  writeWikiPage(
    {
      path: relativePath,
      content: `---\nid: ${id}\ntype: concept\ntitle: ${title}\nupdated_at: 2026-04-22\nstatus: active\n${tagBlock}---\n\n${body}\n`,
    },
    { kb_root: kbRoot }
  );
}

test("searchWiki keeps wikilink resolution usable without query", () => {
  const kbRoot = makeWorkspace();
  writePage(kbRoot, "wiki/concepts/memory.md", "memory", "Memory", "Project memory notes.");

  const results = searchWiki({ resolve_link: "[[Memory]]" }, { kb_root: kbRoot });

  assert.equal(results.length, 1);
  assert.equal(results[0].page_id, "memory");
});

test("searchWiki supports legacy index mode and built-in BM25 mode", () => {
  const kbRoot = makeWorkspace();
  writePage(kbRoot, "wiki/concepts/alpha.md", "alpha", "Alpha Memory", "The project uses durable knowledge compilation and graph pruning.", ["architecture"]);
  writePage(kbRoot, "wiki/concepts/beta.md", "beta", "Beta Import", "This page discusses file conversion and source manifests.", ["import"]);

  const legacy = searchWiki({ query: "memory", mode: "index" }, { kb_root: kbRoot });
  assert.equal(legacy[0].page_id, "alpha");
  assert.equal(legacy[0].backend, "index");

  const bm25 = searchWiki({ query: "graph pruning", mode: "bm25" }, { kb_root: kbRoot });
  assert.equal(bm25[0].page_id, "alpha");
  assert.equal(bm25[0].backend, "bm25");
  assert.match(bm25[0].excerpt, /graph pruning/u);

  const filtered = searchWiki({ query: "source manifests", mode: "bm25", tags: ["import"] }, { kb_root: kbRoot });
  assert.equal(filtered[0].page_id, "beta");
});

test("search index status and BM25 rebuild track staleness", () => {
  const kbRoot = makeWorkspace();
  writePage(kbRoot, "wiki/concepts/alpha.md", "alpha", "Alpha", "Initial body.");

  const before = getSearchIndexStatus({ kb_root: kbRoot });
  assert.equal(before.bm25.exists, false);
  assert.equal(before.bm25.stale, true);

  const rebuilt = rebuildSearchIndexes({ kb_root: kbRoot }, { backend: "bm25" });
  assert.equal(rebuilt.bm25?.rebuilt, true);
  assert.equal(rebuilt.bm25?.docs, 1);

  const after = getSearchIndexStatus({ kb_root: kbRoot });
  assert.equal(after.bm25.exists, true);
  assert.equal(after.bm25.stale, false);

  updateWikiSection({ path: "wiki/concepts/alpha.md", heading: "## New Section", content: "New searchable body.", create_if_missing: true }, { kb_root: kbRoot });
  const stale = getSearchIndexStatus({ kb_root: kbRoot });
  assert.equal(stale.bm25.stale, true);
});

test("QMD mode reports unavailable backend clearly when qmd is not installed", () => {
  const kbRoot = makeWorkspace();
  writePage(kbRoot, "wiki/concepts/alpha.md", "alpha", "Alpha", "Initial body.");

  const previous = process.env.QMD_BIN;
  process.env.QMD_BIN = "definitely-not-a-real-qmd-binary";
  try {
    assert.throws(() => searchWiki({ query: "alpha", mode: "qmd" }, { kb_root: kbRoot }), /QMD backend is unavailable/u);
  } finally {
    if (previous === undefined) delete process.env.QMD_BIN;
    else process.env.QMD_BIN = previous;
  }
});

test("ripgrep mode returns line-oriented results when rg is available", { skip: spawnSync("rg", ["--version"]).error !== undefined }, () => {
  const kbRoot = makeWorkspace();
  writePage(kbRoot, "wiki/concepts/alpha.md", "alpha", "Alpha", "Needle phrase appears here.");

  const results = searchWiki({ query: "Needle phrase", mode: "rg" }, { kb_root: kbRoot });

  assert.equal(results[0].page_id, "alpha");
  assert.equal(results[0].backend, "rg");
  assert.equal(results[0].match_kind, "line");
  assert.match(results[0].excerpt, /Needle phrase/u);
});
