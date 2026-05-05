import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import {
  registerUrlSource,
  escapeProvenanceValue,
  buildUrlDisplayBase,
} from "../src/core/url-source";
import type { FetchedPublicHtml } from "../src/core/url-fetch";
import type { DefuddleParseResult } from "../src/core/defuddle-parser";
import { validateKbToolArgs } from "../src/runtime/kb_tool_args";
import { KB_CANONICAL_TOOL_NAMES } from "../src/runtime/kb_tool_contract";

function makeWorkspace(prefix = "kb-url-source-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fetched(overrides: Partial<FetchedPublicHtml> = {}): FetchedPublicHtml {
  const html = Buffer.from(
    "<!doctype html><html><body><h1>Hello</h1></body></html>",
    "utf8"
  );
  return {
    original_url: "https://Example.com/path/article.html?x=1#frag",
    normalized_url: "https://example.com/path/article.html?x=1",
    final_url: "https://example.com/path/article.html?x=1",
    fetch_status: 200,
    content_type: "text/html; charset=utf-8",
    transport_content_encoding: "gzip",
    decoded_content_length: html.byteLength,
    original_content_length: html.byteLength + 10,
    decoded_entity_bytes: html,
    decoded_html: html.toString("utf8"),
    charset: "utf-8",
    warnings: [],
    ...overrides,
  };
}

function parsed(overrides: Partial<DefuddleParseResult> = {}): DefuddleParseResult {
  return {
    title: "Hello",
    description: null,
    site: "Example",
    author: null,
    published: null,
    language: "en",
    image: null,
    favicon: null,
    word_count: 2,
    parse_time_ms: 12,
    content_html: "<h1>Hello</h1>",
    content_markdown: "# Hello\n\nWorld\n",
    defuddle_version: "0.18.1",
    ...overrides,
  };
}

test("escapeProvenanceValue percent-encodes percent, hyphen, control, and non-ascii", () => {
  assert.equal(
    escapeProvenanceValue("a-b 100% 你\n"),
    "a%2Db 100%25 %E4%BD%A0%0A"
  );
});

test("buildUrlDisplayBase ignores query and produces stable lowercase base", () => {
  assert.equal(
    buildUrlDisplayBase("https://Example.com/docs/My%20Article.html?x=1"),
    "example.com-my-article"
  );
  assert.equal(
    buildUrlDisplayBase("https://example.com/docs/"),
    "example.com-index"
  );
  assert.equal(buildUrlDisplayBase("https://example.com/"), "example.com-index");
  assert.equal(
    buildUrlDisplayBase("https://example.com/docs/article.html?x=1"),
    "example.com-article"
  );
});

