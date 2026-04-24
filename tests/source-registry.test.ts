import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { registerSourceFile, readRegisteredSource } from "../src/core/source-registry";

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
