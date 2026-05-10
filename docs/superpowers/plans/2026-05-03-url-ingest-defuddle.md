# Defuddle URL Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `kb_url_add`，把公开 HTTP/HTTPS URL 抓取、用 Defuddle 抽取为 canonical Markdown，并注册到知识库 raw source 层。

**Architecture:** URL 导入走独立工具，不扩展 `kb_source_add`。自有 fetch 层负责 SSRF 防护、重定向、解码、大小限制和 charset；Defuddle 只接收已经校验并解码为 UTF-8 JS string 的 HTML；source registry 继续作为 manifest 读写边界，并通过 manifest normalization 兼容旧数据。工具契约以 `KB_TOOL_DEFINITIONS` / `KB_CANONICAL_TOOL_NAMES` 为单一来源，OpenClaw installer、probe、artifact 和校验脚本只消费该顺序。

**Tech Stack:** TypeScript CommonJS 项目、Node.js 25、`defuddle@0.18.1`、`linkedom`、ESM bridge `.mjs`、`node:test`、`tsx`。

---

## 设计边界

- `kb_source_add` 继续拒绝 URL，并只处理本地文件。
- `kb_url_add` 只支持公开 `http` / `https` 的 `text/html`，不支持登录态、cookie、JS-only SPA、XHTML、第三方 async fallback；默认拒绝 private networks。显式启用 trusted fake-ip proxy DNS 模式（`KB_URL_FETCH_TRUSTED_PROXY_DNS=1` 或大小写不敏感的 `true`）时，仅允许 trusted fake-ip CIDR（默认 `198.18.0.0/15`，可由 `KB_URL_FETCH_TRUSTED_PROXY_CIDRS` 配置）且须经公网 DNS 校验。
- `raw/originals/{source_id}.html` 保存 HTTP content-coding 解码后的 HTML entity bytes；`raw/inbox/{source_id}.md` 保存 provenance block 加 Defuddle `contentMarkdown`。
- `Manifest.content_hash` 和 `original_content_hash` 都基于 decoded HTML entity bytes 的 sha256。
- `state/extractions/{source_id}.defuddle.json` 保存裁剪后的 Defuddle 派生结果，不是 source identity。
- 真实 URL 验收使用临时 KB，不写入仓库 `kb/`，并输出逐 URL 结果。

## 文件结构

**新增文件**

- `src/core/url-fetch.ts`：URL 标准化、DNS/IP 校验、手动 redirect、streaming wire/decoded 限制、content-encoding 解码、charset 检测。
- `src/core/defuddle-parser-bridge.mjs`：ESM bridge，静态 import `defuddle/node` 和 `linkedom`。
- `src/core/defuddle-parser.ts`：CommonJS wrapper，动态 import 本地 `.mjs` bridge。
- `src/core/url-source.ts`：URL source 注册主流程，组装 canonical Markdown、original、extraction、manifest。
- `src/tools/kb_url_add.ts`：runtime tool handler。
- `tests/url-fetch.test.ts`：SSRF、redirect、content-type、encoding、charset、size-limit 单元测试。
- `tests/defuddle-parser.test.ts`：Defuddle bridge `contentMarkdown` 与 fail-closed 行为测试。
- `tests/url-source.test.ts`：URL source 注册、manifest、provenance、extraction 裁剪测试。
- `scripts/copy_runtime_assets.ts`：build 后复制 `.mjs` bridge 到 `dist/core/`。
- `scripts/validate_defuddle_dist_smoke.ts`：验证 dist 中 bridge 能解析 HTML 并返回 Markdown。
- `scripts/validate_mcp_dist_surface.ts`：验证 dist MCP tool surface 含 `kb_url_add` 且顺序稳定。
- `scripts/validate_url_real_ingest.ts`：真实 URL 转 Markdown 外部网络验收。
- `scripts/fixtures/url-real-ingest-urls.txt`：真实 URL 验收输入清单。

**修改文件**

- `package.json` / `package-lock.json`：新增 `defuddle@0.18.1`、`linkedom`，调整 build 脚本，新增测试/校验脚本别名。
- `src/types/index.ts`：扩展 Manifest、conversion、URL metadata、source origin 类型。
- `src/core/source-registry.ts`：新增 `normalizeManifest()`，本地 source 新 manifest 写 `source_origin: "file"`，所有读取边界返回 normalized manifest。
- `src/runtime/kb_tool_contract.ts`：在 `kb_source_add` 后插入 `kb_url_add`，保留 `kb_ingest_finalize`，并更新 `kb_read_source` 文案。
- `src/runtime/kb_tool_args.ts`：新增 `kb_url_add` 参数校验。
- `src/runtime/kb_tool_runtime.ts`：注册 `kb_url_add` handler。
- `src/index.ts`：导出新 tool/core API。
- `src/openclaw-installer/skills.ts`、`skills/kb_ingest/SKILL.md`、`src/openclaw-installer/workspace-docs.ts`、`src/openclaw-installer/manifest.ts`、`src/openclaw-installer/session-runtime-artifact.ts`、`src/openclaw-installer/session-runtime-probe.ts`、`src/openclaw-installer/mcp-probe.ts`、`tests/openclaw-installer-substrate.test.ts`：同步工具契约与 skill 文案。
- `README.md`、`docs/technical.md`、`openspec/specs/openclaw-agent-kb-tool-availability/spec.md`、`src/mcp_server.ts` 顶部注释：补充 `kb_url_add` 与 URL 导入限制。
- `scripts/validate_openclaw_plugin_surface.ts`、`scripts/validate_kb_tool_contract_baseline.ts`：改为消费 canonical tool list，保留顺序校验。

## 任务拆分