test("registerUrlSource writes original html, canonical markdown, extraction json, and url manifest", async () => {
  const kbRoot = makeWorkspace();
  const result = await registerUrlSource(
    { url: "https://Example.com/path/article.html?x=1#frag" },
    { kb_root: kbRoot },
    {
      fetchHtml: async () => fetched(),
      parseHtml: async () => parsed(),
      now: () => "2026-05-03T00:00:00.000Z",
    }
  );

  assert.equal(result.manifest.source_origin, "url");
  assert.equal(result.manifest.source_kind, "converted_markdown");
  assert.equal(result.manifest.file_name, "example.com-article.md");
  assert.equal(result.manifest.original_file_name, "example.com-article.html");
  assert.equal(result.manifest.original_extension, ".html");
  assert.equal(result.manifest.conversion?.converter, "defuddle");
  assert.equal(result.manifest.url_metadata?.title, "Hello");
  assert.equal(result.title, "Hello");
  assert.equal(result.description, null);
  assert.equal(result.word_count, 2);
  assert.equal(Object.hasOwn(result, "title"), true);
  assert.equal(Object.hasOwn(result, "description"), true);
  assert.equal(Object.hasOwn(result, "word_count"), true);

  const canonical = fs.readFileSync(
    path.join(kbRoot, result.manifest.canonical_path),
    "utf8"
  );
  assert.match(canonical, /^<!-- kb-source-provenance:v1\n/u);
  assert.match(canonical, /source_origin: url\n/u);
  assert.match(
    canonical,
    /original_url: https:\/\/Example\.com\/path\/article\.html\?x=1%23frag\n/u
  );
  assert.match(canonical, /\n-->\n\n# Hello\n\nWorld\n$/u);

  const original = fs.readFileSync(
    path.join(kbRoot, result.manifest.original_path ?? "")
  );
  assert.deepEqual(original, fetched().decoded_entity_bytes);

  const extraction = JSON.parse(
    fs.readFileSync(path.join(kbRoot, result.manifest.extraction_path ?? ""), "utf8")
  ) as Record<string, unknown>;
  assert.equal(extraction.schema_version, 1);
  assert.equal(extraction.source_origin, "url");
  assert.equal((extraction.metadata as Record<string, unknown>).title, "Hello");
});

test("registerUrlSource rejects duplicate decoded entity bytes across URLs", async () => {
  const kbRoot = makeWorkspace();
  await registerUrlSource(
    { url: "https://example.com/first" },
    { kb_root: kbRoot },
    {
      fetchHtml: async () =>
        fetched({
          original_url: "https://example.com/first",
          normalized_url: "https://example.com/first",
          final_url: "https://example.com/first",
        }),
      parseHtml: async () => parsed(),
    }
  );

  await assert.rejects(
    () =>
      registerUrlSource(
        { url: "https://example.org/second" },
        { kb_root: kbRoot },
        {
          fetchHtml: async () =>
            fetched({
              original_url: "https://example.org/second",
              normalized_url: "https://example.org/second",
              final_url: "https://example.org/second",
            }),
          parseHtml: async () => parsed(),
        }
      ),
    /Duplicate content/u
  );
});

test("registerUrlSource crops oversized extraction JSON and hashes final bytes", async () => {
  const kbRoot = makeWorkspace();
  const longMarkdown = "m".repeat(300_000);
  const longDescription = "d".repeat(300_000);
  const result = await registerUrlSource(
    { url: "https://example.com/large" },
    { kb_root: kbRoot },
    {
      fetchHtml: async () =>
        fetched({
          original_url: "https://example.com/large",
          normalized_url: "https://example.com/large",
          final_url: "https://example.com/large",
          warnings: ["fetch_charset_missing_assumed_utf8"],
        }),
      parseHtml: async () =>
        parsed({
          description: longDescription,
          content_html: "<article>" + "h".repeat(300_000) + "</article>",
          content_markdown: longMarkdown,
        }),
    }
  );

  const extractionPath = path.join(kbRoot, result.manifest.extraction_path ?? "");
  const extractionBytes = fs.readFileSync(extractionPath);
  const extraction = JSON.parse(extractionBytes.toString("utf8")) as {
    content_html: string | null;
    content_markdown: string;
    metadata: { description: string };
    truncation: { warnings: string[] };
  };
  const expectedWarnings = [
    "extraction_content_html_omitted_for_size",
    "extraction_content_markdown_truncated_for_size",
    "extraction_metadata_description_truncated_for_size",
  ];

  assert.equal(extraction.content_html, null);
  assert.equal(
    extraction.content_markdown,
    `${longMarkdown.slice(0, 64 * 1024)}...[TRUNCATED]`
  );
  assert.equal(
    extraction.metadata.description,
    `${longDescription.slice(0, 2048)}...[TRUNCATED]`
  );
  assert.deepEqual(extraction.truncation.warnings, expectedWarnings);
  assert.deepEqual(result.manifest.conversion?.warnings, [
    "fetch_charset_missing_assumed_utf8",
    ...expectedWarnings,
  ]);
  assert.equal(
    result.manifest.extraction_content_hash,
    `sha256:${crypto.createHash("sha256").update(extractionBytes).digest("hex")}`
  );
});

test("registerUrlSource leaves no artifacts when extraction remains oversized", async () => {
  const kbRoot = makeWorkspace();
  const bytes = Buffer.from("<!doctype html><html><body>oversize</body></html>", "utf8");
  const fullHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const sourceId = `src_sha256_${fullHash.slice(0, 8)}`;

  await assert.rejects(
    () =>
      registerUrlSource(
        { url: "https://example.com/oversize" },
        { kb_root: kbRoot },
        {
          fetchHtml: async () =>
            fetched({
              original_url: "https://example.com/oversize",
              normalized_url: "https://example.com/oversize",
              final_url: "https://example.com/oversize",
              decoded_entity_bytes: bytes,
              decoded_html: bytes.toString("utf8"),
              decoded_content_length: bytes.byteLength,
            }),
          parseHtml: async () =>
            parsed({
              title: "t".repeat(300_000),
              description: "d".repeat(300_000),
              content_html: "h".repeat(300_000),
              content_markdown: "m".repeat(300_000),
            }),
        }
      ),
    /exceeded 262144 byte limit/u
  );

  assert.equal(fs.existsSync(path.join(kbRoot, "raw", "inbox", `${sourceId}.md`)), false);
  assert.equal(
    fs.existsSync(path.join(kbRoot, "raw", "originals", `${sourceId}.html`)),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(kbRoot, "state", "extractions", `${sourceId}.defuddle.json`)
    ),
    false
  );
  assert.equal(
    fs.existsSync(path.join(kbRoot, "state", "manifests", `${sourceId}.json`)),
    false
  );
});

