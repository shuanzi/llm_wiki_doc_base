import test from "node:test";
import assert from "node:assert/strict";
import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import * as zlib from "node:zlib";

import {
  fetchPublicHtml,
  isPublicIpAddress,
  MAX_WIRE_BYTES,
  normalizePublicHttpUrl,
} from "../src/core/url-fetch";

const requireForTests = createRequire(import.meta.url);
const httpsCjs = requireForTests("node:https") as typeof https;

test("normalizePublicHttpUrl canonicalizes host and removes fragment", () => {
  const result = normalizePublicHttpUrl("https://Example.COM./Path?q=1#frag");
  assert.equal(result.normalized_url, "https://example.com/Path?q=1");
  assert.equal(result.canonical_host, "example.com");
});

test("normalizePublicHttpUrl rejects unsupported schemes and credentials", () => {
  assert.throws(
    () => normalizePublicHttpUrl("file:///tmp/a.html"),
    /Only http and https URLs are supported/u
  );
  assert.throws(
    () => normalizePublicHttpUrl("https://user:pass@example.com/"),
    /URL credentials are not supported/u
  );
});

test("normalizePublicHttpUrl rejects credential query parameters", () => {
  for (const key of [
    "access_token",
    "auth",
    "authorization",
    "auth_token",
    "id_token",
    "refresh_token",
    "bearer_token",
    "api_key",
    "apikey",
    "client_secret",
    "password",
    "session",
    "credential",
    "token",
    "access-token",
    "accessToken",
    "signature",
    "sig",
    "AWSAccessKeyId",
    "X-Amz-Signature",
    "X-Amz-Credential",
    "zd_token",
    "session_token",
    "utm-token",
    "aws_access_key_id",
    "code",
  ]) {
    assert.throws(
      () => normalizePublicHttpUrl(`https://example.com/a?${key}=secret`),
      /URL query credentials are not supported/u,
      key
    );
  }
});

test("normalizePublicHttpUrl accepts ordinary non-credential query parameters", () => {
  const result = normalizePublicHttpUrl(
    "https://example.com/a?page=1&encoding=utf8&zipcode=12345&author=alice&authorship=team"
  );
  assert.equal(
    result.normalized_url,
    "https://example.com/a?page=1&encoding=utf8&zipcode=12345&author=alice&authorship=team"
  );
});

test("normalizePublicHttpUrl rejects localhost and local-only hostnames", () => {
  for (const url of [
    "https://localhost./",
    "https://a.localhost/",
    "https://printer.local/",
  ]) {
    assert.throws(
      () => normalizePublicHttpUrl(url),
      /Local hostnames are not supported/u,
      url
    );
  }
});

test("isPublicIpAddress rejects private, loopback, link-local, multicast, unspecified", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:192.168.1.1",
    "224.0.0.1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  assert.equal(isPublicIpAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
});