### Task 1: 依赖、构建资产和 Defuddle bridge

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/core/defuddle-parser-bridge.mjs`
- Create: `src/core/defuddle-parser.ts`
- Create: `scripts/copy_runtime_assets.ts`
- Create: `tests/defuddle-parser.test.ts`
- Create: `scripts/validate_defuddle_dist_smoke.ts`

- [ ] **Step 1: 安装固定依赖**

Run:

```bash
npm install defuddle@0.18.1 linkedom
```

Expected:

```text
package.json and package-lock.json updated
```

- [ ] **Step 2: 新增 bridge 失败测试**

Create `tests/defuddle-parser.test.ts` with these initial assertions:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { parseHtmlWithDefuddle } from "../src/core/defuddle-parser";

test("parseHtmlWithDefuddle returns contentMarkdown from separateMarkdown mode", async () => {
  const result = await parseHtmlWithDefuddle({
    html: "<!doctype html><html><head><title>Hello</title><meta name=\"description\" content=\"Desc\"></head><body><main><h1>Hello</h1><p>World</p></main></body></html>",
    final_url: "https://example.com/article",
  });

  assert.match(result.content_markdown, /# Hello|Hello/u);
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
```

- [ ] **Step 3: 运行 bridge 测试确认失败**

Run:

```bash
npx tsx --test tests/defuddle-parser.test.ts
```

Expected:

```text
FAIL Cannot find module '../src/core/defuddle-parser'
```

- [ ] **Step 4: 实现 ESM bridge**

Create `src/core/defuddle-parser-bridge.mjs`:

```js
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

const DEFUDDLE_VERSION = "0.18.1";

export function getDefuddleVersion() {
  return DEFUDDLE_VERSION;
}

export async function parseDefuddleHtml(html, finalUrl, options = {}) {
  const { document } = parseHTML(html);
  const result = await Defuddle(document, finalUrl, {
    separateMarkdown: true,
    useAsync: false,
    language: options.language,
  });

  return {
    title: result.title ?? null,
    description: result.description ?? null,
    site: result.site ?? null,
    author: result.author ?? null,
    published: result.published ?? null,
    language: result.language ?? null,
    image: result.image ?? null,
    favicon: result.favicon ?? null,
    wordCount: typeof result.wordCount === "number" ? result.wordCount : null,
    parseTime: typeof result.parseTime === "number" ? result.parseTime : null,
    contentHtml: result.content ?? null,
    contentMarkdown: result.contentMarkdown ?? null,
  };
}
```

- [ ] **Step 5: 实现 CommonJS wrapper**

Create `src/core/defuddle-parser.ts`:

```ts
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export interface ParseHtmlWithDefuddleInput {
  html: string;
  final_url: string;
  language?: string;
}

export interface DefuddleParseResult {
  title: string | null;
  description: string | null;
  site: string | null;
  author: string | null;
  published: string | null;
  language: string | null;
  image: string | null;
  favicon: string | null;
  word_count: number | null;
  parse_time_ms: number | null;
  content_html: string | null;
  content_markdown: string;
  defuddle_version: string;
}

interface BridgeModule {
  getDefuddleVersion(): string;
  parseDefuddleHtml(
    html: string,
    finalUrl: string,
    options: { language?: string }
  ): Promise<{
    title: string | null;
    description: string | null;
    site: string | null;
    author: string | null;
    published: string | null;
    language: string | null;
    image: string | null;
    favicon: string | null;
    wordCount: number | null;
    parseTime: number | null;
    contentHtml: string | null;
    contentMarkdown: string | null;
  }>;
}

let bridgePromise: Promise<BridgeModule> | undefined;

async function loadBridge(): Promise<BridgeModule> {
  bridgePromise ??= import(
    pathToFileURL(path.join(__dirname, "defuddle-parser-bridge.mjs")).href
  ) as Promise<BridgeModule>;
  return bridgePromise;
}

export async function parseHtmlWithDefuddle(
  input: ParseHtmlWithDefuddleInput
): Promise<DefuddleParseResult> {
  const bridge = await loadBridge();
  const result = await bridge.parseDefuddleHtml(input.html, input.final_url, {
    language: input.language,
  });
  if (!result.contentMarkdown || result.contentMarkdown.trim().length === 0) {
    throw new Error("Defuddle returned empty Markdown.");
  }

  return {
    title: result.title,
    description: result.description,
    site: result.site,
    author: result.author,
    published: result.published,
    language: result.language,
    image: result.image,
    favicon: result.favicon,
    word_count: result.wordCount,
    parse_time_ms: result.parseTime,
    content_html: result.contentHtml,
    content_markdown: result.contentMarkdown,
    defuddle_version: bridge.getDefuddleVersion(),
  };
}
```

- [ ] **Step 6: 复制 `.mjs` bridge 到 dist**

Create `scripts/copy_runtime_assets.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";

const assets = [
  {
    from: path.join("src", "core", "defuddle-parser-bridge.mjs"),
    to: path.join("dist", "core", "defuddle-parser-bridge.mjs"),
  },
];

for (const asset of assets) {
  fs.mkdirSync(path.dirname(asset.to), { recursive: true });
  fs.copyFileSync(asset.from, asset.to);
}
```

Modify `package.json` scripts:

```json
{
  "build": "tsc && npx tsx --tsconfig tsconfig.scripts.json scripts/copy_runtime_assets.ts",
  "test:url-ingest": "tsx --test tests/url-fetch.test.ts tests/defuddle-parser.test.ts tests/url-source.test.ts",
  "validate:defuddle-dist-smoke": "npx tsx --tsconfig tsconfig.scripts.json scripts/validate_defuddle_dist_smoke.ts"
}
```

- [ ] **Step 7: 新增 dist smoke**

Create `scripts/validate_defuddle_dist_smoke.ts`:

