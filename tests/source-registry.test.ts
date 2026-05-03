import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { finalizeSourceIngest, registerSourceFile, readRegisteredSource } from "../src/core/source-registry";

function makeWorkspace(prefix = "kb-source-registry-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("registerSourceFile preserves Markdown as canonical Markdown", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");

  const result = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  assert.equal(result.manifest.source_kind, "markdown");
  assert.equal(result.manifest.canonical_path, `raw/inbox/${result.source_id}.md`);
  assert.equal(result.manifest.original_path, undefined);
  assert.equal(result.manifest.conversion?.required, false);
  assert.equal(
    fs.readFileSync(path.join(kbRoot, result.manifest.canonical_path), "utf8"),
    "# Title\n\nBody\n"
  );
});

test("registerSourceFile canonicalizes plaintext to Markdown and stores original", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.txt");
  fs.writeFileSync(sourcePath, "Plain text\n", "utf8");

  const result = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  assert.equal(result.manifest.source_kind, "plaintext");
  assert.equal(result.manifest.canonical_path, `raw/inbox/${result.source_id}.md`);
  assert.equal(result.manifest.original_path, `raw/originals/${result.source_id}.txt`);
  assert.equal(result.manifest.conversion?.converter, "plaintext");
  assert.equal(
    fs.readFileSync(path.join(kbRoot, result.manifest.canonical_path), "utf8"),
    "Plain text\n"
  );
  assert.equal(
    fs.readFileSync(path.join(kbRoot, result.manifest.original_path ?? ""), "utf8"),
    "Plain text\n"
  );
});

test("registerSourceFile rejects explicitly unsupported conversion features", () => {
  const kbRoot = makeWorkspace();
  for (const [name, expected] of [
    ["archive.zip", /ZIP archives/u],
    ["message.msg", /Outlook messages/u],
    ["audio.mp3", /Audio transcription/u],
    ["image.png", /Image OCR/u],
  ] as const) {
    const sourcePath = path.join(kbRoot, name);
    fs.writeFileSync(sourcePath, "content", "utf8");
    assert.throws(() => registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot }), expected);
  }
});

test("registerSourceFile rejects URLs and duplicate original content", () => {
  const kbRoot = makeWorkspace();
  const firstPath = path.join(kbRoot, "first.md");
  const secondPath = path.join(kbRoot, "second.md");
  fs.writeFileSync(firstPath, "same\n", "utf8");
  fs.writeFileSync(secondPath, "same\n", "utf8");

  registerSourceFile({ file_path: firstPath }, { kb_root: kbRoot });
  assert.throws(
    () => registerSourceFile({ file_path: secondPath }, { kb_root: kbRoot }),
    /Duplicate content/u
  );

  assert.throws(
    () => registerSourceFile({ file_path: "https://example.com/file.md" }, { kb_root: kbRoot }),
    /Remote URLs are not supported/u
  );
});

test("finalizeSourceIngest marks registered source as ingested", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  fs.mkdirSync(path.join(kbRoot, "wiki", "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "sources", `${registered.source_id}.md`),
    `---
id: ${registered.source_id}
type: source
title: Source Summary
updated_at: 2026-04-28
status: active
---

# Source Summary
`,
    "utf8"
  );

  const manifest = finalizeSourceIngest(
    {
      source_id: registered.source_id,
      status: "ingested",
      summary_page_id: registered.source_id,
      touched_pages: [`wiki/sources/${registered.source_id}.md`],
    },
    { kb_root: kbRoot }
  );

  assert.equal(manifest.ingest_status, "ingested");
  assert.equal(manifest.ingest_summary_page_id, registered.source_id);
  assert.deepEqual(manifest.ingest_touched_pages, [`wiki/sources/${registered.source_id}.md`]);
  assert.equal(typeof manifest.ingested_at, "string");

  const stored = JSON.parse(
    fs.readFileSync(path.join(kbRoot, "state", "manifests", `${registered.source_id}.json`), "utf8")
  ) as typeof manifest;
  assert.equal(stored.ingest_status, "ingested");
});

