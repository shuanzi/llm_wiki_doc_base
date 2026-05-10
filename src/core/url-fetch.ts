import * as dns from "node:dns";
import * as net from "node:net";
import { Transform } from "node:stream";
import * as zlib from "node:zlib";
import { domainToASCII } from "node:url";
import http = require("node:http");
import https = require("node:https");

export const MAX_WIRE_BYTES = 6 * 1024 * 1024;
export const MAX_DECODED_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TRUSTED_PROXY_DNS_CIDRS = ["198.18.0.0/15"] as const;
const TRUSTED_PROXY_DNS_ENABLED_ENV = "KB_URL_FETCH_TRUSTED_PROXY_DNS";
const TRUSTED_PROXY_DNS_CIDRS_ENV = "KB_URL_FETCH_TRUSTED_PROXY_CIDRS";
const PUBLIC_DNS_LOOKUP_TIMEOUT_MS = 4_000;
const QUERY_CREDENTIAL_PARAMS = new Set([
  "access_token",
  "accesstoken",
  "auth",
  "authorization",
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
  "session",
  "session_id",
  "sessionid",
  "token",
  "credential",
  "credentials",
  "signature",
  "sig",
  "awsaccesskeyid",
  "code",
]);
const QUERY_CREDENTIAL_SUBSTRINGS = [
  "token",
  "secret",
  "password",
  "passwd",
  "signature",
  "apikey",
  "api_key",
  "accesskey",
  "access_key",
  "credential",
  "bearer",
] as const;
const NON_PUBLIC_DNS_HINT =
  " Check the DNS resolver or proxy configuration if this is a public hostname; DNS redirection to special-use ranges such as 198.18.0.0/15 is blocked.";
export type SupportedCharset =
  | "utf-8"
  | "us-ascii"
  | "windows-1252"
  | "iso-8859-1";

export interface NormalizedPublicUrl {
  original_url: string;
  normalized_url: string;
  canonical_host: string;
}

export interface FetchPublicHtmlOptions {
  lookup?: typeof dns.lookup;
  allow_private_for_tests?: boolean;
  accept_language?: string;
  timeout_ms?: number;
  trusted_proxy_dns_for_tests?: {
    enabled: boolean;
    trusted_cidrs?: string[];
  };
  public_dns_lookup_for_tests?: (hostname: string) => Promise<dns.LookupAddress[]>;
  request_lookup_for_tests?: typeof dns.lookup;
  request_pinned_address_observer_for_tests?: (address: dns.LookupAddress) => void;
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

interface VerifiedAddress {
  address: string;
  family: 4 | 6;
}

interface TrustedProxyDnsConfig {
  enabled: boolean;
  trustedCidrs: Ipv4CidrRange[];
}

interface Ipv4CidrRange {
  cidr: string;
  network: number;
  mask: number;
}

export function normalizePublicHttpUrl(input: string): NormalizedPublicUrl {
  const parsed = new URL(input);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL credentials are not supported.");
  }
  for (const param of parsed.searchParams.keys()) {
    if (isCredentialQueryParam(param)) {
      throw new Error("URL query credentials are not supported.");
    }
  }
  const hostForPolicy = stripIpLiteralBrackets(parsed.hostname);
  const canonicalHost =
    net.isIP(hostForPolicy) === 0
      ? domainToASCII(parsed.hostname).toLowerCase().replace(/\.+$/u, "")
      : hostForPolicy.toLowerCase();
  if (!canonicalHost) {
    throw new Error("URL host is invalid.");
  }
  if (isLocalOnlyHostname(canonicalHost)) {
    throw new Error("Local hostnames are not supported.");
  }
  parsed.hostname = canonicalHost;
  parsed.hash = "";
  return {
    original_url: input,
    normalized_url: parsed.toString(),
    canonical_host: canonicalHost,
  };
}

function isCredentialQueryParam(param: string): boolean {
  const lower = param.toLowerCase();
  const normalized = lower.replace(/-/gu, "_");
  const compact = lower.replace(/[-_]/gu, "");
  const parts = lower.split(/[^a-z0-9]+/u).filter(Boolean);
  return (
    QUERY_CREDENTIAL_PARAMS.has(lower) ||
    QUERY_CREDENTIAL_PARAMS.has(normalized) ||
    QUERY_CREDENTIAL_PARAMS.has(compact) ||
    parts.some((part) => QUERY_CREDENTIAL_PARAMS.has(part)) ||
    lower.startsWith("x-amz-") ||
    QUERY_CREDENTIAL_SUBSTRINGS.some(
      (pattern) =>
        lower.includes(pattern) ||
        normalized.includes(pattern) ||
        compact.includes(pattern)
    )
  );
}

