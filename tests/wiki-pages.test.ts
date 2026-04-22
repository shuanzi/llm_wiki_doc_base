import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { updateWikiSection } from "../src/core/wiki-pages";

test("updateWikiSection rejects non-Markdown heading inputs", () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-wiki-pages-"));
  const pagePath = path.join(kbRoot, "wiki", "sample.md");
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(
    pagePath,
    `---
id: sample
type: concept
title: Sample
updated_at: 2026-04-22
status: active
---

Intro

Summary

Existing text

## Next

Keep me
`,
    "utf8"
  );

  assert.throws(
    () =>
      updateWikiSection(
        {
          path: "wiki/sample.md",
          heading: "Summary",
          content: "Replacement",
        },
        { kb_root: kbRoot }
      ),
    /Invalid heading/
  );
});

test("updateWikiSection replaces a valid heading and preserves following sections", () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-wiki-pages-"));
  const pagePath = path.join(kbRoot, "wiki", "sample.md");
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(
    pagePath,
    `---
id: sample
type: concept
title: Sample
updated_at: 2026-04-22
status: active
---

Intro

## Summary

Old summary line

## Next

Keep me
`,
    "utf8"
  );

  const result = updateWikiSection(
    {
      path: "wiki/sample.md",
      heading: "## Summary",
      content: "New summary line",
    },
    { kb_root: kbRoot }
  );

  const updated = fs.readFileSync(pagePath, "utf8");

  assert.equal(result.action, "replaced");
  assert.match(updated, /## Summary\n\nNew summary line\n\n## Next\n\nKeep me/u);
  assert.doesNotMatch(updated, /Old summary line/u);
});