test("isPublicIpAddress rejects IPv4 special-use ranges", () => {
  for (const address of [
    "0.1.2.3",
    "10.1.2.3",
    "100.64.0.1",
    "100.127.255.254",
    "127.1.2.3",
    "169.254.1.1",
    "172.16.0.1",
    "172.31.255.254",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.254",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});

test("isPublicIpAddress rejects IPv6 special-use ranges", () => {
  for (const address of [
    "::",
    "::1",
    "::ffff:192.168.1.1",
    "::ffff:c0a8:101",
    "64:ff9b::5db8:d822",
    "64:ff9b:1::1",
    "100::1",
    "2001::1",
    "2001:2::1",
    "2001:20::1",
    "2001:db8::1",
    "2002::1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "fec0::1",
    "ff00::1",
    "[::ffff:c0a8:101]",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("::ffff:93.184.216.34"), true);
});

async function withServer(
  handler: http.RequestListener,
  fn: (url: string) => Promise<void>
): Promise<void> {
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

function localLookup(hostname: string, options: unknown, callback: unknown): void {
  const cb = typeof options === "function" ? options : callback;
  const wantsAll =
    typeof options === "object" &&
    options !== null &&
    "all" in options &&
    (options as dns.LookupAllOptions).all === true;

  if (wantsAll) {
    (
      cb as (
        error: NodeJS.ErrnoException | null,
        addresses: dns.LookupAddress[]
      ) => void
    )(null, [{ address: "127.0.0.1", family: 4 }]);
    return;
  }

  (cb as dns.LookupOneCallback)(null, "127.0.0.1", 4);
}

function lookupReturning(addresses: dns.LookupAddress[]): typeof dns.lookup {
  return (hostname: string, options: unknown, callback: unknown): void => {
    const cb = typeof options === "function" ? options : callback;
    const wantsAll =
      typeof options === "object" &&
      options !== null &&
      "all" in options &&
      (options as dns.LookupAllOptions).all === true;

    if (wantsAll) {
      (
        cb as (
          error: NodeJS.ErrnoException | null,
          result: dns.LookupAddress[]
        ) => void
      )(null, addresses);
      return;
    }

    const first = addresses[0];
    assert.ok(first, `lookupReturning(${hostname}) requires at least one address`);
    (cb as dns.LookupOneCallback)(null, first.address, first.family);
  };
}

type FetchPublicHtmlOptionsForTests = NonNullable<Parameters<typeof fetchPublicHtml>[1]>;

type MockDohResult =
  | { kind: "response"; statusCode: number; body: string }
  | { kind: "request_error"; message: string };

async function withMockedDohRequest(
  resolveDohResult: (endpoint: URL) => MockDohResult,
  fn: () => Promise<void>,
  observeTimeout?: (timeoutMs: number, endpoint: URL) => void
): Promise<void> {
  const originalRequest = httpsCjs.request;
  const forwardRequest = originalRequest as unknown as (...args: unknown[]) => http.ClientRequest;

  const patchedRequest = ((...args: unknown[]): http.ClientRequest => {
    const first = args[0];
    const second = args[1];
    const third = args[2];
    const callback =
      typeof second === "function"
        ? (second as (response: http.IncomingMessage) => void)
        : typeof third === "function"
          ? (third as (response: http.IncomingMessage) => void)
          : undefined;

    let endpoint: URL | null = null;
    if (typeof first === "string" || first instanceof URL) {
      endpoint = new URL(first.toString());
    }

    const isDohEndpoint =
      endpoint !== null &&
      (endpoint.hostname === "cloudflare-dns.com" || endpoint.hostname === "dns.google");
    if (!isDohEndpoint || endpoint === null) {
      return forwardRequest(...args);
    }

    let timeoutHandler: (() => void) | undefined;
    const request = new EventEmitter() as EventEmitter &
      Pick<http.ClientRequest, "setTimeout" | "destroy" | "end">;
    request.setTimeout = (timeoutMs: number, onTimeout?: () => void) => {
      observeTimeout?.(timeoutMs, endpoint);
      timeoutHandler = onTimeout;
      return request as unknown as http.ClientRequest;
    };
    request.destroy = (error?: Error) => {
      if (error) {
        request.emit("error", error);
      } else if (timeoutHandler) {
        timeoutHandler();
      }
      return request as unknown as http.ClientRequest;
    };
    request.end = () => {
      const result = resolveDohResult(endpoint);
      process.nextTick(() => {
        if (result.kind === "request_error") {
          request.emit("error", new Error(result.message));
          return;
        }
        const response = new PassThrough() as PassThrough & { statusCode?: number };
        response.statusCode = result.statusCode;
        callback?.(response as unknown as http.IncomingMessage);
        response.end(result.body);
      });
      return request as unknown as http.ClientRequest;
    };
    return request as unknown as http.ClientRequest;
  }) as typeof https.request;

  httpsCjs.request = patchedRequest;
  try {
    await fn();
  } finally {
    httpsCjs.request = originalRequest;
  }
}

test("fetchPublicHtml accepts text/html, decodes gzip, and returns decoded entity bytes", async () => {
  await withServer((request, response) => {
    assert.equal(request.headers.cookie, undefined);
    const body = Buffer.from(
      "<!doctype html><html><body>Hello</body></html>",
      "utf8"
    );
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-encoding": "gzip",
    });
    response.end(zlib.gzipSync(body));
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.content_type, "text/html; charset=utf-8");
    assert.equal(result.transport_content_encoding, "gzip");
    assert.equal(
      result.decoded_html,
      "<!doctype html><html><body>Hello</body></html>"
    );
    assert.deepEqual(
      result.decoded_entity_bytes,
      Buffer.from(result.decoded_html, "utf8")
    );
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
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /Only text\/html is supported/u
    );
  });
});

test("fetchPublicHtml tries alternate verified DNS candidates after connection failure", async () => {
  await withServer((request, response) => {
    assert.equal(request.headers.host?.startsWith("example.com:"), true);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Fallback address</body></html>");
  }, async (url) => {
    function fallbackLookup(
      hostname: string,
      options: unknown,
      callback: unknown
    ): void {
      const cb = typeof options === "function" ? options : callback;
      const wantsAll =
        typeof options === "object" &&
        options !== null &&
        "all" in options &&
        (options as dns.LookupAllOptions).all === true;

      if (wantsAll) {
        (
          cb as (
            error: NodeJS.ErrnoException | null,
            addresses: dns.LookupAddress[]
          ) => void
        )(null, [
          { address: "127.0.0.2", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]);
        return;
      }

      (cb as dns.LookupOneCallback)(null, "127.0.0.1", 4);
    }

    const result = await fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
      lookup: fallbackLookup as typeof dns.lookup,
      allow_private_for_tests: true,
      timeout_ms: 50,
    });
    assert.match(result.decoded_html, /Fallback address/u);
  });
});

test("fetchPublicHtml times out stalled DNS lookups", async () => {
  function stalledLookup(_hostname: string, _options: unknown, _callback: unknown): void {}

  await assert.rejects(
    () =>
      Promise.race([
        fetchPublicHtml("https://example.com/article", {
          lookup: stalledLookup as typeof dns.lookup,
          timeout_ms: 20,
        }),
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("test timed out waiting for DNS timeout")),
            200
          )
        ),
      ]),
    /URL fetch timed out after 20ms/u
  );
});