export function isPublicIpAddress(address: string): boolean {
  const normalizedAddress = stripIpLiteralBrackets(address);
  const ipVersion = net.isIP(normalizedAddress);
  if (ipVersion === 4) {
    return isPublicIpv4Address(normalizedAddress);
  }
  if (ipVersion !== 6) {
    return false;
  }

  const mapped = ipv4FromMappedIpv6(normalizedAddress);
  if (mapped) {
    return isPublicIpAddress(mapped);
  }

  const parts = expandIpv6(normalizedAddress);
  if (!parts) {
    return false;
  }
  const allZero = parts.every((part) => part === 0);
  if (allZero) {
    return false;
  }
  const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
  if (loopback) {
    return false;
  }
  const first = parts[0] ?? 0;
  if ((first & 0xff00) === 0xff00) {
    return false;
  }
  if (
    first === 0x0064 &&
    parts[1] === 0xff9b &&
    parts.slice(2, 6).every((part) => part === 0)
  ) {
    return false;
  }
  if (first === 0x0064 && parts[1] === 0xff9b && parts[2] === 0x0001) {
    return false;
  }
  if (
    first === 0x0100 &&
    parts[1] === 0 &&
    parts[2] === 0 &&
    parts[3] === 0
  ) {
    return false;
  }
  if (first === 0x2001 && (parts[1] ?? 0) <= 0x01ff) {
    return false;
  }
  if (first === 0x2001 && parts[1] === 0x0db8) {
    return false;
  }
  if (first === 0x2002) {
    return false;
  }
  if ((first & 0xfe00) === 0xfc00) {
    return false;
  }
  if ((first & 0xffc0) === 0xfe80) {
    return false;
  }
  if ((first & 0xffc0) === 0xfec0) {
    return false;
  }
  return true;
}

export async function fetchPublicHtml(
  url: string,
  options: FetchPublicHtmlOptions = {}
): Promise<FetchedPublicHtml> {
  return fetchPublicHtmlRedirect(url, url, options, 0);
}

async function fetchPublicHtmlRedirect(
  originalUrl: string,
  currentUrl: string,
  options: FetchPublicHtmlOptions,
  redirectCount: number
): Promise<FetchedPublicHtml> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects; maximum is ${MAX_REDIRECTS}.`);
  }

  const normalized = normalizePublicHttpUrl(currentUrl);
  const parsed = new URL(normalized.normalized_url);
  const addresses = await resolveAndValidateHost(normalized.canonical_host, options);

  const response = await requestUrlFromAnyAddress(
    parsed,
    normalized.canonical_host,
    addresses,
    options
  );

  if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
    response.destroy();
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects; maximum is ${MAX_REDIRECTS}.`);
    }
    const location = response.headers.location;
    if (!location) {
      throw new Error(`Redirect response ${response.statusCode} did not include Location.`);
    }
    const nextUrl = new URL(location, normalized.normalized_url).toString();
    return fetchPublicHtmlRedirect(originalUrl, nextUrl, options, redirectCount + 1);
  }

  if (!response.statusCode || response.statusCode < 200 || response.statusCode > 299) {
    response.destroy();
    throw new Error(`Unexpected HTTP status ${response.statusCode ?? "unknown"}.`);
  }

  const contentType = getSingleHeader(response.headers["content-type"]);
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "text/html") {
    response.destroy();
    throw new Error("Only text/html is supported.");
  }

  const contentEncoding = normalizeContentEncoding(
    getSingleHeader(response.headers["content-encoding"])
  );
  const originalContentLength = parseContentLength(response.headers["content-length"]);
  if (originalContentLength !== null && originalContentLength > MAX_WIRE_BYTES) {
    response.destroy();
    throw new Error("wire response exceeded 6 MiB limit.");
  }
  let decoder: Transform;
  try {
    decoder = makeContentDecoder(contentEncoding);
  } catch (error) {
    response.destroy(error instanceof Error ? error : undefined);
    throw error;
  }
  const decodedEntityBytes = await readDecodedEntityBytes(
    response,
    decoder,
    options,
    contentEncoding === "identity" && originalContentLength === null
  );
  const decoded = decodeHtmlBytes(decodedEntityBytes, contentType);

  return {
    original_url: originalUrl,
    normalized_url: normalizePublicHttpUrl(originalUrl).normalized_url,
    final_url: normalized.normalized_url,
    fetch_status: response.statusCode,
    content_type: contentType,
    transport_content_encoding:
      contentEncoding === "identity" ? null : contentEncoding,
    decoded_content_length: decodedEntityBytes.byteLength,
    original_content_length: originalContentLength,
    decoded_entity_bytes: decodedEntityBytes,
    decoded_html: decoded.html,
    charset: decoded.charset,
    warnings: decoded.warnings,
  };
}