```ts
import assert from "node:assert/strict";
import * as path from "node:path";

async function main(): Promise<void> {
  const distModule = require(path.join(
    process.cwd(),
    "dist",
    "core",
    "defuddle-parser.js"
  )) as typeof import("../src/core/defuddle-parser");

  const result = await distModule.parseHtmlWithDefuddle({
    html: "<!doctype html><html><head><title>Smoke</title></head><body><article><h1>Smoke</h1><p>Works</p></article></body></html>",
    final_url: "https://example.com/smoke",
  });

  assert.match(result.content_markdown, /Smoke/u);
  assert.match(result.content_markdown, /Works/u);
  assert.equal(result.defuddle_version, "0.18.1");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 8: 验证 Task 1**

Run:

```bash
npx tsx --test tests/defuddle-parser.test.ts
npm run build
npm run validate:defuddle-dist-smoke
```

Expected:

```text
pass
```

### Task 2: URL fetch 安全边界

**Files:**
- Create: `src/core/url-fetch.ts`
- Create: `tests/url-fetch.test.ts`

- [ ] **Step 1: 写 URL 标准化与拒绝规则测试**

Create `tests/url-fetch.test.ts` with local helpers and these cases:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import * as dns from "node:dns";
import * as http from "node:http";
import * as zlib from "node:zlib";

import {
  normalizePublicHttpUrl,
  isPublicIpAddress,
  fetchPublicHtml,
} from "../src/core/url-fetch";

test("normalizePublicHttpUrl canonicalizes host and removes fragment", () => {
  const result = normalizePublicHttpUrl("https://Example.COM./Path?q=1#frag");
  assert.equal(result.normalized_url, "https://example.com/Path?q=1");
  assert.equal(result.canonical_host, "example.com");
});

test("normalizePublicHttpUrl rejects unsupported schemes and credentials", () => {
  assert.throws(() => normalizePublicHttpUrl("file:///tmp/a.html"), /Only http and https URLs are supported/u);
  assert.throws(() => normalizePublicHttpUrl("https://user:pass@example.com/"), /URL credentials are not supported/u);
});

test("isPublicIpAddress rejects private, loopback, link-local, multicast, unspecified", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:192.168.1.1", "224.0.0.1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  assert.equal(isPublicIpAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
});
```

- [ ] **Step 2: 写 fetch 行为测试**

Append to `tests/url-fetch.test.ts`:

```ts
async function withServer(
  handler: http.RequestListener,
  fn: (url: string) => Promise<void>
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

function localLookup(hostname: string, options: unknown, callback: unknown) {
  const cb = typeof options === "function" ? options : callback;
  const wantsAll =
    typeof options === "object" &&
    options !== null &&
    "all" in options &&
    (options as dns.LookupAllOptions).all === true;

  if (wantsAll) {
    (cb as (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void)(
      null,
      [{ address: "127.0.0.1", family: 4 }]
    );
    return;
  }

  (cb as dns.LookupOneCallback)(null, "127.0.0.1", 4);
}

test("fetchPublicHtml accepts text/html, decodes gzip, and returns decoded entity bytes", async () => {
  await withServer((request, response) => {
    assert.equal(request.headers.cookie, undefined);
    const body = Buffer.from("<!doctype html><html><body>Hello</body></html>", "utf8");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-encoding": "gzip",
    });
    response.end(zlib.gzipSync(body));
  }, async (url) => {
    const result = await fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
      lookup: localLookup,
      allow_private_for_tests: true,
    });
    assert.equal(result.content_type, "text/html; charset=utf-8");
    assert.equal(result.transport_content_encoding, "gzip");
    assert.equal(result.decoded_html, "<!doctype html><html><body>Hello</body></html>");
    assert.deepEqual(result.decoded_entity_bytes, Buffer.from(result.decoded_html, "utf8"));
  });
});

test("fetchPublicHtml rejects non html media types", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/xhtml+xml" });
    response.end("<html/>");
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup,
          allow_private_for_tests: true,
        }),
      /Only text\/html is supported/u
    );
  });
});

test("fetchPublicHtml rejects when any DNS candidate is non-public", async () => {
  function mixedLookup(hostname: string, options: unknown, callback: unknown) {
    const cb = typeof options === "function" ? options : callback;
    const wantsAll =
      typeof options === "object" &&
      options !== null &&
      "all" in options &&
      (options as dns.LookupAllOptions).all === true;

    if (wantsAll) {
      (cb as (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void)(
        null,
        [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ]
      );
      return;
    }

    (cb as dns.LookupOneCallback)(null, "93.184.216.34", 4);
  }

  await assert.rejects(
    () => fetchPublicHtml("https://example.com/article", { lookup: mixedLookup }),
    /non-public IP address/u
  );
});

test("fetchPublicHtml revalidates redirect targets", async () => {
  await withServer((_request, response) => {
    response.writeHead(302, { location: "https://user:pass@example.com/secret" });
    response.end();
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup,
          allow_private_for_tests: true,
        }),
      /URL credentials are not supported/u
    );
  });
});
```

- [ ] **Step 3: 运行 URL fetch 测试确认失败**

Run:

```bash
npx tsx --test tests/url-fetch.test.ts
```

Expected:

```text
FAIL Cannot find module '../src/core/url-fetch'
```

- [ ] **Step 4: 实现 URL fetch API**

Create `src/core/url-fetch.ts` with these exported shapes:

```ts
import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as zlib from "node:zlib";
import { Transform } from "node:stream";
import { domainToASCII } from "node:url";

export const MAX_WIRE_BYTES = 6 * 1024 * 1024;
export const MAX_DECODED_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

export interface NormalizedPublicUrl {
  original_url: string;
  normalized_url: string;
  canonical_host: string;
}

export interface FetchPublicHtmlOptions {
  lookup?: typeof dns.lookup;
  allow_private_for_tests?: boolean;
  accept_language?: string;
}

export interface FetchedPublicHtml {
  original_url: string;
  normalized_url: string;
  final_url: string;
  fetch_status: number;
  content_type: string;
  transport_content_encoding: string | null;
  decoded_content_length: number;
  original_content_length: number | null;
  decoded_entity_bytes: Buffer;
  decoded_html: string;
  charset: string;
  warnings: string[];
}
```

Implementation requirements:

```ts
export function normalizePublicHttpUrl(input: string): NormalizedPublicUrl {
  const parsed = new URL(input);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL credentials are not supported.");
  }
  const canonicalHost = domainToASCII(parsed.hostname).toLowerCase().replace(/\.+$/u, "");
  if (!canonicalHost) {
    throw new Error("URL host is invalid.");
  }
  parsed.hostname = canonicalHost;
  parsed.hash = "";
  return {
    original_url: input,
    normalized_url: parsed.toString(),
    canonical_host: canonicalHost,
  };
}
```

Add `isPublicIpAddress(address: string): boolean` using `net.isIP`, IPv4 integer ranges, IPv6 loopback/unique-local/link-local/multicast/unspecified checks, and IPv4-mapped IPv6 recursion.