test("fetchPublicHtml rejects when any DNS candidate is non-public", async () => {
  function mixedLookup(
    hostname: string,
    options: unknown,
    callback: unknown
  ): void {
    const cb = typeof options === "function" ? options : callback;
    const wantsAll =
      typeof options === "object" &&
      options !== null &&
      "all" in options &&
      (options as dns.LookupAllOptions).all === true;

    if (wantsAll) {
      (
        cb as (
          error: NodeJS.ErrnoException | null,
          addresses: dns.LookupAddress[]
        ) => void
      )(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]);
      return;
    }

    (cb as dns.LookupOneCallback)(null, "93.184.216.34", 4);
  }

  await assert.rejects(
    () =>
      fetchPublicHtml("https://example.com/article", {
        lookup: mixedLookup as typeof dns.lookup,
      }),
    /non-public IP address.*DNS resolver or proxy/u
  );
});

test("fetchPublicHtml default mode still rejects trusted-proxy fake-ip DNS candidates", async () => {
  const fakeIpLookup = lookupReturning([{ address: "198.18.0.10", family: 4 }]);

  await assert.rejects(
    () =>
      fetchPublicHtml("https://example.com/article", {
        lookup: fakeIpLookup,
      }),
    /non-public IP address/u
  );
});

test("fetchPublicHtml default mode ignores invalid trusted CIDR env when trusted proxy DNS is disabled", async () => {
  const previousEnabled = process.env.KB_URL_FETCH_TRUSTED_PROXY_DNS;
  const previousCidrs = process.env.KB_URL_FETCH_TRUSTED_PROXY_CIDRS;
  process.env.KB_URL_FETCH_TRUSTED_PROXY_DNS = "0";
  process.env.KB_URL_FETCH_TRUSTED_PROXY_CIDRS = "not-a-cidr";
  try {
    await assert.rejects(
      () =>
        fetchPublicHtml("https://example.com/article", {
          lookup: lookupReturning([{ address: "198.18.0.10", family: 4 }]),
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /non-public IP address/u);
        assert.doesNotMatch(error.message, /Invalid trusted proxy CIDR/u);
        return true;
      }
    );
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.KB_URL_FETCH_TRUSTED_PROXY_DNS;
    } else {
      process.env.KB_URL_FETCH_TRUSTED_PROXY_DNS = previousEnabled;
    }
    if (previousCidrs === undefined) {
      delete process.env.KB_URL_FETCH_TRUSTED_PROXY_CIDRS;
    } else {
      process.env.KB_URL_FETCH_TRUSTED_PROXY_CIDRS = previousCidrs;
    }
  }
});

