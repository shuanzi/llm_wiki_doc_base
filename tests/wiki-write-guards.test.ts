import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { writeWikiPage, updateWikiSection } from "../src/core/wiki-pages";
import { ensureWikiEntry } from "../src/core/wiki-log";

function makeWorkspace(prefix = "kb-write-guards-"): string {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(kbRoot, "wiki", "concepts"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "wiki", "entities"), { recursive: true });
  return kbRoot;
}

const INVALID_PARSEABLE_PAGE = `---
id: broken_page
type: concept
title: Broken Page
updated_at: 2026-04-28
---

# Broken
`;

test("writeWikiPage rejects parseable but invalid existing frontmatter during page_id uniqueness scan", () => {
  const kbRoot = makeWorkspace();
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "concepts", "broken.md"),
    INVALID_PARSEABLE_PAGE,
    "utf8"
  );

  assert.throws(
    () =>
      writeWikiPage(
        {
          path: "wiki/concepts/new.md",
          content: `---
id: new_page
type: concept
title: New Page
updated_at: 2026-04-28
status: active
---

# New
`,
        },
        { kb_root: kbRoot }
      ),
    /Cannot verify page_id uniqueness because wiki\/concepts\/broken\.md has invalid frontmatter/u
  );

  assert.equal(
    fs.existsSync(path.join(kbRoot, "wiki", "concepts", "new.md")),
    false
  );
});

test("writeWikiPage can repair the target page even if its current frontmatter is invalid", () => {
  const kbRoot = makeWorkspace();
  const targetPath = path.join(kbRoot, "wiki", "concepts", "broken.md");
  fs.writeFileSync(targetPath, INVALID_PARSEABLE_PAGE, "utf8");

  const result = writeWikiPage(
    {
      path: "wiki/concepts/broken.md",
      content: `---
id: repaired_page
type: concept
title: Repaired Page
updated_at: 2026-04-28
status: active
---

# Repaired
`,
    },
    { kb_root: kbRoot }
  );

  assert.equal(result.action, "updated");
  assert.match(fs.readFileSync(targetPath, "utf8"), /id: repaired_page/u);
});

test("updateWikiSection rejects writes when wiki has known index-rebuild blockers", () => {
  const kbRoot = makeWorkspace();
  const targetPath = path.join(kbRoot, "wiki", "concepts", "sample.md");

  fs.writeFileSync(
    targetPath,
    `---
id: sample
type: concept
title: Sample
updated_at: 2026-04-28
status: active
---

# Sample

## Summary

Old text
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "entities", "broken.md"),
    INVALID_PARSEABLE_PAGE,
    "utf8"
  );

  const before = fs.readFileSync(targetPath, "utf8");
  assert.throws(
    () =>
      updateWikiSection(
        {
          path: "wiki/concepts/sample.md",
          heading: "## Summary",
          content: "New text",
        },
        { kb_root: kbRoot }
      ),
    /Cannot rebuild page index because one or more wiki pages cannot be indexed/u
  );

  assert.equal(fs.readFileSync(targetPath, "utf8"), before);
});

test("ensureWikiEntry rejects writes when wiki has known index-rebuild blockers", () => {
  const kbRoot = makeWorkspace();
  const logPath = path.join(kbRoot, "wiki", "log.md");

  fs.writeFileSync(
    logPath,
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
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "concepts", "broken.md"),
    INVALID_PARSEABLE_PAGE,
    "utf8"
  );

  const before = fs.readFileSync(logPath, "utf8");
  assert.throws(
    () =>
      ensureWikiEntry(
        {
          path: "wiki/log.md",
          entry: "- Added item",
          anchor: "## Recent",
          dedup_key: "recent-item",
        },
        { kb_root: kbRoot }
      ),
    /Cannot rebuild page index because one or more wiki pages cannot be indexed/u
  );

  assert.equal(fs.readFileSync(logPath, "utf8"), before);
});