async function resolveAndValidateHost(
  hostname: string,
  options: FetchPublicHtmlOptions
): Promise<VerifiedAddress[]> {
  const ipVersion = net.isIP(stripIpLiteralBrackets(hostname));
  if (ipVersion !== 0) {
    const address = stripIpLiteralBrackets(hostname);
    if (!isPublicIpAddress(address)) {
      throw new Error(`URL host ${address} is a non-public IP address.`);
    }
    if (ipVersion !== 4 && ipVersion !== 6) {
      throw new Error(`URL host ${address} returned unsupported IP family ${ipVersion}.`);
    }
    return [{ address, family: ipVersion }];
  }

  const lookup = options.lookup ?? dns.lookup;
  const addresses = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error(`URL fetch timed out after ${getTimeoutMs(options)}ms.`));
    }, getTimeoutMs(options));

    try {
      lookup(hostname, { all: true }, (error, result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    } catch (error: unknown) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      reject(new Error(`DNS lookup failed for ${hostname}.`));
    }
  });

  if (addresses.length === 0) {
    throw new Error(`DNS lookup returned no addresses for ${hostname}.`);
  }
  const trustedProxyDns = resolveTrustedProxyDnsConfig(options);
  let needsExternalPublicDnsVerification = false;

  for (const candidate of addresses) {
    if (candidate.family !== 4 && candidate.family !== 6) {
      throw new Error(
        `DNS candidate ${candidate.address} returned unsupported IP family ${candidate.family}.`
      );
    }
    if (options.allow_private_for_tests || isPublicIpAddress(candidate.address)) {
      continue;
    }
    if (
      trustedProxyDns.enabled &&
      isTrustedProxyDnsCandidate(candidate.address, trustedProxyDns.trustedCidrs)
    ) {
      needsExternalPublicDnsVerification = true;
      continue;
    }
    throw new Error(
      `DNS candidate ${candidate.address} for ${hostname} is a non-public IP address.`
    );
  }

  if (needsExternalPublicDnsVerification) {
    await assertHostnameResolvesToPublicIp(hostname, options);
  }

  return addresses.map((candidate) => {
    if (candidate.family !== 4 && candidate.family !== 6) {
      throw new Error(
        `DNS candidate ${candidate.address} returned unsupported IP family ${candidate.family}.`
      );
    }
    return {
      address: candidate.address,
      family: candidate.family,
    };
  });
}

function resolveTrustedProxyDnsConfig(
  options: FetchPublicHtmlOptions
): TrustedProxyDnsConfig {
  const enabledForTests = options.trusted_proxy_dns_for_tests?.enabled;
  const envEnabled =
    process.env[TRUSTED_PROXY_DNS_ENABLED_ENV] === "1" ||
    process.env[TRUSTED_PROXY_DNS_ENABLED_ENV]?.toLowerCase() === "true";
  const enabled = enabledForTests ?? envEnabled;
  if (!enabled) {
    return {
      enabled: false,
      trustedCidrs: [],
    };
  }
  const configuredCidrs =
    options.trusted_proxy_dns_for_tests?.trusted_cidrs ??
    parseCidrsFromEnv(process.env[TRUSTED_PROXY_DNS_CIDRS_ENV]);
  const cidrs = configuredCidrs ?? [...DEFAULT_TRUSTED_PROXY_DNS_CIDRS];
  const trustedCidrs = cidrs.map(parseIpv4Cidr);
  return {
    enabled,
    trustedCidrs,
  };
}

function parseCidrsFromEnv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}