test("fetchPublicHtml trusted proxy DNS mode accepts fake-ip after external public DNS verification", async () => {
  await withServer((request, response) => {
    assert.equal(request.headers.host?.startsWith("example.com:"), true);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Trusted proxy DNS fake-ip</body></html>");
  }, async (url) => {
    let publicLookupCalls = 0;
    let pinnedFakeIpLookupObserved = false;
    const options: FetchPublicHtmlOptionsForTests = {
      lookup: lookupReturning([{ address: "198.18.0.10", family: 4 }]),
      trusted_proxy_dns_for_tests: {
        enabled: true,
        trusted_cidrs: ["198.18.0.0/15"],
      },
      public_dns_lookup_for_tests: async (hostname: string) => {
        publicLookupCalls += 1;
        assert.equal(hostname, "example.com");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      request_lookup_for_tests: localLookup as typeof dns.lookup,
      request_pinned_address_observer_for_tests: (address: dns.LookupAddress) => {
        assert.deepEqual(address, { address: "198.18.0.10", family: 4 });
        pinnedFakeIpLookupObserved = true;
      },
    };
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      options
    );
    assert.match(result.decoded_html, /Trusted proxy DNS fake-ip/u);
    assert.equal(publicLookupCalls, 1);
    assert.equal(pinnedFakeIpLookupObserved, true);
  });
});

test("fetchPublicHtml trusted proxy DNS DoH production lookup tolerates endpoint failures after public verification", async () => {
  await withServer((request, response) => {
    assert.equal(request.headers.host?.startsWith("example.com:"), true);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Fetched through trusted proxy DNS</body></html>");
  }, async (url) => {
    await withMockedDohRequest(
      (endpoint: URL): MockDohResult =>
        endpoint.hostname === "cloudflare-dns.com"
          ? { kind: "request_error", message: "cloudflare blocked" }
          : {
              kind: "response",
              statusCode: 200,
              body: JSON.stringify({
                Status: 0,
                Answer: [{ data: "93.184.216.34" }],
              }),
            },
      async () => {
        const result = await fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: lookupReturning([{ address: "198.18.0.10", family: 4 }]),
          trusted_proxy_dns_for_tests: {
            enabled: true,
            trusted_cidrs: ["198.18.0.0/15"],
          },
          request_lookup_for_tests: localLookup as typeof dns.lookup,
        });
        assert.match(result.decoded_html, /Fetched through trusted proxy DNS/u);
      }
    );
  });
});

test("fetchPublicHtml trusted proxy DNS DoH production lookup rejects any non-public external answer", async () => {
  await withMockedDohRequest(
    (endpoint: URL): MockDohResult =>
      endpoint.hostname === "cloudflare-dns.com" && endpoint.searchParams.get("type") === "A"
        ? {
            kind: "response",
            statusCode: 200,
            body: JSON.stringify({
              Status: 0,
              Answer: [{ data: "10.0.0.9" }],
            }),
          }
        : {
            kind: "response",
            statusCode: 200,
            body: JSON.stringify({
              Status: 0,
              Answer: [{ data: "93.184.216.34" }],
            }),
          },
    async () => {
      await assert.rejects(
        () =>
          fetchPublicHtml("https://example.com/article", {
            lookup: lookupReturning([{ address: "198.18.0.10", family: 4 }]),
            trusted_proxy_dns_for_tests: {
              enabled: true,
              trusted_cidrs: ["198.18.0.0/15"],
            },
          }),
        /non-public DNS address/u
      );
    }
  );
});

test("fetchPublicHtml trusted proxy DNS DoH production lookup uses caller timeout budget", async () => {
  const observedTimeouts: number[] = [];
  await withMockedDohRequest(
    (): MockDohResult => ({ kind: "request_error", message: "provider blocked" }),
    async () => {
      await assert.rejects(
        () =>
          fetchPublicHtml("https://example.com/article", {
            lookup: lookupReturning([{ address: "198.18.0.10", family: 4 }]),
            trusted_proxy_dns_for_tests: {
              enabled: true,
              trusted_cidrs: ["198.18.0.0/15"],
            },
            timeout_ms: 123,
          }),
        /trusted proxy DNS external public DNS verification failed/u
      );
    },
    (timeoutMs: number) => observedTimeouts.push(timeoutMs)
  );
  assert.ok(observedTimeouts.length > 0);
  assert.deepEqual([...new Set(observedTimeouts)], [123]);
});