test("finalizeSourceIngest rejects overriding terminal ingest status", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  fs.mkdirSync(path.join(kbRoot, "wiki", "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "sources", `${registered.source_id}.md`),
    `---
id: ${registered.source_id}
type: source
title: Source Summary
updated_at: 2026-04-28
status: active
---

# Source Summary
`,
    "utf8"
  );

  finalizeSourceIngest(
    {
      source_id: registered.source_id,
      status: "ingested",
      summary_page_id: registered.source_id,
    },
    { kb_root: kbRoot }
  );

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "failed",
          error: "late failure",
        },
        { kb_root: kbRoot }
      ),
    /registered/u
  );
});

test("finalizeSourceIngest requires summary_page_id to resolve to a valid wiki page id", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  fs.mkdirSync(path.join(kbRoot, "wiki", "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "sources", "bad.md"),
    `---
id: ${registered.source_id}
type: source
title: Bad Summary
updated_at: not-a-date
status: active
---

# Bad Summary
`,
    "utf8"
  );

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "ingested",
          summary_page_id: registered.source_id,
        },
        { kb_root: kbRoot }
      ),
    /summary_page_id|frontmatter/u
  );
});

test("finalizeSourceIngest rejects duplicate summary_page_id matches", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  fs.mkdirSync(path.join(kbRoot, "wiki", "sources"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "wiki", "concepts"), { recursive: true });
  for (const relativePath of [
    `wiki/sources/${registered.source_id}.md`,
    "wiki/concepts/duplicate-summary.md",
  ]) {
    fs.writeFileSync(
      path.join(kbRoot, relativePath),
      `---
id: ${registered.source_id}
type: source
title: Source Summary
updated_at: 2026-04-28
status: active
---

# Source Summary
`,
      "utf8"
    );
  }

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "ingested",
          summary_page_id: registered.source_id,
        },
        { kb_root: kbRoot }
      ),
    /summary_page_id|unique|multiple/u
  );
});

test("finalizeSourceIngest fails closed when summary_page_id uniqueness cannot be verified", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  fs.mkdirSync(path.join(kbRoot, "wiki", "sources"), { recursive: true });
  fs.mkdirSync(path.join(kbRoot, "wiki", "concepts"), { recursive: true });
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "sources", `${registered.source_id}.md`),
    `---
id: ${registered.source_id}
type: source
title: Source Summary
updated_at: 2026-04-28
status: active
---

# Source Summary
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "concepts", "malformed.md"),
    `---
id: ${registered.source_id}
type: concept
title: "Malformed
updated_at: 2026-04-28
status: active
---

# Malformed
`,
    "utf8"
  );

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "ingested",
          summary_page_id: registered.source_id,
        },
        { kb_root: kbRoot }
      ),
    /summary_page_id|frontmatter|unique/u
  );
});

test("finalizeSourceIngest validates optional summary_page_id on failed status", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "failed",
          error: "ingest failed before wiki output",
          summary_page_id: "missing_summary",
        },
        { kb_root: kbRoot }
      ),
    /summary_page_id/u
  );
});

test("finalizeSourceIngest accepts empty touched_pages before wiki exists", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  const manifest = finalizeSourceIngest(
    {
      source_id: registered.source_id,
      status: "failed",
      error: "failed before wiki output",
      touched_pages: [],
    },
    { kb_root: kbRoot }
  );

  assert.equal(manifest.ingest_status, "failed");
  assert.deepEqual(manifest.ingest_touched_pages, []);
});

test("finalizeSourceIngest requires touched_pages to be existing markdown files under wiki", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  fs.mkdirSync(path.join(kbRoot, "wiki", "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "sources", `${registered.source_id}.md`),
    `---
id: ${registered.source_id}
type: source
title: Source Summary
updated_at: 2026-04-28
status: active
---