test("registerUrlSource cleans up written artifacts when artifact writing fails", async () => {
  const kbRoot = makeWorkspace();
  const bytes = fetched().decoded_entity_bytes;
  const fullHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const sourceId = `src_sha256_${fullHash.slice(0, 8)}`;

  await assert.rejects(
    () =>
      registerUrlSource(
        { url: "https://example.com/write-fail" },
        { kb_root: kbRoot },
        {
          fetchHtml: async () =>
            fetched({
              original_url: "https://example.com/write-fail",
              normalized_url: "https://example.com/write-fail",
              final_url: "https://example.com/write-fail",
            }),
          parseHtml: async () => parsed(),
          writeFile: (filePath, data, encoding) => {
            if (filePath.endsWith(`${sourceId}.defuddle.json`)) {
              throw new Error("simulated extraction write failure");
            }
            if (encoding) {
              fs.writeFileSync(filePath, data, encoding);
            } else {
              fs.writeFileSync(filePath, data);
            }
            return true;
          },
        }
      ),
    /simulated extraction write failure/u
  );

  assert.equal(fs.existsSync(path.join(kbRoot, "raw", "inbox", `${sourceId}.md`)), false);
  assert.equal(
    fs.existsSync(path.join(kbRoot, "raw", "originals", `${sourceId}.html`)),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(kbRoot, "state", "extractions", `${sourceId}.defuddle.json`)
    ),
    false
  );
  assert.equal(
    fs.existsSync(path.join(kbRoot, "state", "manifests", `${sourceId}.json`)),
    false
  );
});

test("registerUrlSource preserves a failed artifact path when writer throws before returning ownership", async () => {
  const kbRoot = makeWorkspace();
  const bytes = fetched().decoded_entity_bytes;
  const fullHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const sourceId = `src_sha256_${fullHash.slice(0, 8)}`;

  await assert.rejects(
    () =>
      registerUrlSource(
        { url: "https://example.com/partial-write-fail" },
        { kb_root: kbRoot },
        {
          fetchHtml: async () =>
            fetched({
              original_url: "https://example.com/partial-write-fail",
              normalized_url: "https://example.com/partial-write-fail",
              final_url: "https://example.com/partial-write-fail",
            }),
          parseHtml: async () => parsed(),
          writeFile: (filePath, data, encoding) => {
            if (filePath.endsWith(`${sourceId}.defuddle.json`)) {
              fs.writeFileSync(filePath, data);
              throw new Error("simulated partial extraction write failure");
            }
            if (encoding) {
              fs.writeFileSync(filePath, data, encoding);
            } else {
              fs.writeFileSync(filePath, data);
            }
            return true;
          },
        }
      ),
    /simulated partial extraction write failure/u
  );

  assert.equal(fs.existsSync(path.join(kbRoot, "raw", "inbox", `${sourceId}.md`)), false);
  assert.equal(
    fs.existsSync(path.join(kbRoot, "raw", "originals", `${sourceId}.html`)),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(kbRoot, "state", "extractions", `${sourceId}.defuddle.json`)
    ),
    true
  );
  assert.equal(
    fs.existsSync(path.join(kbRoot, "state", "manifests", `${sourceId}.json`)),
    false
  );
});