test("fetchPublicHtml trusted proxy DNS mode rejects fake-ip when external verification is non-public or empty", async () => {
  for (const [label, externalAddresses] of [
    ["non-public", [{ address: "10.0.0.9", family: 4 }] satisfies dns.LookupAddress[]],
    [
      "mixed public and private",
      [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.9", family: 4 },
      ] satisfies dns.LookupAddress[],
    ],
    ["empty", [] satisfies dns.LookupAddress[]],
  ] as const) {
    let publicLookupCalls = 0;
    const options: FetchPublicHtmlOptionsForTests = {
      lookup: lookupReturning([{ address: "198.18.0.10", family: 4 }]),
      trusted_proxy_dns_for_tests: {
        enabled: true,
        trusted_cidrs: ["198.18.0.0/15"],
      },
      public_dns_lookup_for_tests: async () => {
        publicLookupCalls += 1;
        return externalAddresses;
      },
    };

    await assert.rejects(
      () => fetchPublicHtml("https://example.com/article", options),
      /external public DNS verification|verified public DNS|trusted proxy DNS|non-public IP address/u,
      label
    );
    assert.equal(publicLookupCalls, 1, label);
  }
});

test("fetchPublicHtml rejects non-public IP literal even when trusted proxy DNS mode is enabled", async () => {
  let publicLookupCalls = 0;
  const options: FetchPublicHtmlOptionsForTests = {
    lookup: lookupReturning([{ address: "198.18.0.10", family: 4 }]),
    trusted_proxy_dns_for_tests: {
      enabled: true,
      trusted_cidrs: ["198.18.0.0/15"],
    },
    public_dns_lookup_for_tests: async () => {
      publicLookupCalls += 1;
      return [{ address: "93.184.216.34", family: 4 }];
    },
  };

  for (const literalUrl of ["http://192.168.1.10/", "http://198.18.0.10/"]) {
    await assert.rejects(
      () => fetchPublicHtml(literalUrl, options),
      /non-public IP address/u,
      literalUrl
    );
  }
  assert.equal(publicLookupCalls, 0, "IP literal path should skip external DNS verification");
});

test("fetchPublicHtml rejects newly covered special-use DNS candidates", async () => {
  for (const address of [
    { address: "192.88.99.1", family: 4 },
    { address: "64:ff9b:1::1", family: 6 },
    { address: "2001::1", family: 6 },
    { address: "2001:2::1", family: 6 },
    { address: "2001:20::1", family: 6 },
    { address: "2002::1", family: 6 },
  ] satisfies dns.LookupAddress[]) {
    function specialUseLookup(
      hostname: string,
      options: unknown,
      callback: unknown
    ): void {
      const cb = typeof options === "function" ? options : callback;
      const wantsAll =
        typeof options === "object" &&
        options !== null &&
        "all" in options &&
        (options as dns.LookupAllOptions).all === true;

      if (wantsAll) {
        (
          cb as (
            error: NodeJS.ErrnoException | null,
            addresses: dns.LookupAddress[]
          ) => void
        )(null, [address]);
        return;
      }

      (cb as dns.LookupOneCallback)(null, address.address, address.family);
    }

    await assert.rejects(
      () =>
        fetchPublicHtml("https://example.com/article", {
          lookup: specialUseLookup as typeof dns.lookup,
        }),
      /non-public IP address/u,
      address.address
    );
  }
});

test("fetchPublicHtml rejects private IP literals without DNS lookup", async () => {
  function rejectingLookup(
    hostname: string,
    options: unknown,
    callback: unknown
  ): void {
    const cb = typeof options === "function" ? options : callback;
    (cb as (error: NodeJS.ErrnoException) => void)(
      Object.assign(new Error(`unexpected lookup for ${hostname}`), {
        code: "UNEXPECTED_LOOKUP",
      })
    );
  }

  await assert.rejects(
    () =>
      fetchPublicHtml("http://[::ffff:192.168.1.1]/", {
        lookup: rejectingLookup as typeof dns.lookup,
      }),
    /non-public IP address/u
  );
});