Add `fetchPublicHtml(url, options)` with these invariants:

- Resolve `canonical_host` using `dns.lookup(host, { all: true })`.
- Reject if any resolved address is non-public unless `allow_private_for_tests` is true.
- Pin the actual socket lookup to one verified address; set HTTPS `servername` to `canonical_host`.
- Follow redirects manually up to `MAX_REDIRECTS`; parse relative `Location` against current URL; re-run normalization and DNS/IP validation per hop.
- Send only `User-Agent`, `Accept`, `Accept-Encoding: gzip, br, deflate, identity`, and optional `Accept-Language`.
- Reject status outside `200..299`.
- Parse `content-type` media type by taking the lowercased text before `;`; accept only `text/html`.
- Stream-count wire bytes and decoded bytes; destroy stream immediately when exceeding limits.
- Support `gzip`, `br`, `deflate`, `identity`; reject every other `content-encoding`.
- Return decoded entity bytes and UTF-8 JS string from the charset detection rules in Task 3.

- [ ] **Step 5: 验证 Task 2**

Run:

```bash
npx tsx --test tests/url-fetch.test.ts
```

Expected:

```text
pass
```

### Task 3: Charset 和 Manifest normalization

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/core/source-registry.ts`
- Modify: `tests/source-registry.test.ts`
- Modify: `tests/url-fetch.test.ts`

- [ ] **Step 1: 扩展类型**

Modify `src/types/index.ts`:

```ts
export type SourceOrigin = "file" | "url";

export interface UrlSourceMetadata {
  original_url: string;
  normalized_url: string;
  final_url: string;
  captured_at: string;
  defuddle_version: string;
  fetch_status: number;
  content_type: string;
  transport_content_encoding: string | null;
  decoded_content_length: number;
  title: string | null;
  description: string | null;
  site: string | null;
  author: string | null;
  published: string | null;
  language: string | null;
  image: string | null;
  favicon: string | null;
  word_count: number | null;
  original_content_length: number | null;
}

export interface SourceConversionMetadata {
  required: boolean;
  converter: "none" | "plaintext" | "markitdown" | "defuddle";
  converter_version?: string;
  disabled_features: string[];
  warnings?: string[];
}

export interface Manifest {
  source_id: string;
  source_locator: string;
  source_origin: SourceOrigin;
  source_kind: SourceKind;
  content_hash: string;
  canonical_path: string;
  file_name: string;
  ingest_status: "registered" | "ingested" | "failed";
  created_at: string;
  original_path?: string;
  original_file_name?: string;
  original_extension?: string;
  original_content_hash?: string;
  converted_path?: string;
  converted_content_hash?: string;
  conversion?: SourceConversionMetadata;
  url_metadata?: UrlSourceMetadata;
  extraction_path?: string;
  extraction_content_hash?: string;
}
```

- [ ] **Step 2: 新增 normalization 测试**

Append to `tests/source-registry.test.ts`:

```ts
import { loadSourceManifest, listRegisteredManifests, normalizeManifest } from "../src/core/source-registry";

test("registerSourceFile writes source_origin file and manifest readers normalize legacy manifests", () => {
  const kbRoot = makeWorkspace();
  const sourcePath = path.join(kbRoot, "input.md");
  fs.writeFileSync(sourcePath, "# Title\n", "utf8");

  const result = registerSourceFile({ file_path: sourcePath }, { kb_root: kbRoot });
  assert.equal(result.manifest.source_origin, "file");
  assert.equal(loadSourceManifest(result.source_id, { kb_root: kbRoot }).source_origin, "file");

  const legacy = { ...result.manifest };
  delete (legacy as { source_origin?: string }).source_origin;
  assert.equal(normalizeManifest(legacy).source_origin, "file");
  fs.writeFileSync(
    path.join(kbRoot, "state", "manifests", `${result.source_id}.json`),
    JSON.stringify(legacy, null, 2),
    "utf8"
  );
  assert.equal(loadSourceManifest(result.source_id, { kb_root: kbRoot }).source_origin, "file");
  assert.equal(listRegisteredManifests({ kb_root: kbRoot })[0]?.source_origin, "file");
});
```

- [ ] **Step 3: 新增 charset 测试**

Append to `tests/url-fetch.test.ts`:

```ts
test("fetchPublicHtml decodes windows-1252 when declared", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=windows-1252" });
    response.end(Buffer.from([0x3c, 0x70, 0x3e, 0x93, 0x48, 0x69, 0x94, 0x3c, 0x2f, 0x70, 0x3e]));
  }, async (url) => {
    const result = await fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
      lookup: localLookup,
      allow_private_for_tests: true,
    });
    assert.equal(result.decoded_html, "<p>“Hi”</p>");
  });
});

test("fetchPublicHtml warns when charset is missing and utf8 succeeds", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<p>Hi</p>");
  }, async (url) => {
    const result = await fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
      lookup: localLookup,
      allow_private_for_tests: true,
    });
    assert.deepEqual(result.warnings, ["charset_missing_assumed_utf8"]);
  });
});
```

- [ ] **Step 4: 实现 normalization**

Modify `src/core/source-registry.ts`:

```ts
type PersistedManifest = Omit<Manifest, "source_origin"> & {
  source_origin?: Manifest["source_origin"];
};