function parseIpv4Cidr(cidr: string): Ipv4CidrRange {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/u.exec(cidr);
  if (!match) {
    throw new Error(`Invalid trusted proxy CIDR: ${cidr}.`);
  }
  const base = ipv4ToInt(match[1] ?? "");
  const bits = Number(match[2]);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return {
    cidr,
    network: base & mask,
    mask,
  };
}

function ipv4ToInt(address: string): number {
  const octets = address.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    throw new Error(`Invalid IPv4 address: ${address}.`);
  }
  return (
    ((octets[0] ?? 0) << 24) |
    ((octets[1] ?? 0) << 16) |
    ((octets[2] ?? 0) << 8) |
    (octets[3] ?? 0)
  ) >>> 0;
}

function isTrustedProxyDnsCandidate(
  candidateAddress: string,
  trustedCidrs: Ipv4CidrRange[]
): boolean {
  if (net.isIP(candidateAddress) !== 4) {
    return false;
  }
  const value = ipv4ToInt(candidateAddress);
  for (const cidr of trustedCidrs) {
    if ((value & cidr.mask) === cidr.network) {
      return true;
    }
  }
  return false;
}

async function assertHostnameResolvesToPublicIp(
  hostname: string,
  options: FetchPublicHtmlOptions
): Promise<void> {
  const publicLookup =
    options.public_dns_lookup_for_tests ??
    ((targetHostname: string) =>
      lookupPublicDnsAddressesViaDoh(targetHostname, getPublicDnsLookupTimeoutMs(options)));
  let externalAddresses: dns.LookupAddress[];
  try {
    externalAddresses = await publicLookup(hostname);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `trusted proxy DNS external public DNS verification failed for ${hostname}: ${reason}`
    );
  }
  if (externalAddresses.length === 0) {
    throw new Error(
      `trusted proxy DNS external public DNS verification returned no addresses for ${hostname}.`
    );
  }
  if (!externalAddresses.every((address) => isPublicIpAddress(address.address))) {
    throw new Error(
      `trusted proxy DNS external public DNS verification found non-public DNS address for ${hostname}.`
    );
  }
}

async function lookupPublicDnsAddressesViaDoh(
  hostname: string,
  timeoutMs: number
): Promise<dns.LookupAddress[]> {
  const providers = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=AAAA`,
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=AAAA`,
  ];
  const dedup = new Map<string, dns.LookupAddress>();
  const errors: string[] = [];

  const results = await Promise.allSettled(
    providers.map((endpoint) => dohLookupSingleEndpoint(endpoint, timeoutMs))
  );
  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }
    const addresses = result.value;
    for (const address of addresses) {
      dedup.set(`${address.family}:${address.address}`, address);
    }
  }

  const resolved = [...dedup.values()];
  if (resolved.length > 0) {
    return resolved;
  }
  if (errors.length > 0) {
    throw new Error(
      `public DNS lookup returned no addresses for ${hostname}; provider errors: ${errors.join("; ")}`
    );
  }
  throw new Error(`public DNS lookup returned no addresses for ${hostname}.`);
}

