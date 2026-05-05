import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, "..");
  const srcBridgePath = path.join(repoRoot, "src", "core", "defuddle-parser-bridge.mjs");
  const distBridgePath = path.join(repoRoot, "dist", "core", "defuddle-parser-bridge.mjs");

  assert.ok(fs.existsSync(distBridgePath), `Missing dist bridge asset: ${distBridgePath}`);
  assert.equal(
    fs.readFileSync(distBridgePath, "utf8"),
    fs.readFileSync(srcBridgePath, "utf8"),
    "Dist bridge asset does not match source bridge."
  );

  const distModule = require(path.join(
    repoRoot,
    "dist",
    "core",
    "defuddle-parser.js"
  )) as typeof import("../src/core/defuddle-parser");

  const result = await distModule.parseHtmlWithDefuddle({
    html: "<!doctype html><html><head><title>Smoke</title></head><body><article><h1>Smoke</h1><p>Works</p></article></body></html>",
    final_url: "https://example.com/smoke",
  });

  assert.ok(result.content_markdown.trim().length > 0);
  assert.match(result.content_markdown, /Works/u);
  assert.equal(result.title, "Smoke");
  assert.equal(result.defuddle_version, "0.18.1");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
