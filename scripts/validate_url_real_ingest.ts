import assert from "node:assert/strict";
import * as dns from "node:dns";
import * as fs from "node:fs";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { readRegisteredSource } from "../src/core/source-registry";
import { registerUrlSource } from "../src/core/url-source";
import { fetchPublicHtml, isPublicIpAddress } from "../src/core/url-fetch";

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

interface DnsJsonAnswer {
  type?: number;
  data?: string;
}

interface DnsJsonResponse {
  Status?: number;
  Answer?: DnsJsonAnswer[];
}

const resolver = "cloudflare-doh";
const dohCache = new Map<string, Promise<dns.LookupAddress[]>>();
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

const dohLookup = ((hostname: string, options: unknown, callback: unknown): void => {
  const callbackArg = typeof options === "function" ? options : callback;
  const lookupOptions = typeof options === "function" ? undefined : options;
  const cb = callbackArg as Function;
  const singleCallback = cb as (
    error: NodeJS.ErrnoException | null,
    address: string,
    family: 4 | 6
  ) => void;
  const family = getRequestedLookupFamily(lookupOptions);
  const wantsAll =
    typeof lookupOptions === "object" &&
    lookupOptions !== null &&
    "all" in lookupOptions &&
    (lookupOptions as dns.LookupAllOptions).all === true;

  if (!wantsAll) {
    resolveWithDoh(hostname).then(
      (addresses) => {
        try {
          const first = selectLookupAddresses(hostname, addresses, family)[0];
          if (!first) {
            singleCallback(new Error(`DoH lookup returned no addresses for ${hostname}.`), "", 4);
            return;
          }
          if (first.family !== 4 && first.family !== 6) {
            singleCallback(new Error(`DoH lookup returned unsupported family for ${hostname}.`), "", 4);
            return;
          }
          singleCallback(null, first.address, first.family);
        } catch (error) {
          singleCallback(error as NodeJS.ErrnoException, "", 4);
        }
      },
      (error: NodeJS.ErrnoException) => singleCallback(error, "", 4)
    );
    return;
  }

  const allCb = cb as (
    error: NodeJS.ErrnoException | null,
    addresses: dns.LookupAddress[]
  ) => void;
  resolveWithDoh(hostname).then(
    (addresses) => {
      try {
        allCb(null, selectLookupAddresses(hostname, addresses, family));
      } catch (error) {
        allCb(error as NodeJS.ErrnoException, []);
      }
    },
    (error: NodeJS.ErrnoException) => allCb(error, [])
  );
}) as typeof dns.lookup;

function getRequestedLookupFamily(options: unknown): 0 | 4 | 6 {
  if (options === 4 || options === 6) {
    return options;
  }
  if (typeof options === "object" && options !== null && "family" in options) {
    const family = (options as dns.LookupOptions).family;
    if (family === 4 || family === 6) {
      return family;
    }
  }
  return 0;
}

function selectLookupAddresses(
  hostname: string,
  addresses: dns.LookupAddress[],
  family: 0 | 4 | 6
): dns.LookupAddress[] {
  const selected =
    family === 0 ? addresses : addresses.filter((address) => address.family === family);
  if (selected.length === 0) {
    throw new Error(`DoH lookup returned no family ${family} addresses for ${hostname}.`);
  }
  return selected;
}

function resolveWithDoh(hostname: string): Promise<dns.LookupAddress[]> {
  const cached = dohCache.get(hostname);
  if (cached) {
    return cached;
  }

  const promise = resolveWithDohProviders(hostname);
  dohCache.set(hostname, promise);
  return promise;
}

async function resolveWithDohProviders(hostname: string): Promise<dns.LookupAddress[]> {
  const providers = [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/resolve",
  ];
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return await resolveWithDohProvider(provider, hostname);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("DoH returned non-public IP address")) {
        throw error;
      }
      errors.push(message);
    }
  }
  throw new Error(`DoH lookup failed for ${hostname}: ${errors.join("; ")}`);
}

async function resolveWithDohProvider(
  providerUrl: string,
  hostname: string
): Promise<dns.LookupAddress[]> {
  const recordResults = await Promise.allSettled([
    queryDoh(providerUrl, hostname, "A"),
    queryDoh(providerUrl, hostname, "AAAA"),
  ]);
  const nonPublicFailure = recordResults.find(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof Error &&
      result.reason.message.startsWith("DoH returned non-public IP address")
  );
  if (nonPublicFailure?.status === "rejected") {
    throw nonPublicFailure.reason;
  }
  const providerFailure = recordResults.find((result) => result.status === "rejected");
  if (providerFailure?.status === "rejected") {
    throw providerFailure.reason;
  }
  const [aRecords, aaaaRecords] = recordResults.map((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  const addresses = [...aRecords, ...aaaaRecords];
  if (addresses.length === 0) {
    throw new Error(`DoH lookup returned no A/AAAA records for ${hostname}.`);
  }
  return addresses;
}

function queryDoh(
  providerUrl: string,
  hostname: string,
  recordType: "A" | "AAAA"
): Promise<dns.LookupAddress[]> {
  const url = new URL(providerUrl);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", recordType);

  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { Accept: "application/dns-json" }, timeout: 10_000 },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            if (response.statusCode !== 200) {
              reject(new Error(`DoH HTTP status ${response.statusCode ?? "unknown"}.`));
              return;
            }
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as DnsJsonResponse;
            if (parsed.Status !== 0) {
              reject(new Error(`DoH DNS status ${parsed.Status ?? "unknown"}.`));
              return;
            }
            resolve(parseDohAnswers(parsed, recordType));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("DoH lookup timed out.")));
    request.on("error", reject);
  });
}

function parseDohAnswers(
  response: DnsJsonResponse,
  recordType: "A" | "AAAA"
): dns.LookupAddress[] {
  const expectedType = recordType === "A" ? 1 : 28;
  const expectedFamily = recordType === "A" ? 4 : 6;
  const addresses: dns.LookupAddress[] = [];

  for (const answer of response.Answer ?? []) {
    if (answer.type !== expectedType || typeof answer.data !== "string") {
      continue;
    }
    const family = net.isIP(answer.data);
    if (family !== expectedFamily) {
      continue;
    }
    if (!isPublicIpAddress(answer.data)) {
      throw new Error(`DoH returned non-public IP address: ${answer.data}`);
    }
    addresses.push({ address: answer.data, family: expectedFamily });
  }

  return addresses;
}

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
    error.name === "AssertionError" ||
    error.message.startsWith("DoH ") ||
    error.message.includes("non-public IP address")
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
      const registered = await registerUrlSource({ url }, { kb_root: kbRoot }, {
        fetchHtml: (sourceUrl, options) =>
          fetchPublicHtml(sourceUrl, { ...options, lookup: dohLookup }),
      });
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

  console.log(JSON.stringify({ kbRoot, resolver, results }, null, 2));

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
