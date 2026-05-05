import * as path from "path";

import { KB_CANONICAL_TOOL_NAMES } from "../runtime/kb_tool_contract";
import type { InstallerProbeSnapshot } from "./types";

export const EXPECTED_KB_TOOL_NAMES = [...KB_CANONICAL_TOOL_NAMES];

export interface ProbeKbMcpServerOptions {
  serverEntrypoint: string;
  kbRoot: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  nodeCommand?: string;
  timeoutMs?: number;
  expectedToolNames?: readonly string[];
}

export interface ProbeKbMcpServerResult extends InstallerProbeSnapshot {
  expectedToolNames: string[];
  missingToolNames: string[];
  unexpectedToolNames: string[];
  duplicateToolNames: string[];
  stderr: string;
  serverVersion?: {
    name: string;
    version: string;
  };
}

export async function probeKbMcpServer(
  options: ProbeKbMcpServerOptions
): Promise<ProbeKbMcpServerResult> {
  const checkedAt = new Date().toISOString();
  const serverEntrypoint = path.resolve(options.serverEntrypoint);
  const kbRoot = path.resolve(options.kbRoot);
  const cwd = options.cwd ?? path.dirname(serverEntrypoint);
  const nodeCommand = options.nodeCommand ?? process.execPath;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const expectedToolNames = [...(options.expectedToolNames ?? EXPECTED_KB_TOOL_NAMES)];

  const stderrChunks: string[] = [];
  let toolNames: string[] = [];

  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);

  const transport = new StdioClientTransport({
    command: nodeCommand,
    args: [serverEntrypoint],
    cwd,
    env: {
      ...process.env,
      ...options.env,
      KB_ROOT: kbRoot,
    },
    stderr: "pipe",
  });

  const stderrStream = transport.stderr;
  if (isEncodableStream(stderrStream)) {
    stderrStream.setEncoding("utf8");
  }

  stderrStream?.on("data", (chunk: string | Buffer) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });

  const client = new Client({
    name: "kb-openclaw-installer-probe",
    version: "0.1.0",
  });

  try {
    await withTimeout(client.connect(transport), timeoutMs, "MCP initialize timed out");

    const listedTools = await withTimeout(client.listTools(), timeoutMs, "MCP tools/list timed out");
    toolNames = listedTools.tools.map((tool) => tool.name);

    const missingToolNames = expectedToolNames.filter((name) => !toolNames.includes(name));
    const unexpectedToolNames = toolNames.filter((name) => !expectedToolNames.includes(name));
    const duplicateToolNames = findDuplicateToolNames(toolNames);
    const orderDrift = hasToolOrderDrift(toolNames, expectedToolNames);
    const surfaceOk =
      missingToolNames.length === 0 &&
      unexpectedToolNames.length === 0 &&
      duplicateToolNames.length === 0 &&
      !orderDrift;
    if (!surfaceOk) {
      return {
        checkedAt,
        ok: false,
        toolNames,
        expectedToolNames,
        missingToolNames,
        unexpectedToolNames,
        duplicateToolNames,
        stderr: joinStderr(stderrChunks),
        serverVersion: normalizeServerVersion(client.getServerVersion()),
        failureReason: buildToolSurfaceFailureReason({
          missingToolNames,
          unexpectedToolNames,
          duplicateToolNames,
          orderDrift,
          expectedToolNames,
          actualToolNames: toolNames,
        }),
      };
    }

    return {
      checkedAt,
      ok: true,
      toolNames,
      expectedToolNames,
      missingToolNames: [],
      unexpectedToolNames: [],
      duplicateToolNames: [],
      stderr: joinStderr(stderrChunks),
      serverVersion: normalizeServerVersion(client.getServerVersion()),
    };
  } catch (error) {
    return {
      checkedAt,
      ok: false,
      toolNames,
      expectedToolNames,
      missingToolNames: expectedToolNames.filter((name) => !toolNames.includes(name)),
      unexpectedToolNames: toolNames.filter((name) => !expectedToolNames.includes(name)),
      duplicateToolNames: findDuplicateToolNames(toolNames),
      stderr: joinStderr(stderrChunks),
      failureReason: buildProbeFailureReason(error, stderrChunks),
      serverVersion: normalizeServerVersion(client.getServerVersion()),
    };
  } finally {
    await safeClose(client);
  }
}

function findDuplicateToolNames(toolNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of toolNames) {
    if (seen.has(name)) {
      duplicates.add(name);
      continue;
    }
    seen.add(name);
  }
  return [...duplicates].sort((left, right) => left.localeCompare(right));
}

function hasToolOrderDrift(
  actualToolNames: readonly string[],
  expectedToolNames: readonly string[]
): boolean {
  if (actualToolNames.length !== expectedToolNames.length) {
    return false;
  }
  const actualSet = new Set(actualToolNames);
  if (actualSet.size !== actualToolNames.length) {
    return false;
  }
  if (!expectedToolNames.every((name) => actualSet.has(name))) {
    return false;
  }
  return actualToolNames.some((name, index) => name !== expectedToolNames[index]);
}

function buildToolSurfaceFailureReason(options: {
  missingToolNames: readonly string[];
  unexpectedToolNames: readonly string[];
  duplicateToolNames: readonly string[];
  orderDrift: boolean;
  expectedToolNames: readonly string[];
  actualToolNames: readonly string[];
}): string {
  return [
    options.missingToolNames.length > 0
      ? `Missing expected MCP tools: ${options.missingToolNames.join(", ")}`
      : undefined,
    options.unexpectedToolNames.length > 0
      ? `Unexpected MCP tools: ${options.unexpectedToolNames.join(", ")}`
      : undefined,
    options.duplicateToolNames.length > 0
      ? `Duplicate MCP tools: ${options.duplicateToolNames.join(", ")}`
      : undefined,
    options.orderDrift
      ? `MCP tool order drift: expected=${options.expectedToolNames.join(", ")} actual=${options.actualToolNames.join(", ")}`
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" | ");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildProbeFailureReason(error: unknown, stderrChunks: readonly string[]): string {
  const baseMessage = error instanceof Error ? error.message : String(error);
  const stderr = joinStderr(stderrChunks);
  return stderr ? `${baseMessage} | stderr: ${stderr}` : baseMessage;
}

function joinStderr(stderrChunks: readonly string[]): string {
  return stderrChunks.join("").trim();
}

function normalizeServerVersion(
  value: unknown
): ProbeKbMcpServerResult["serverVersion"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = typeof value.name === "string" ? value.name : undefined;
  const version = typeof value.version === "string" ? value.version : undefined;

  if (!name || !version) {
    return undefined;
  }

  return { name, version };
}

async function safeClose(client: { close(): Promise<void> }): Promise<void> {
  try {
    await client.close();
  } catch {
    // Ignore close errors so probe failures report the original reason.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEncodableStream(
  value: unknown
): value is NodeJS.ReadableStream & { setEncoding(encoding: BufferEncoding): void } {
  return (
    typeof value === "object" &&
    value !== null &&
    "setEncoding" in value &&
    typeof value.setEncoding === "function" &&
    "on" in value &&
    typeof value.on === "function"
  );
}