test("fetchPublicHtml rejects special-use initial URL literals without DNS lookup", async () => {
  for (const url of [
    "http://192.88.99.1/",
    "http://[64:ff9b:1::1]/",
    "http://[2001::1]/",
    "http://[2001:2::1]/",
    "http://[2001:20::1]/",
    "http://[2002::1]/",
  ]) {
    let lookupCalls = 0;
    function rejectingLookup(
      hostname: string,
      options: unknown,
      callback: unknown
    ): void {
      lookupCalls += 1;
      const cb = typeof options === "function" ? options : callback;
      (cb as (error: NodeJS.ErrnoException) => void)(
        Object.assign(new Error(`unexpected lookup for ${hostname}`), {
          code: "UNEXPECTED_LOOKUP",
        })
      );
    }

    await assert.rejects(
      () =>
        fetchPublicHtml(url, {
          lookup: rejectingLookup as typeof dns.lookup,
        }),
      /non-public IP address/u,
      url
    );
    assert.equal(lookupCalls, 0, url);
  }
});

test("fetchPublicHtml revalidates redirect targets", async () => {
  await withServer((_request, response) => {
    response.writeHead(302, { location: "https://user:pass@example.com/secret" });
    response.end();
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /URL credentials are not supported/u
    );
  });
});

test("fetchPublicHtml allows WeChat-style signed redirects and preserves final_url", async () => {
  await withServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(302, { location: "/secret?sig=abc&chksm=def" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Redirected</body></html>");
  }, async (url) => {
    const result = await fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
      lookup: localLookup as typeof dns.lookup,
      allow_private_for_tests: true,
    });
    assert.equal(
      result.final_url,
      `${url.replace("127.0.0.1", "example.com")}/secret?sig=abc&chksm=def`
    );
    assert.match(result.decoded_html, /Redirected/u);
  });
});

test("fetchPublicHtml rejects redirects to non-signature credential query parameters", async () => {
  for (const location of [
    "/secret?accessToken=secret",
    "/secret?client_secret=secret",
    "/secret?code=secret",
    "/secret?sig=abc&accessToken=secret",
    "/secret?s-ig=abc",
  ]) {
    await withServer((_request, response) => {
      response.writeHead(302, { location });
      response.end();
    }, async (url) => {
      await assert.rejects(
        () =>
          fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
            lookup: localLookup as typeof dns.lookup,
            allow_private_for_tests: true,
          }),
        /URL query credentials are not supported/u,
        location
      );
    });
  }
});

test("fetchPublicHtml rejects redirects to local hostnames and special-use IP literals", async () => {
  for (const location of [
    "http://localhost./secret",
    "http://device.local/secret",
    "http://[::ffff:192.168.1.1]/secret",
    "http://192.0.2.1/secret",
    "http://192.88.99.1/secret",
    "http://[64:ff9b:1::1]/secret",
    "http://[2001::1]/secret",
    "http://[2001:2::1]/secret",
    "http://[2001:20::1]/secret",
    "http://[2002::1]/secret",
  ]) {
    await withServer((_request, response) => {
      response.writeHead(302, { location });
      response.end();
    }, async (url) => {
      await assert.rejects(
        () =>
          fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
            lookup: localLookup as typeof dns.lookup,
            allow_private_for_tests: true,
          }),
        /Local hostnames are not supported|non-public IP address/u,
        location
      );
    });
  }
});

