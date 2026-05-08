import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readRegisteredSource } from "../src/core/source-registry";
import { registerUrlSource } from "../src/core/url-source";
import { fetchPublicHtml } from "../src/core/url-fetch";

interface UrlIngestResult {
  url: string;
  ok: boolean;
  source_id?: string;
  title?: string | null;
  markdown_bytes?: number;
  error?: string;
  error_name?: string;
  error_code?: string;
  allowed_failure?: boolean;
}

const trustedProxyDnsEnv = process.env.KB_URL_FETCH_TRUSTED_PROXY_DNS;
const trustedProxyDnsEnabled =
  trustedProxyDnsEnv === "1" || trustedProxyDnsEnv?.toLowerCase() === "true";
const trustedProxyCidrsRaw = process.env.KB_URL_FETCH_TRUSTED_PROXY_CIDRS?.trim();
const resolver = trustedProxyDnsEnabled ? "system-dns+trusted-proxy-dns" : "system-dns";
const credentialQueryParams = new Set([
  "access_token",
  "accesstoken",
  "auth_token",
  "authtoken",
  "id_token",
  "idtoken",
  "refresh_token",
  "refreshtoken",
  "bearer_token",
  "bearertoken",
  "api_key",
  "apikey",
  "client_secret",
  "clientsecret",
  "password",
  "token",
  "signature",
  "sig",
  "awsaccesskeyid",
  "code",
]);
const credentialQueryPatterns = [
  "token",
  "secret",
  "password",
  "passwd",
  "signature",
  "apikey",
  "api_key",
  "accesskey",
  "access_key",
  "session",
  "credential",
  "auth",
  "bearer",
] as const;

function readFixtureUrls(fixturePath: string): string[] {
  return fs
    .readFileSync(fixturePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function redactSummaryUrl(input: string): string {
  try {
    const parsed = new URL(input);
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase();
      const normalized = lower.replace(/-/gu, "_");
      const compact = lower.replace(/[-_]/gu, "");
      if (
        credentialQueryParams.has(lower) ||
        credentialQueryParams.has(normalized) ||
        credentialQueryParams.has(compact) ||
        lower.startsWith("x-amz-") ||
        credentialQueryPatterns.some(
          (pattern) =>
            lower.includes(pattern) ||
            normalized.includes(pattern) ||
            compact.includes(pattern)
        )
      ) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return parsed.toString();
  } catch {
    return input;
  }
}

function assertCanonicalMarkdown(sourceKind: string, content: string): void {
  assert.equal(sourceKind, "converted_markdown");
  assert.match(content, /^<!-- kb-source-provenance:v1\n/u);
  assert.match(content, /\n-->\n\n/u);
  assert.ok(content.replace(/^<!--[\s\S]*?-->\n\n/u, "").trim().length > 0);
}

function getErrorCode(error: Error): string | undefined {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : undefined;
}

function isAllowedExternalFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    error.name === "TypeError" ||
    error.name === "AssertionError"
  ) {
    return false;
  }

  const code = getErrorCode(error);
  if (code && /^(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)$/u.test(code)) {
    return true;
  }
  if (code && /CERT|TLS|UNABLE_TO|SELF_SIGNED/u.test(code)) {
    return true;
  }

  return (
    /^Unexpected HTTP status (400|401|403|404|410|429)\.$/u.test(error.message) ||
    /^URL fetch timed out after \d+ms\.$/u.test(error.message) ||
    /^Too many redirects; maximum is \d+\.$/u.test(error.message) ||
    error.message === "Only text/html is supported." ||
    /^Unsupported charset: .+$/u.test(error.message) ||
    error.message === "Defuddle returned empty Markdown." ||
    error.message === "URL query credentials are not supported." ||
    /certificate/iu.test(error.message)
  );
}

async function main(): Promise<void> {
  if (process.env.RUN_URL_REAL_INGEST !== "1") {
    console.log("Skipping real URL ingest validation. Set RUN_URL_REAL_INGEST=1 to run.");
    return;
  }

  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "url-real-ingest-urls.txt");
  const urls = readFixtureUrls(fixturePath);
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-real-url-ingest-"));
  const results: UrlIngestResult[] = [];

  for (const url of urls) {
    const summaryUrl = redactSummaryUrl(url);
    try {
      const registered = await registerUrlSource({ url }, { kb_root: kbRoot }, { fetchHtml: fetchPublicHtml });
      const source = readRegisteredSource(registered.source_id, { kb_root: kbRoot }, {
        max_bytes: 1024 * 1024,
      });
      assertCanonicalMarkdown(source.source_kind, source.content);
      results.push({
        url: summaryUrl,
        ok: true,
        source_id: registered.source_id,
        title: registered.title,
        markdown_bytes: Buffer.byteLength(source.content, "utf8"),
      });
    } catch (error) {
      const allowedFailure = isAllowedExternalFailure(error);
      results.push({
        url: summaryUrl,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        error_name: error instanceof Error ? error.name : undefined,
        error_code: error instanceof Error ? getErrorCode(error) : undefined,
        allowed_failure: allowedFailure,
      });
    }
  }

  const resolver_environment = {
    trusted_proxy_dns_enabled: trustedProxyDnsEnabled,
    trusted_proxy_cidrs: trustedProxyCidrsRaw || "(default 198.18.0.0/15)",
  };
  console.log(JSON.stringify({ kbRoot, resolver, resolver_environment, results }, null, 2));

  const successCount = results.filter((result) => result.ok).length;
  if (successCount === 0) {
    throw new Error("No real URL was converted to Markdown.");
  }

  const hardFailures = results.filter((result) => !result.ok && !result.allowed_failure);

  if (hardFailures.length > 0) {
    throw new Error(`Unexpected real URL ingest failures: ${hardFailures.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