async function dohLookupSingleEndpoint(
  endpoint: string,
  timeoutMs: number
): Promise<dns.LookupAddress[]> {
  const body = await new Promise<string>((resolve, reject) => {
    const request = https.request(
      endpoint,
      {
        method: "GET",
        headers: {
          Accept: "application/dns-json",
          "User-Agent": "@openclaw/kb-url-fetch/0.1",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        response.on("end", () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode > 299) {
            reject(new Error(`DoH request failed with HTTP ${response.statusCode ?? "unknown"}.`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      }
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("DoH request timed out."));
    });
    request.on("error", reject);
    request.end();
  });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("DoH response was not valid JSON.");
  }

  const status = (payload as { Status?: unknown }).Status;
  if (typeof status !== "number" || !Number.isInteger(status)) {
    throw new Error("DoH response missing DNS Status.");
  }
  if (status !== 0) {
    throw new Error(`DoH response returned DNS Status ${status}.`);
  }

  const answers = (
    payload as {
      Answer?: Array<{ data?: string }>;
    }
  ).Answer;
  if (!Array.isArray(answers)) {
    return [];
  }

  const addresses: dns.LookupAddress[] = [];
  for (const answer of answers) {
    const raw = answer?.data?.trim();
    const family = net.isIP(raw ?? "");
    if (family === 4 || family === 6) {
      addresses.push({
        address: raw as string,
        family,
      });
    }
  }
  return addresses;
}

async function requestUrlFromAnyAddress(
  parsed: URL,
  canonicalHost: string,
  addresses: VerifiedAddress[],
  options: FetchPublicHtmlOptions
): Promise<http.IncomingMessage> {
  let lastError: unknown;
  for (const pinned of addresses) {
    try {
      return await requestUrl(parsed, canonicalHost, pinned, options);
    } catch (error: unknown) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`DNS lookup returned no addresses for ${canonicalHost}.`);
}

function requestUrl(
  parsed: URL,
  canonicalHost: string,
  pinned: VerifiedAddress,
  options: FetchPublicHtmlOptions
): Promise<http.IncomingMessage> {
  const transport = parsed.protocol === "https:" ? https : http;
  const isIpLiteral = net.isIP(canonicalHost) !== 0;
  const headers: Record<string, string> = {
    "User-Agent": "@openclaw/kb-url-fetch/0.1",
    Accept: "text/html",
    "Accept-Encoding": "gzip, br, deflate, identity",
  };
  if (options.accept_language) {
    headers["Accept-Language"] = options.accept_language;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      const error = new Error(`URL fetch timed out after ${getTimeoutMs(options)}ms.`);
      settled = true;
      request.destroy(error);
      reject(error);
    }, getTimeoutMs(options));
    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: canonicalHost,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers,
        agent: false,
        servername:
          parsed.protocol === "https:" && !isIpLiteral ? canonicalHost : undefined,
        lookup: (_hostname, lookupOptions, callback) => {
          options.request_pinned_address_observer_for_tests?.(pinned);
          if (options.request_lookup_for_tests) {
            options.request_lookup_for_tests(
              canonicalHost,
              lookupOptions as never,
              callback as never
            );
            return;
          }
          if (
            typeof lookupOptions === "object" &&
            lookupOptions !== null &&
            "all" in lookupOptions &&
            lookupOptions.all === true
          ) {
            (
              callback as (
                error: NodeJS.ErrnoException | null,
                addresses: dns.LookupAddress[]
              ) => void
            )(null, [pinned]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(response);
      }
    );
    request.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    request.end();
  });
}

function readDecodedEntityBytes(
  response: http.IncomingMessage,
  decoder: Transform,
  options: FetchPublicHtmlOptions,
  preferWireLimitError: boolean
): Promise<Buffer> {
  if (preferWireLimitError) {
    return readDecodedEntityBytesPreferringWireLimit(response, decoder, options);
  }

  const wireCounter = new ByteLimitTransform(
    MAX_WIRE_BYTES,
    "wire response exceeded 6 MiB limit."
  );
  const decodedCounter = new ByteLimitTransform(
    MAX_DECODED_BYTES,
    "decoded response exceeded 5 MiB limit."
  );
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      fail(new Error(`URL fetch timed out after ${getTimeoutMs(options)}ms.`));
    }, getTimeoutMs(options));
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      response.destroy(error);
      decoder.destroy(error);
      wireCounter.destroy(error);
      decodedCounter.destroy(error);
      reject(error);
    };

    decodedCounter.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    decodedCounter.on("error", fail);
    wireCounter.on("error", fail);
    decoder.on("error", fail);
    response.on("error", fail);
    decodedCounter.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks));
    });

    response.pipe(wireCounter).pipe(decoder).pipe(decodedCounter);
  });
}