test("fetchPublicHtml supports relative redirects and revalidates each hop", async () => {
  let lookupAllCount = 0;
  function countingLookup(
    hostname: string,
    options: unknown,
    callback: unknown
  ): void {
    const cb = typeof options === "function" ? options : callback;
    const wantsAll =
      typeof options === "object" &&
      options !== null &&
      "all" in options &&
      (options as dns.LookupAllOptions).all === true;

    if (wantsAll) {
      lookupAllCount += 1;
      (
        cb as (
          error: NodeJS.ErrnoException | null,
          addresses: dns.LookupAddress[]
        ) => void
      )(null, [{ address: "127.0.0.1", family: 4 }]);
      return;
    }

    (cb as dns.LookupOneCallback)(null, "127.0.0.1", 4);
  }

  await withServer((request, response) => {
    if (request.url === "/start") {
      response.writeHead(302, { location: "/final" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Final</body></html>");
  }, async (url) => {
    const result = await fetchPublicHtml(
      `${url.replace("127.0.0.1", "example.com")}/start`,
      {
        lookup: countingLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.final_url, `${url.replace("127.0.0.1", "example.com")}/final`);
    assert.equal(lookupAllCount, 2);
  });
});

test("fetchPublicHtml allows five redirects and rejects the sixth before parsing Location", async () => {
  await withServer((request, response) => {
    const current = Number(request.url?.slice(1) || "0");
    if (current < 5) {
      response.writeHead(302, { location: `/${current + 1}` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Final</body></html>");
  }, async (url) => {
    const result = await fetchPublicHtml(
      `${url.replace("127.0.0.1", "example.com")}/0`,
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.final_url, `${url.replace("127.0.0.1", "example.com")}/5`);
  });

  await withServer((request, response) => {
    const current = Number(request.url?.slice(1) || "0");
    if (current < 5) {
      response.writeHead(302, { location: `/${current + 1}` });
      response.end();
      return;
    }
    response.writeHead(302, { location: "http://[::1" });
    response.end();
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(`${url.replace("127.0.0.1", "example.com")}/0`, {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /Too many redirects; maximum is 5/u
    );
  });
});

test("fetchPublicHtml rejects unsupported content encodings", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-encoding": "compress",
    });
    response.end("<html></html>");
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /Unsupported content-encoding/u
    );
  });
});

test("fetchPublicHtml times out while waiting for response headers", async () => {
  await withServer((_request, _response) => {
    // Intentionally keep the socket open without sending response headers.
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
          timeout_ms: 50,
        }),
      /timed out/u
    );
  });
});

test("fetchPublicHtml rejects responses over the wire byte limit", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(6 * 1024 * 1024 + 1),
    });
    response.end(Buffer.alloc(6 * 1024 * 1024 + 1, 0x20));
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /wire response exceeded 6 MiB limit/u
    );
  });
});

test("fetchPublicHtml enforces the streaming wire byte limit without content-length", async () => {
  let responseClosed = false;
  await withServer((_request, response) => {
    response.on("close", () => {
      responseClosed = true;
    });
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(Buffer.alloc(MAX_WIRE_BYTES + 1, 0x20));
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /wire response exceeded 6 MiB limit/u
    );
    assert.equal(responseClosed, true);
  });
});

test("fetchPublicHtml rejects responses over the decoded byte limit", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-encoding": "gzip",
    });
    response.end(zlib.gzipSync(Buffer.alloc(5 * 1024 * 1024 + 1, 0x20)));
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /decoded response exceeded 5 MiB limit/u
    );
  });
});

test("fetchPublicHtml decodes windows-1252 when declared", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=windows-1252",
    });
    response.end(
      Buffer.from([
        0x3c, 0x70, 0x3e, 0x93, 0x48, 0x69, 0x94, 0x3c, 0x2f, 0x70,
        0x3e,
      ])
    );
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.decoded_html, "<p>“Hi”</p>");
  });
});

test("fetchPublicHtml warns when charset is missing and utf8 succeeds", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<p>Hi</p>");
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.deepEqual(result.warnings, ["charset_missing_assumed_utf8"]);
  });
});

test("fetchPublicHtml uses UTF-8 BOM before declared charset and strips it", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=windows-1252",
    });
    response.end(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<p>Hi</p>")]));
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.charset, "utf-8");
    assert.equal(result.decoded_html, "<p>Hi</p>");
  });
});

test("fetchPublicHtml rejects unsupported BOM and declared charsets", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(Buffer.from([0xff, 0xfe, 0x3c, 0x00]));
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /Unsupported charset/u
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=shift_jis" });
    response.end("<p>Hi</p>");
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /Unsupported charset/u
    );
  });
});