export function normalizeManifest(manifest: PersistedManifest): Manifest {
  return {
    ...manifest,
    source_origin: manifest.source_origin ?? "file",
  };
}
```

Use `normalizeManifest()` in `listRegisteredManifests()` and `loadSourceManifest()` immediately after `JSON.parse()`. Add `source_origin: "file"` in the manifest built by `registerSourceFile()`.

- [ ] **Step 5: 实现 charset**

In `src/core/url-fetch.ts`, add:

```ts
export type SupportedCharset = "utf-8" | "us-ascii" | "windows-1252" | "iso-8859-1";
```

Detection order:

1. UTF-8 BOM wins and strips BOM.
2. UTF-16/UTF-32 BOM throws `Unsupported charset`.
3. `Content-Type` charset.
4. First 4096 bytes `<meta charset>`.
5. First 4096 bytes `<meta http-equiv="content-type" ... charset=...>`.
6. Missing charset uses fatal UTF-8 and adds `charset_missing_assumed_utf8`.

Decode implementation:

- `utf-8`: `new TextDecoder("utf-8", { fatal: true }).decode(bufferWithoutBom)`.
- `us-ascii`: fail if any byte is greater than `0x7f`, then decode as UTF-8.
- `windows-1252` and `iso-8859-1`: `new TextDecoder(label, { fatal: true }).decode(buffer)`.

- [ ] **Step 6: 验证 Task 3**

Run:

```bash
npx tsx --test tests/source-registry.test.ts tests/url-fetch.test.ts
```

Expected:

```text
pass
```

### Task 4: URL source 注册与 `kb_url_add`

**Files:**
- Create: `src/core/url-source.ts`
- Create: `src/tools/kb_url_add.ts`
- Modify: `src/runtime/kb_tool_args.ts`
- Modify: `src/runtime/kb_tool_runtime.ts`
- Modify: `src/runtime/kb_tool_contract.ts`
- Modify: `src/index.ts`
- Create: `tests/url-source.test.ts`
- Modify: `tests/source-registry.test.ts`

- [ ] **Step 1: 写 URL source 测试**

Create `tests/url-source.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { registerUrlSource, escapeProvenanceValue, buildUrlDisplayBase } from "../src/core/url-source";
import type { FetchedPublicHtml } from "../src/core/url-fetch";
import type { DefuddleParseResult } from "../src/core/defuddle-parser";

function makeWorkspace(prefix = "kb-url-source-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fetched(overrides: Partial<FetchedPublicHtml> = {}): FetchedPublicHtml {
  const html = Buffer.from("<!doctype html><html><body><h1>Hello</h1></body></html>", "utf8");
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
  assert.equal(escapeProvenanceValue("a-b 100% 你\n"), "a%2Db 100%25 %E4%BD%A0%0A");
});

