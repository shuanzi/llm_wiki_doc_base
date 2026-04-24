#!/usr/bin/env node
/**
 * MCP stdio server exposing all 11 knowledge-base tools.
 *
 * KB_ROOT resolution order:
 *   1. process.env.KB_ROOT        → used as-is (absolute override for kb_root)
 *   2. process.env.WORKSPACE_ROOT → kb_root = path.resolve(WORKSPACE_ROOT, "kb")
 *      NOTE: WORKSPACE_ROOT means the REPO ROOT, not the kb directory itself.
 *   3. fallback                   → path.resolve("./kb") (cwd-relative)
 *
 * A startup guard verifies that the resolved kb_root exists and is a directory.
 * If the check fails the server logs a clear error to stderr and exits with
 * code 2 — before connecting the MCP transport, so a broken server is never
 * advertised to the client.
 *
 * Import note: @modelcontextprotocol/sdk@1.29.0 ships a dual ESM/CJS build whose
 * package.json wildcard export ("./*": "./dist/cjs/*") omits the .js extension,
 * so Node.js CJS require() cannot resolve it at runtime. Dynamic import() with an
 * explicit .js suffix in the specifier bypasses this and resolves correctly via the
 * same wildcard. Static `import type` declarations work at compile time because the
 * TypeScript bundler moduleResolution uses typesVersions ("*": ["./dist/esm/*"]).
 */

import { Server } from "@modelcontextprotocol/sdk/server";

import {
  buildKbRootMissingMessage,
  isExistingDirectory,
  resolveKbWorkspaceConfig,
} from "./runtime/kb_workspace_config";
import {
  dispatchKbTool,
  listKbToolsResponse,
} from "./runtime/kb_tool_runtime";

// ---------------------------------------------------------------------------
// Workspace config — resolved once at startup
// ---------------------------------------------------------------------------

const resolvedWorkspace = resolveKbWorkspaceConfig();
const config = resolvedWorkspace.config;

// Startup guard — must run BEFORE the server connects to MCP transport
if (!isExistingDirectory(config.kb_root)) {
  process.stderr.write(
    buildKbRootMissingMessage({
      kbRoot: config.kb_root,
      kbRootSource: resolvedWorkspace.kbRootSource,
      prefix: "[kb-mcp]",
    })
  );
  process.exit(2);
}

type ToolArgs = Record<string, unknown>;

async function callToolResponse(
  request: { params: { name: string; arguments?: ToolArgs } }
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}> {
  const { name, arguments: rawArgs } = request.params;
  const args: ToolArgs = rawArgs ?? {};
  const result = await dispatchKbTool(name, args, config);

  if (!result.success) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${result.error ?? "Unknown error"}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result.data, null, 2),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main — create server, register handlers, connect transport
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Dynamic import with explicit .js suffix resolves the SDK's wildcard export map
  // correctly at runtime (see top-of-file comment for why this is necessary).
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );
  const { StdioServerTransport: TypedStdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );

  const server = new Server(
    { name: "kb-mcp", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => listKbToolsResponse());

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, callToolResponse);

  const transport = new TypedStdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't pollute the JSON-RPC stdout stream
  process.stderr.write(`kb-mcp server started. kb_root=${config.kb_root}\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`);
  process.exit(1);
});