test("fetchPublicHtml detects meta charset and http-equiv charset in first 4096 bytes", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      Buffer.concat([
        Buffer.from('<html><head><meta charset="iso-8859-1"></head><body>'),
        Buffer.from([0xe9]),
        Buffer.from("</body></html>"),
      ])
    );
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.charset, "iso-8859-1");
    assert.match(result.decoded_html, /é/u);
    assert.deepEqual(result.warnings, []);
  });

  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      Buffer.concat([
        Buffer.from(
          '<html><head><meta http-equiv="content-type" content="text/html; charset=windows-1252"></head><body>'
        ),
        Buffer.from([0x93, 0x48, 0x69, 0x94]),
        Buffer.from("</body></html>"),
      ])
    );
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.charset, "windows-1252");
    assert.match(result.decoded_html, /“Hi”/u);
    assert.deepEqual(result.warnings, []);
  });
});

test("fetchPublicHtml uses Content-Type charset before conflicting meta declarations", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=iso-8859-1",
    });
    response.end(
      Buffer.concat([
        Buffer.from(
          '<html><head><meta charset="windows-1252"><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body>'
        ),
        Buffer.from([0xe9]),
        Buffer.from("</body></html>"),
      ])
    );
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.charset, "iso-8859-1");
    assert.match(result.decoded_html, /é/u);
    assert.deepEqual(result.warnings, []);
  });
});

test("fetchPublicHtml uses real meta charset before preceding http-equiv content-type", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      Buffer.concat([
        Buffer.from(
          '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"><meta charset="windows-1252"></head><body>'
        ),
        Buffer.from([0x93, 0x48, 0x69, 0x94]),
        Buffer.from("</body></html>"),
      ])
    );
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.charset, "windows-1252");
    assert.match(result.decoded_html, /“Hi”/u);
    assert.deepEqual(result.warnings, []);
  });
});

test("fetchPublicHtml uses http-equiv content-type only when real meta charset is absent", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      Buffer.concat([
        Buffer.from(
          '<html><head><meta http-equiv="content-type" content="text/html; charset=windows-1252"></head><body>'
        ),
        Buffer.from([0x93, 0x48, 0x69, 0x94]),
        Buffer.from("</body></html>"),
      ])
    );
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.charset, "windows-1252");
    assert.match(result.decoded_html, /“Hi”/u);
    assert.deepEqual(result.warnings, []);
  });
});

test("fetchPublicHtml ignores meta declarations after first 4096 bytes", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      `${" ".repeat(4096)}<meta charset="windows-1252"><p>Hi</p>`
    );
  }, async (url) => {
    const result = await fetchPublicHtml(
      url.replace("127.0.0.1", "example.com"),
      {
        lookup: localLookup as typeof dns.lookup,
        allow_private_for_tests: true,
      }
    );
    assert.equal(result.charset, "utf-8");
    assert.match(result.decoded_html, /<p>Hi<\/p>/u);
    assert.deepEqual(result.warnings, ["charset_missing_assumed_utf8"]);
  });
});

test("fetchPublicHtml rejects UTF-16 and UTF-32 BOMs", async () => {
  for (const bom of [
    [0xff, 0xfe],
    [0xfe, 0xff],
    [0xff, 0xfe, 0x00, 0x00],
    [0x00, 0x00, 0xfe, 0xff],
  ]) {
    await withServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(Buffer.from([...bom, 0x3c, 0x70, 0x3e]));
    }, async (url) => {
      await assert.rejects(
        () =>
          fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
            lookup: localLookup as typeof dns.lookup,
            allow_private_for_tests: true,
          }),
        /Unsupported charset/u
      );
    });
  }
});

test("fetchPublicHtml rejects undeclared invalid utf8 and non-ascii us-ascii", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0x3c, 0x2f, 0x70, 0x3e]));
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /encoded data was not valid|invalid/i
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=us-ascii" });
    response.end(Buffer.from([0x3c, 0x70, 0x3e, 0x80, 0x3c, 0x2f, 0x70, 0x3e]));
  }, async (url) => {
    await assert.rejects(
      () =>
        fetchPublicHtml(url.replace("127.0.0.1", "example.com"), {
          lookup: localLookup as typeof dns.lookup,
          allow_private_for_tests: true,
        }),
      /US-ASCII content contains non-ASCII bytes/u
    );
  });
});