test("buildUrlDisplayBase ignores query and produces stable lowercase base", () => {
  assert.equal(
    buildUrlDisplayBase("https://Example.com/docs/My%20Article.html?x=1"),
    "example.com-my-article"
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

  const canonical = fs.readFileSync(path.join(kbRoot, result.manifest.canonical_path), "utf8");
  assert.match(canonical, /^<!-- kb-source-provenance:v1\n/u);
  assert.match(canonical, /source_origin: url\n/u);
  assert.match(canonical, /original_url: https:\/\/Example\.com\/path\/article\.html\?x=1%23frag\n/u);
  assert.match(canonical, /\n-->\n\n# Hello\n\nWorld\n$/u);

  const original = fs.readFileSync(path.join(kbRoot, result.manifest.original_path ?? ""));
  assert.deepEqual(original, fetched().decoded_entity_bytes);

  const extraction = JSON.parse(
    fs.readFileSync(path.join(kbRoot, result.manifest.extraction_path ?? ""), "utf8")
  );
  assert.equal(extraction.schema_version, 1);
  assert.equal(extraction.source_origin, "url");
  assert.equal(extraction.metadata.title, "Hello");
});
```

- [ ] **Step 2: 写 runtime tool 测试**

Append to `tests/url-source.test.ts`:

```ts
import { validateKbToolArgs } from "../src/runtime/kb_tool_args";
import { KB_CANONICAL_TOOL_NAMES } from "../src/runtime/kb_tool_contract";

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
```

- [ ] **Step 3: 运行 URL source 测试确认失败**

Run:

```bash
npx tsx --test tests/url-source.test.ts
```

Expected:

```text
FAIL Cannot find module '../src/core/url-source'
```

- [ ] **Step 4: 实现 `src/core/url-source.ts` public API**

Create exports:

```ts
export interface RegisterUrlSourceInput {
  url: string;
  accept_language?: string;
}

export interface RegisterUrlSourceResult {
  source_id: string;
  content_hash: string;
  canonical_path: string;
  file_name: string;
  title: string | null;
  description: string | null;
  word_count: number | null;
  manifest: Manifest;
}
```

Implement helpers:

```ts
export function escapeProvenanceValue(value: string): string {
  let out = "";
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint !== undefined &&
      codePoint >= 0x20 &&
      codePoint <= 0x7e &&
      char !== "%" &&
      char !== "-"
    ) {
      out += char;
      continue;
    }
    for (const byte of Buffer.from(char, "utf8")) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function normalizeMarkdownBody(markdown: string): string {
  return `${markdown.replace(/\r\n?/gu, "\n").trimEnd()}\n`;
}
```

Implement display base:

- Input is `normalized_url`.
- `hostPart` is canonical host.
- `leaf` is decoded last pathname segment; empty uses `index`.
- Strip `.html`, `.htm`, `.xhtml`.
- `rawBase = hostPart + "-" + leaf`.
- Lowercase, replace every char outside `[a-z0-9._-]` with `-`, collapse `-+`, trim `-`.
- If empty use `url-source`.
- If longer than 96 chars, keep first 80 chars and append `-` plus first 12 chars of normalized URL sha256.

Implement provenance:

```md
<!-- kb-source-provenance:v1
source_origin: url
content_hash: <sha256:...>
original_url: <escaped original_url>
normalized_url: <escaped normalized_url>
final_url: <escaped final_url>
-->

<contentMarkdown normalized to LF and exactly one trailing newline>
```

- [ ] **Step 5: 实现 extraction JSON 裁剪**

In `src/core/url-source.ts`, implement stable JSON with these exact top-level keys:

```ts
{
  schema_version: 1,
  source_origin: "url",
  normalized_url,
  final_url,
  defuddle_version,
  metadata: {
    title,
    description,
    site,
    author,
    published,
    language,
    image,
    favicon,
    word_count,
    parse_time_ms
  },
  content_html,
  content_markdown,
  truncation
}
```

Apply size policy before writing:

- Max final UTF-8 bytes including trailing newline: `262144`.
- First set `content_html = null` and add warning `extraction_content_html_omitted_for_size`.
- Then truncate `content_markdown` to 64 KiB character budget and append `...[TRUNCATED]`, adding `extraction_content_markdown_truncated_for_size`.
- Then truncate `metadata.description` to 2048 characters and append `...[TRUNCATED]`, adding `extraction_metadata_description_truncated_for_size`.
- If still oversized, throw and write no extraction/manifest/canonical/original files.

- [ ] **Step 6: 实现 `registerUrlSource()`**

Implementation sequence:

1. `fetchPublicHtml(input.url, { accept_language: input.accept_language })`.
2. Hash `fetched.decoded_entity_bytes` and generate `source_id` using the same collision-prefix policy as file source.
3. Duplicate detection checks `manifest.content_hash` and `manifest.original_content_hash`.
4. `parseHtmlWithDefuddle({ html: fetched.decoded_html, final_url: fetched.final_url })`.
5. Build canonical Markdown from provenance plus `parsed.content_markdown`.
6. Write `raw/inbox/{source_id}.md`, `raw/originals/{source_id}.html`, `state/extractions/{source_id}.defuddle.json`, and `state/manifests/{source_id}.json`.
7. Return `title`, `description`, `word_count` keys even when values are null.

Manifest requirements:

```ts
{
  source_origin: "url",
  source_kind: "converted_markdown",
  content_hash,
  file_name: `${base}.md`,
  original_path: `raw/originals/${source_id}.html`,
  original_file_name: `${base}.html`,
  original_extension: ".html",
  original_content_hash: content_hash,
  converted_path: canonical_path,
  converted_content_hash,
  extraction_path,
  extraction_content_hash,
  conversion: {
    required: true,
    converter: "defuddle",
    converter_version: "0.18.1",
    disabled_features: ["authenticated", "javascript", "private-network", "async-third-party"],
    warnings
  },
  url_metadata: {
    original_url,
    normalized_url,
    final_url,
    captured_at,
    defuddle_version,
    fetch_status,
    content_type,
    transport_content_encoding,
    decoded_content_length,
    title,
    description,
    site,
    author,
    published,
    language,
    image,
    favicon,
    word_count,
    original_content_length
  }
}
```

- [ ] **Step 7: 实现 tool handler 和 runtime 注册**

Create `src/tools/kb_url_add.ts`:

```ts
import type { ToolResult, WorkspaceConfig } from "../types";
import { registerUrlSource, type RegisterUrlSourceInput, type RegisterUrlSourceResult } from "../core/url-source";

export async function kbUrlAdd(
  input: RegisterUrlSourceInput,
  config: WorkspaceConfig
): Promise<ToolResult<RegisterUrlSourceResult>> {
  try {
    return { success: true, data: await registerUrlSource(input, config) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

Modify runtime:

- `src/runtime/kb_tool_contract.ts`: insert `kb_url_add` immediately after `kb_source_add`; keep `kb_read_source` third.
- `src/runtime/kb_tool_args.ts`: accept `{ url: string, accept_language?: string }`.
- `src/runtime/kb_tool_runtime.ts`: import and dispatch `kbUrlAdd`.
- `src/index.ts`: export `kbUrlAdd`, `registerUrlSource`, URL fetch and Defuddle parser APIs.

- [ ] **Step 8: 验证 Task 4**

Run:

```bash
npx tsx --test tests/url-source.test.ts tests/source-registry.test.ts
npm run test:url-ingest
```

Expected:

```text
pass
```

### Task 5: OpenClaw installer、skill、文档和工具契约同步

**Files:**
- Modify: `skills/kb_ingest/SKILL.md`
- Modify: `src/openclaw-installer/skills.ts`
- Modify: `src/openclaw-installer/workspace-docs.ts`
- Modify: `src/openclaw-installer/manifest.ts`
- Modify: `src/openclaw-installer/session-runtime-artifact.ts`
- Modify: `src/openclaw-installer/session-runtime-probe.ts`
- Modify: `src/openclaw-installer/mcp-probe.ts`
- Modify: `tests/openclaw-installer-substrate.test.ts`
- Modify: `README.md`
- Modify: `docs/technical.md`
- Modify: `openspec/specs/openclaw-agent-kb-tool-availability/spec.md`
- Modify: `src/mcp_server.ts`

- [ ] **Step 1: 写 installer substrate 失败断言**

Modify `tests/openclaw-installer-substrate.test.ts` to assert:

```ts
assert.deepEqual(EXPECTED_KB_TOOL_NAMES.slice(0, 4), [
  "kb_source_add",
  "kb_url_add",
  "kb_ingest_finalize",
  "kb_read_source",
]);

assertContains(tools, "## KB MCP Tools (14)", "TOOLS.md");
assertContains(tools, "`kb_url_add`", "TOOLS.md");
assertContains(tools, "public HTTP/HTTPS URL", "TOOLS.md");
assertNotContains(tools, "raw source content", "TOOLS.md");
assertContains(tools, "canonical Markdown source content", "TOOLS.md");
```

- [ ] **Step 2: 运行 substrate 测试确认失败**

Run:

```bash
npx tsx --test tests/openclaw-installer-substrate.test.ts
```

Expected:

```text
FAIL
```

- [ ] **Step 3: 修改 installer 与 skill**

Requirements:

- Skill tool list includes `kb_url_add` after `kb_source_add`.
- `kb_read_source` wording is `canonical Markdown source content`.
- Installer-generated manifest/probe/artifact preserve `KB_CANONICAL_TOOL_NAMES` order.
- No local hand-written tool list drifts from `KB_TOOL_DEFINITIONS`.
- Any `sort()` usage is limited to diagnostic error messages, not persisted or compared contract values.

- [ ] **Step 4: 修改 README、technical docs、openspec 和 MCP comment**

Document:

- `kb_url_add({ url, accept_language? })` registers public URL as canonical Markdown source.
- URL limits: public `http/https`, `text/html`, no credentials/cookies; private-network DNS/address targets are blocked by default. When trusted fake-ip proxy DNS mode is explicitly enabled (`KB_URL_FETCH_TRUSTED_PROXY_DNS=1` or case-insensitive `true`), only trusted fake-ip CIDR candidates are allowed and must pass external public DNS verification; no JS-only SPA, no XHTML, 5 redirects, decoded 5 MiB, wire 6 MiB.
- Defuddle conversion writes original decoded HTML under `raw/originals`, canonical Markdown under `raw/inbox`, extraction JSON under `state/extractions`.

- [ ] **Step 5: 验证 Task 5**

Run:

```bash
npx tsx --test tests/openclaw-installer-substrate.test.ts
npm run build
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_openclaw_plugin_surface.ts
```

Expected:

```text
pass
```

### Task 6: 校验脚本和 dist surface

**Files:**
- Modify: `scripts/validate_openclaw_plugin_surface.ts`
- Modify: `scripts/validate_kb_tool_contract_baseline.ts`
- Create: `scripts/validate_mcp_dist_surface.ts`
- Modify: `package.json`

- [ ] **Step 1: 写 dist MCP surface 校验脚本**

Create `scripts/validate_mcp_dist_surface.ts`:

```ts
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  KB_CANONICAL_TOOL_NAMES,
  KB_TOOL_DEFINITIONS,
} from "../src/runtime/kb_tool_contract";

function main(): void {
  const contract = require(path.join(
    process.cwd(),
    "dist",
    "runtime",
    "kb_tool_contract.js"
  )) as typeof import("../src/runtime/kb_tool_contract");
  const runtime = require(path.join(
    process.cwd(),
    "dist",
    "runtime",
    "kb_tool_runtime.js"
  )) as typeof import("../src/runtime/kb_tool_runtime");

  assert.deepEqual(contract.KB_CANONICAL_TOOL_NAMES, KB_CANONICAL_TOOL_NAMES);
  assert.deepEqual(
    contract.KB_TOOL_DEFINITIONS.map((tool) => tool.name),
    KB_TOOL_DEFINITIONS.map((tool) => tool.name)
  );
  assert.deepEqual(
    runtime.listKbToolsResponse().tools.map((tool) => tool.name),
    KB_CANONICAL_TOOL_NAMES
  );
}

main();
```

- [ ] **Step 2: 修改 baseline 和 plugin surface 校验**

Requirements:

- `scripts/validate_kb_tool_contract_baseline.ts` imports `KB_TOOL_DEFINITIONS` / `KB_CANONICAL_TOOL_NAMES` from `src/runtime/kb_tool_contract.ts` and compares MCP live tool names/descriptions/schemas against those exported definitions.
- `scripts/validate_openclaw_plugin_surface.ts` loads built `dist/runtime/kb_tool_contract.js` and treats `KB_CANONICAL_TOOL_NAMES` as expected order; it must not contain a separate hand-written `expectedCanonicalToolNames`.
- `src/openclaw-installer/manifest.ts` must stop sorting `KB_CANONICAL_TOOL_NAMES`; `expectedCanonicalTools` should preserve the declared canonical order.
- Installer/probe/session-runtime validation may sort names only inside diagnostic error message formatting.

Add this regression assertion in `tests/openclaw-installer-substrate.test.ts`:

```ts
import { KB_CANONICAL_TOOL_NAMES } from "../src/runtime/kb_tool_contract";

assert.deepEqual(EXPECTED_KB_TOOL_NAMES, KB_CANONICAL_TOOL_NAMES);
assert.deepEqual(EXPECTED_KB_TOOL_NAMES.slice(0, 4), [
  "kb_source_add",
  "kb_url_add",
  "kb_ingest_finalize",
  "kb_read_source",
]);
```

Keep the second assertion to detect alphabetical sorting regressions.

- [ ] **Step 3: 修改 `package.json` 脚本**

Add or update scripts:

```json
{
  "test:url-ingest": "tsx --test tests/url-fetch.test.ts tests/defuddle-parser.test.ts tests/url-source.test.ts",
  "validate:defuddle-dist-smoke": "npx tsx --tsconfig tsconfig.scripts.json scripts/validate_defuddle_dist_smoke.ts",
  "validate:mcp-dist-surface": "npx tsx --tsconfig tsconfig.scripts.json scripts/validate_mcp_dist_surface.ts"
}
```

- [ ] **Step 4: 验证 Task 6**

Run:

```bash
npm run build
npm run validate:defuddle-dist-smoke
npm run validate:mcp-dist-surface
npm run validate:plugin-surface
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_tool_contract_baseline.ts
```

Expected:

```text
pass
```

### Task 7: 真实 URL 转 Markdown 外部验收

**Files:**
- Create: `scripts/fixtures/url-real-ingest-urls.txt`
- Create: `scripts/validate_url_real_ingest.ts`
- Modify: `package.json`

- [ ] **Step 1: 写真实 URL fixture**

Create `scripts/fixtures/url-real-ingest-urls.txt`:

```text
# Relatively stable public pages
https://tinylab.org/riscv-uefi-part1/
https://arxiv.org/html/2505.06120v1
https://liduos.com/the-memeber-newsletter-54.html
https://glama.ai/blog/2025-06-01-what-is-nlweb
https://simonwillison.net/2025/May/25/claude-4-system-prompt/
https://newsletter.pragmaticengineer.com/p/cursor?utm_source=substack&utm_medium=email
https://zh-cn.extendoffice.com/excel/formulas/excel-extract-file-extension.html
https://lilianweng.github.io/posts/2025-05-01-thinking/

# WeChat / anti-bot / tokenized pages: report per-URL result, do not require every URL to pass.
https://mp.weixin.qq.com/s/epFv8gp6zeCH-S8yh634vg?scene=1
https://mp.weixin.qq.com/s/8QY-EDEw4nr-NGmNxv752A?clicktime=1753262534&enterid=1753262534&scene=90&subscene=236&xtrack=1
https://mp.weixin.qq.com/s/6-jp5auGjdk7kQN-I0zRWQ
https://mp.weixin.qq.com/s/2n2uMTUeOVZlwQuf4d5rSg
https://mp.weixin.qq.com/s?__biz=MzkxNTY3OTEwNQ==&mid=2247498735&idx=1&sn=319585c2cbd54346d372830143ef1b16&chksm=c0e249b8dd6cd6af30761ad011e3677c980594440321941e8f77958f220e824a61c2c432599e#rd
https://mp.weixin.qq.com/s?__biz=MjM5MDE0Mjc4MA==&mid=2651246577&idx=2&sn=e26bfdbfc2e5f423f9c1bcb9285e4dd6
https://semianalysis.com/2025/06/11/the-new-ai-networks-ultra-ethernet-uec-ualink-vs-broadcom-scale-up-ethernet-sue/?access_token=[REDACTED]
https://mp.weixin.qq.com/s/QtASVIfRJTkfi71Jdst-ZA?scene=1
```

- [ ] **Step 2: 写真实 URL 验收脚本**

Create `scripts/validate_url_real_ingest.ts`:

```ts
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { registerUrlSource } from "../src/core/url-source";
import { readRegisteredSource } from "../src/core/source-registry";

async function main(): Promise<void> {
  if (process.env.RUN_URL_REAL_INGEST !== "1") {
    console.log("Skipping real URL ingest validation. Set RUN_URL_REAL_INGEST=1 to run.");
    return;
  }

  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "url-real-ingest-urls.txt");
  const urls = fs
    .readFileSync(fixturePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-real-url-ingest-"));
  const results: Array<{
    url: string;
    ok: boolean;
    source_id?: string;
    title?: string | null;
    markdown_bytes?: number;
    error?: string;
  }> = [];

  for (const url of urls) {
    try {
      const registered = await registerUrlSource({ url }, { kb_root: kbRoot });
      const source = readRegisteredSource(registered.source_id, { kb_root: kbRoot }, {
        max_bytes: 1024 * 1024,
      });
      assert.equal(source.source_kind, "converted_markdown");
      assert.match(source.content, /^<!-- kb-source-provenance:v1\n/u);
      assert.match(source.content, /\n-->\n\n/u);
      assert.ok(source.content.replace(/^<!--[\s\S]*?-->\n\n/u, "").trim().length > 0);
      results.push({
        url,
        ok: true,
        source_id: registered.source_id,
        title: registered.title,
        markdown_bytes: Buffer.byteLength(source.content, "utf8"),
      });
    } catch (error) {
      results.push({
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(JSON.stringify({ kbRoot, results }, null, 2));

  const successes = results.filter((result) => result.ok);
  if (successes.length === 0) {
    throw new Error("No real URL was converted to Markdown.");
  }

  const hardFailures = results.filter(
    (result) =>
      !result.ok &&
      !/(403|401|429|timeout|Too many redirects|Only text\/html|Unsupported charset|Defuddle returned empty Markdown|certificate|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)/iu.test(
        result.error ?? ""
      )
  );

  if (hardFailures.length > 0) {
    throw new Error(`Unexpected real URL ingest failures: ${hardFailures.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

This script deliberately allows access-control, anti-bot, expired token, network timeout, non-HTML, unsupported charset, and empty extraction failures to be reported without failing the whole external validation, while still requiring at least one successful URL-to-Markdown conversion.

- [ ] **Step 3: 新增脚本别名**

Modify `package.json`:

```json
{
  "validate:url-real-ingest": "RUN_URL_REAL_INGEST=1 npx tsx --tsconfig tsconfig.scripts.json scripts/validate_url_real_ingest.ts",
  "validate:url-real-ingest:skip-ok": "npx tsx --tsconfig tsconfig.scripts.json scripts/validate_url_real_ingest.ts"
}
```

- [ ] **Step 4: 运行真实 URL 转 Markdown 验收**

Run:

```bash
npm run validate:url-real-ingest
```

Expected:

```text
JSON summary with at least one result where ok is true, markdown_bytes is greater than 0, and source_id is present.
```

- [ ] **Step 5: 运行显式 skip-ok 模式**

Run:

```bash
npm run validate:url-real-ingest:skip-ok
```

Expected:

```text
Skipping real URL ingest validation. Set RUN_URL_REAL_INGEST=1 to run.
```

### Task 8: 最终验证和工作树清理

**Files:**
- Verify all changed files
- Remove: `defuddle-0.18.1.tgz` if it still exists and was produced by local dependency investigation

- [ ] **Step 1: 运行完整硬性验收链（默认验证，不访问外网）**

Run:

```bash
npm run build &&
npm run test:url-ingest &&
npm run validate:defuddle-dist-smoke &&
npm run validate:mcp-dist-surface &&
npm run validate:plugin-surface &&
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_tool_contract_baseline.ts
```

Expected:

```text
all commands exit 0
```

- [ ] **Step 2: 运行真实 URL 外部验收（best-effort 访问外网）**

Run:

```bash
RUN_URL_REAL_INGEST=1 npm run validate:url-real-ingest
```

Expected:

```text
JSON summary includes at least one successful URL-to-Markdown conversion. Access-control, anti-bot, expired token, timeout, and non-HTML failures are listed per URL and do not write to repository kb/.
```

- [ ] **Step 3: 清理本地调研产物**

Run:

```bash
rm -f defuddle-0.18.1.tgz
git status --short
```

Expected:

```text
Only intentional source, test, script, docs, package, and lockfile changes remain.
```

## 自检清单

- [ ] `kb_url_add` 是独立工具，`kb_source_add` 仍拒绝 URL。
- [ ] `KB_CANONICAL_TOOL_NAMES.slice(0, 4)` 固定为 `kb_source_add`、`kb_url_add`、`kb_ingest_finalize`、`kb_read_source`。
- [ ] Defuddle 通过 `.mjs` bridge 使用 `{ separateMarkdown: true, useAsync: false }`，只接受 `contentMarkdown`。
- [ ] fetch 层不读取代理环境变量，不发送 cookies/auth，所有 DNS 候选 IP 和每跳 redirect 都经过 public-web 校验。
- [ ] raw original、manifest hash、canonical Markdown provenance、extraction JSON 的 hash 语义一致。
- [ ] 旧 manifest 缺失 `source_origin` 时对上层暴露为 `"file"`。
- [ ] OpenClaw installer、session runtime、MCP probe、skill 文案和 docs 使用同一 canonical tool order。
- [ ] 真实 URL 验收写临时 KB，并输出逐 URL 结果。