test("registerUrlSource preserves pre-existing orphan artifact paths", async () => {
  const kbRoot = makeWorkspace();
  const bytes = fetched().decoded_entity_bytes;
  const fullHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const sourceId = `src_sha256_${fullHash.slice(0, 8)}`;
  const orphanPath = path.join(kbRoot, "raw", "inbox", `${sourceId}.md`);
  fs.mkdirSync(path.dirname(orphanPath), { recursive: true });
  fs.writeFileSync(orphanPath, "pre-existing orphan", "utf8");

  await assert.rejects(
    () =>
      registerUrlSource(
        { url: "https://example.com/orphan" },
        { kb_root: kbRoot },
        {
          fetchHtml: async () => fetched(),
          parseHtml: async () => parsed(),
        }
      ),
    /already exists/u
  );

  assert.equal(fs.readFileSync(orphanPath, "utf8"), "pre-existing orphan");
  assert.equal(
    fs.existsSync(path.join(kbRoot, "raw", "originals", `${sourceId}.html`)),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(kbRoot, "state", "extractions", `${sourceId}.defuddle.json`)
    ),
    false
  );
  assert.equal(
    fs.existsSync(path.join(kbRoot, "state", "manifests", `${sourceId}.json`)),
    false
  );
});

test("registerUrlSource does not clean up artifacts created after preflight by another writer", async () => {
  const kbRoot = makeWorkspace();
  const bytes = fetched().decoded_entity_bytes;
  const fullHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const sourceId = `src_sha256_${fullHash.slice(0, 8)}`;
  const canonicalPath = path.join(kbRoot, "raw", "inbox", `${sourceId}.md`);

  await assert.rejects(
    () =>
      registerUrlSource(
        { url: "https://example.com/concurrent-write" },
        { kb_root: kbRoot },
        {
          fetchHtml: async () =>
            fetched({
              original_url: "https://example.com/concurrent-write",
              normalized_url: "https://example.com/concurrent-write",
              final_url: "https://example.com/concurrent-write",
            }),
          parseHtml: async () => parsed(),
          writeFile: (filePath) => {
            if (filePath === canonicalPath) {
              fs.writeFileSync(filePath, "concurrent", { flag: "wx" });
              throw Object.assign(new Error("simulated concurrent create"), {
                code: "EEXIST",
              });
            }
            throw new Error("unexpected write after concurrent failure");
          },
        }
      ),
    /simulated concurrent create/u
  );

  assert.equal(fs.readFileSync(canonicalPath, "utf8"), "concurrent");
});

test("registerUrlSource rejects credential query URLs before fetch and writing artifacts", async () => {
  const kbRoot = makeWorkspace();
  let fetchCalled = false;
  let parseCalled = false;

  await assert.rejects(
    () =>
      registerUrlSource(
        { url: "https://example.com/private?session_token=secret" },
        { kb_root: kbRoot },
        {
          fetchHtml: async () => {
            fetchCalled = true;
            return fetched();
          },
          parseHtml: async () => {
            parseCalled = true;
            return parsed();
          },
        }
      ),
    /URL query credentials are not supported/u
  );

  assert.equal(fetchCalled, false);
  assert.equal(parseCalled, false);
  assert.equal(fs.existsSync(path.join(kbRoot, "raw")), false);
  assert.equal(fs.existsSync(path.join(kbRoot, "state")), false);
});

test("kb_url_add is ordered after kb_source_add and validates url argument", () => {
  assert.deepEqual(KB_CANONICAL_TOOL_NAMES.slice(0, 4), [
    "kb_source_add",
    "kb_url_add",
    "kb_ingest_finalize",
    "kb_read_source",
  ]);

  assert.deepEqual(validateKbToolArgs("kb_url_add", { url: "https://example.com/a" }), {
    ok: true,
    args: { url: "https://example.com/a" },
  });
  assert.equal(validateKbToolArgs("kb_url_add", {}).ok, false);
});