function readDecodedEntityBytesPreferringWireLimit(
  response: http.IncomingMessage,
  decoder: Transform,
  options: FetchPublicHtmlOptions
): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    let settled = false;
    let wireBytes = 0;
    let decodedBytes = 0;
    let decodedLimitError: Error | undefined;
    const timeout = setTimeout(() => {
      fail(new Error(`URL fetch timed out after ${getTimeoutMs(options)}ms.`));
    }, getTimeoutMs(options));

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      response.destroy(error);
      decoder.destroy(error);
      reject(error);
    };

    response.on("data", (chunk: Buffer) => {
      wireBytes += chunk.byteLength;
      if (wireBytes > MAX_WIRE_BYTES) {
        fail(new Error("wire response exceeded 6 MiB limit."));
        return;
      }
      decoder.write(chunk);
    });
    response.on("end", () => {
      decoder.end();
    });
    response.on("error", fail);
    decoder.on("error", fail);
    decoder.on("data", (chunk: Buffer) => {
      decodedBytes += chunk.byteLength;
      if (decodedBytes > MAX_DECODED_BYTES) {
        decodedLimitError ??= new Error("decoded response exceeded 5 MiB limit.");
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    decoder.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (decodedLimitError) {
        reject(decodedLimitError);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function getTimeoutMs(options: FetchPublicHtmlOptions): number {
  return options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
}

function getPublicDnsLookupTimeoutMs(options: FetchPublicHtmlOptions): number {
  return Math.max(1, Math.min(PUBLIC_DNS_LOOKUP_TIMEOUT_MS, getTimeoutMs(options)));
}

class ByteLimitTransform extends Transform {
  private seen = 0;

  constructor(
    private readonly limit: number,
    private readonly message: string
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    this.seen += chunk.byteLength;
    if (this.seen > this.limit) {
      callback(new Error(this.message));
      return;
    }
    callback(null, chunk);
  }
}

function makeContentDecoder(encoding: string): Transform {
  switch (encoding) {
    case "identity":
      return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          callback(null, chunk);
        },
      });
    case "gzip":
      return zlib.createGunzip();
    case "br":
      return zlib.createBrotliDecompress();
    case "deflate":
      return zlib.createInflate();
    default:
      throw new Error(`Unsupported content-encoding: ${encoding}.`);
  }
}

function normalizeContentEncoding(header: string): string {
  const encoding = header.trim().toLowerCase();
  return encoding.length === 0 ? "identity" : encoding;
}

function getSingleHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value ?? "";
}

function parseContentLength(value: string | string[] | undefined): number | null {
  const header = getSingleHeader(value).trim();
  if (!/^\d+$/u.test(header)) {
    return null;
  }
  return Number(header);
}

function decodeHtmlBytes(
  buffer: Buffer,
  contentType: string
): { html: string; charset: SupportedCharset; warnings: string[] } {
  const bom = detectBom(buffer);
  if (bom === "utf-8") {
    return {
      html: decodeWithCharset(buffer.subarray(3), "utf-8"),
      charset: "utf-8",
      warnings: [],
    };
  }
  if (bom) {
    throw new Error(`Unsupported charset: ${bom}.`);
  }

  const declaredCharset =
    charsetFromContentType(contentType) ??
    charsetFromMetaCharset(buffer) ??
    charsetFromMetaHttpEquiv(buffer);

  if (declaredCharset) {
    const charset = normalizeSupportedCharset(declaredCharset);
    return {
      html: decodeWithCharset(buffer, charset),
      charset,
      warnings: [],
    };
  }

  return {
    html: decodeWithCharset(buffer, "utf-8"),
    charset: "utf-8",
    warnings: ["charset_missing_assumed_utf8"],
  };
}

function detectBom(buffer: Buffer): "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be" | null {
  if (
    buffer.byteLength >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return "utf-8";
  }
  if (
    buffer.byteLength >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xfe &&
    buffer[2] === 0x00 &&
    buffer[3] === 0x00
  ) {
    return "utf-32le";
  }
  if (
    buffer.byteLength >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0xfe &&
    buffer[3] === 0xff
  ) {
    return "utf-32be";
  }
  if (buffer.byteLength >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf-16le";
  }
  if (buffer.byteLength >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return "utf-16be";
  }
  return null;
}

function charsetFromContentType(contentType: string): string | null {
  const match = /(?:^|;)\s*charset\s*=\s*("([^"]*)"|'([^']*)'|([^;\s]*))/iu.exec(
    contentType
  );
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null;
}

function charsetFromMetaCharset(buffer: Buffer): string | null {
  const head = decodeAsciiCompatibleHead(buffer);
  for (const tag of findMetaTags(head)) {
    const charset = getTagAttribute(tag, "charset");
    if (charset) {
      return charset;
    }
  }
  return null;
}

function charsetFromMetaHttpEquiv(buffer: Buffer): string | null {
  const head = decodeAsciiCompatibleHead(buffer);
  for (const tag of findMetaTags(head)) {
    const httpEquiv = getTagAttribute(tag, "http-equiv");
    if (httpEquiv?.toLowerCase() !== "content-type") {
      continue;
    }
    const content = getTagAttribute(tag, "content");
    if (!content) {
      continue;
    }
    const charset = charsetFromContentType(content);
    if (charset) {
      return charset;
    }
  }
  return null;
}