# Source Summary
`,
    "utf8"
  );
  fs.writeFileSync(path.join(kbRoot, "wiki", "sources", "note.txt"), "x", "utf8");
  fs.mkdirSync(path.join(kbRoot, "raw"), { recursive: true });
  fs.writeFileSync(path.join(kbRoot, "raw", "outside.md"), "# Outside\n", "utf8");
  fs.symlinkSync(
    path.join(kbRoot, "raw", "outside.md"),
    path.join(kbRoot, "wiki", "sources", "outside-link.md")
  );

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "ingested",
          summary_page_id: registered.source_id,
          touched_pages: ["wiki/sources/missing.md"],
        },
        { kb_root: kbRoot }
      ),
    /touched_pages/u
  );

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "ingested",
          summary_page_id: registered.source_id,
          touched_pages: ["wiki/sources/outside-link.md"],
        },
        { kb_root: kbRoot }
      ),
    /touched_pages|symlink/u
  );

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "ingested",
          summary_page_id: registered.source_id,
          touched_pages: ["wiki/sources/note.txt"],
        },
        { kb_root: kbRoot }
      ),
    /touched_pages/u
  );

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "ingested",
          summary_page_id: registered.source_id,
          touched_pages: ["wiki/sources"],
        },
        { kb_root: kbRoot }
      ),
    /touched_pages/u
  );
});

test("finalizeSourceIngest rejects touched_pages through symlinked wiki directories", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n\nBody\n", "utf8");
  const registered = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  fs.mkdirSync(path.join(kbRoot, "wiki", "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(kbRoot, "wiki", "sources", `${registered.source_id}.md`),
    `---
id: ${registered.source_id}
type: source
title: Source Summary
updated_at: 2026-04-28
status: active
---

# Source Summary
`,
    "utf8"
  );
  fs.symlinkSync(
    path.join(kbRoot, "wiki", "sources"),
    path.join(kbRoot, "wiki", "alias"),
    "dir"
  );

  assert.throws(
    () =>
      finalizeSourceIngest(
        {
          source_id: registered.source_id,
          status: "ingested",
          summary_page_id: registered.source_id,
          touched_pages: [`wiki/alias/${registered.source_id}.md`],
        },
        { kb_root: kbRoot }
      ),
    /touched_pages|symlink/u
  );
});

test("readRegisteredSource supports byte pagination", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "0123456789", "utf8");
  const result = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  const first = readRegisteredSource(result.source_id, { kb_root: kbRoot }, { max_bytes: 4 });
  assert.equal(first.content, "0123");
  assert.equal(first.offset_bytes, 0);
  assert.equal(first.returned_bytes, 4);
  assert.equal(first.total_bytes, 10);
  assert.equal(first.truncated, true);
  assert.equal(first.next_offset_bytes, 4);
  assert.match(first.warning ?? "", /Content truncated/u);

  const second = readRegisteredSource(result.source_id, { kb_root: kbRoot }, {
    offset_bytes: first.next_offset_bytes,
    max_bytes: 10,
  });
  assert.equal(second.content, "456789");
  assert.equal(second.truncated, false);
});

test("readRegisteredSource pagination reconstructs UTF-8 content without warning text", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  const original = "你好🙂abc";
  fs.writeFileSync(sourcePath, original, "utf8");
  const result = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  const chunks: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const page = readRegisteredSource(result.source_id, { kb_root: kbRoot }, {
      offset_bytes: offset,
      max_bytes: 4,
    });
    chunks.push(page.content);
    assert.doesNotMatch(page.content, /\[WARNING:/u);
    offset = page.next_offset_bytes;
  }

  assert.equal(chunks.join(""), original);
});

test("registerSourceFile can convert HTML with MarkItDown when integration test is enabled", { skip: process.env.RUN_MARKITDOWN_INTEGRATION !== "1" }, () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.html");
  fs.writeFileSync(sourcePath, "<h1>Hello</h1><p>World</p>", "utf8");

  const result = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });

  assert.equal(result.manifest.source_kind, "converted_markdown");
  assert.equal(result.manifest.conversion?.converter, "markitdown");
  assert.match(fs.readFileSync(path.join(kbRoot, result.manifest.canonical_path), "utf8"), /Hello/u);
});
