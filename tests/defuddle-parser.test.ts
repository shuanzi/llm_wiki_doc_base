import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDefuddleParseResultForTesting,
  parseHtmlWithDefuddle,
} from "../src/core/defuddle-parser";

test("parseHtmlWithDefuddle returns contentMarkdown from separateMarkdown mode", async () => {
  const result = await parseHtmlWithDefuddle({
    html: '<!doctype html><html><head><title>Hello</title><meta name="description" content="Desc"></head><body><main><h1>Hello</h1><p>World</p></main></body></html>',
    final_url: "https://example.com/article",
  });

  assert.ok(result.content_markdown.trim().length > 0);
  assert.match(result.content_markdown, /World/u);
  assert.equal(result.title, "Hello");
  assert.equal(result.description, "Desc");
  assert.equal(result.defuddle_version, "0.18.1");
});

test("parseHtmlWithDefuddle fails closed when Defuddle returns empty markdown", async () => {
  await assert.rejects(
    () =>
      parseHtmlWithDefuddle({
        html: "<!doctype html><html><body></body></html>",
        final_url: "https://example.com/empty",
      }),
    /Defuddle returned empty Markdown/u
  );
});

test("buildDefuddleParseResultForTesting preserves original markdown while trim-checking emptiness", () => {
  const markdown = "  Body  \n";
  const result = buildDefuddleParseResultForTesting(
    {
      title: "T",
      description: null,
      site: null,
      author: null,
      published: null,
      language: null,
      image: null,
      favicon: null,
      wordCount: 1,
      parseTime: 2,
      contentHtml: "<p>Body</p>",
      contentMarkdown: markdown,
    },
    "0.18.1"
  );

  assert.equal(result.content_markdown, markdown);
});