function findMetaTags(head: string): string[] {
  return Array.from(head.matchAll(/<meta\b[^>]*>/giu), (match) => match[0]);
}

function getTagAttribute(tag: string, attributeName: string): string | null {
  const attributes = tag
    .replace(/^<meta\b/iu, "")
    .replace(/\/?>$/u, "");
  const attributePattern =
    /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

  for (const match of attributes.matchAll(attributePattern)) {
    if (match[1]?.toLowerCase() !== attributeName.toLowerCase()) {
      continue;
    }
    const value = match[2] ?? match[3] ?? match[4];
    return value && value.trim().length > 0 ? value.trim() : null;
  }
  return null;
}

function decodeAsciiCompatibleHead(buffer: Buffer): string {
  return buffer.subarray(0, 4096).toString("latin1");
}

function normalizeSupportedCharset(charset: string): SupportedCharset {
  const normalized = charset.trim().toLowerCase();
  switch (normalized) {
    case "utf-8":
    case "utf8":
      return "utf-8";
    case "us-ascii":
    case "ascii":
      return "us-ascii";
    case "windows-1252":
    case "cp1252":
      return "windows-1252";
    case "iso-8859-1":
    case "latin1":
    case "latin-1":
      return "iso-8859-1";
    default:
      throw new Error(`Unsupported charset: ${charset}.`);
  }
}

function decodeWithCharset(buffer: Buffer, charset: SupportedCharset): string {
  if (charset === "us-ascii") {
    for (const byte of buffer) {
      if (byte > 0x7f) {
        throw new Error("US-ASCII content contains non-ASCII bytes.");
      }
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  }

  return new TextDecoder(charset, { fatal: true }).decode(buffer);
}

function isPublicIpv4Address(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) {
    return false;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false;
  }
  if (a === 169 && b === 254) {
    return false;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false;
  }
  if (a === 192 && b === 0) {
    return false;
  }
  if (a === 192 && b === 88 && octets[2] === 99) {
    return false;
  }
  if (a === 192 && b === 168) {
    return false;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false;
  }
  if (a === 198 && b === 51 && octets[2] === 100) {
    return false;
  }
  if (a === 203 && b === 0 && octets[2] === 113) {
    return false;
  }
  if (a >= 224 && a <= 239) {
    return false;
  }
  if (a >= 240) {
    return false;
  }
  return true;
}

function ipv4FromMappedIpv6(address: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address);
  if (dotted) {
    return dotted[1] ?? null;
  }
  const parts = expandIpv6(address);
  if (
    parts &&
    parts.slice(0, 5).every((part) => part === 0) &&
    parts[5] === 0xffff
  ) {
    const high = parts[6] ?? 0;
    const low = parts[7] ?? 0;
    return [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ].join(".");
  }
  return null;
}

function expandIpv6(address: string): number[] | null {
  const lower = address.toLowerCase();
  const ipv4Match = /(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(lower);
  let working = lower;
  const ipv4Parts: number[] = [];
  if (ipv4Match) {
    if (!isValidIpv4Literal(ipv4Match[1] ?? "")) {
      return null;
    }
    const octets = (ipv4Match[1] ?? "").split(".").map((part) => Number(part));
    ipv4Parts.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    working = lower.slice(0, ipv4Match.index).replace(/:$/u, "");
  }

  const halves = working.split("::");
  if (halves.length > 2) {
    return null;
  }

  const left = parseIpv6Half(halves[0] ?? "");
  const right = parseIpv6Half(halves[1] ?? "");
  if (!left || !right) {
    return null;
  }

  if (halves.length === 1) {
    const full = [...left, ...ipv4Parts];
    return full.length === 8 ? full : null;
  }

  const missing = 8 - left.length - right.length - ipv4Parts.length;
  if (missing < 1) {
    return null;
  }
  return [...left, ...Array<number>(missing).fill(0), ...right, ...ipv4Parts];
}

function parseIpv6Half(value: string): number[] | null {
  if (value.length === 0) {
    return [];
  }
  const parts = value.split(":");
  const parsed: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/iu.test(part)) {
      return null;
    }
    parsed.push(Number.parseInt(part, 16));
  }
  return parsed;
}

function isValidIpv4Literal(address: string): boolean {
  return net.isIP(address) === 4;
}

function stripIpLiteralBrackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isLocalOnlyHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}
