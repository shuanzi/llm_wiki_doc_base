#!/usr/bin/env node
/**
 * MCP stdio server exposing all 8 V2 knowledge-base tools.
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

import * as fs from "fs";
import * as path from "path";

import { Server } from "@modelcontextprotocol/sdk/server";

import { kbSourceAdd } from "./tools/kb_source_add";
import { kbReadSource } from "./tools/kb_read_source";
import { kbWritePage } from "./tools/kb_write_page";
import { kbUpdateSection } from "./tools/kb_update_section";
import { kbEnsureEntry } from "./tools/kb_ensure_entry";
import { kbSearchWiki } from "./tools/kb_search_wiki";
import { kbReadPage } from "./tools/kb_read_page";
import { kbCommit } from "./tools/kb_commit";
import { kbRebuildIndex } from "./tools/kb_rebuild_index";
import { kbRunLint } from "./tools/kb_run_lint";
import { kbRepair } from "./tools/kb_repair";

import type { WorkspaceConfig } from "./types";

// ---------------------------------------------------------------------------
// Workspace config — resolved once at startup
// ---------------------------------------------------------------------------

let kb_root: string;
let kbRootSource: string;

if (process.env.KB_ROOT) {
  kb_root = path.resolve(process.env.KB_ROOT);
  kbRootSource = "KB_ROOT";
} else if (process.env.WORKSPACE_ROOT) {
  kb_root = path.resolve(process.env.WORKSPACE_ROOT, "kb");
  kbRootSource = "WORKSPACE_ROOT";
} else {
  kb_root = path.resolve("./kb");
  kbRootSource = "default (cwd/kb)";
}

// Startup guard — must run BEFORE the server connects to MCP transport
if (!fs.existsSync(kb_root) || !fs.statSync(kb_root).isDirectory()) {
  process.stderr.write(
    `[kb-mcp] FATAL: kb_root does not exist or is not a directory.\n` +
      `  resolved path : ${kb_root}\n` +
      `  driven by     : ${kbRootSource}\n` +
      `Set KB_ROOT (absolute path to the kb directory) or WORKSPACE_ROOT (repo root) correctly.\n`
  );
  process.exit(2);
}

const config: WorkspaceConfig = { kb_root };

// ---------------------------------------------------------------------------
// Tool definitions (name + description + JSON Schema input)
// ---------------------------------------------------------------------------

const WORKFLOW_TOOL_DEFINITIONS = [
  {
    name: "kb_source_add",
    description:
      "Register a supported local source file into the knowledge base. Markdown is preserved; other supported formats are converted to canonical Markdown via MarkItDown. ZIP, OCR/images, audio transcription, Outlook, YouTube URLs, and plugins are disabled.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or relative path to the source file to ingest.",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "kb_read_source",
    description:
      "Read canonical Markdown source content by source_id. Defaults to 200 KB windows and supports byte pagination.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source_id: {
          type: "string",
          description: "The source_id returned by kb_source_add.",
        },
        offset_bytes: {
          type: "number",
          description: "Byte offset into the canonical Markdown source. Default: 0.",
        },
        max_bytes: {
          type: "number",
          description: "Maximum canonical Markdown bytes to return. Default: 204800.",
        },
      },
      required: ["source_id"],
    },
  },
  {
    name: "kb_write_page",
    description:
      "Create or update a wiki page. Validates YAML frontmatter and refreshes page-index.json.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the wiki page, relative to kb/ (e.g. wiki/concepts/foo.md).",
        },
        content: {
          type: "string",
          description: "Full Markdown content including YAML frontmatter block.",
        },
        create_only: {
          type: "boolean",
          description: "If true, fail if the file already exists. Default: false.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "kb_update_section",
    description:
      "Update (replace or append to) a specific heading section in an existing wiki page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the wiki page, relative to kb/.",
        },
        heading: {
          type: "string",
          description: "Exact heading line to find (e.g. '## Summary').",
        },
        content: {
          type: "string",
          description: "New content to place under the heading.",
        },
        append: {
          type: "boolean",
          description: "If true, append content after existing section content. Default: false.",
        },
        create_if_missing: {
          type: "boolean",
          description:
            "If true, create the section at end of file when heading is not found. Default: true.",
        },
      },
      required: ["path", "heading", "content"],
    },
  },
  {
    name: "kb_ensure_entry",
    description:
      "Idempotently insert a line entry into an index or log page. Uses a dedup_key to prevent duplicates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the wiki page, relative to kb/.",
        },
        entry: {
          type: "string",
          description: "The line content to insert.",
        },
        anchor: {
          type: ["string", "null"],
          description:
            "Exact anchor line after which to insert the entry. Pass null to append at end of file.",
        },
        dedup_key: {
          type: "string",
          description: "Unique key used for idempotency — if already present, no-op.",
        },
      },
      required: ["path", "entry", "anchor", "dedup_key"],
    },
  },
  {
    name: "kb_search_wiki",
    description:
      "Search the wiki via page-index.json. Supports keyword search, type/tag filtering, and wikilink resolution.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Keyword query string.",
        },
        type_filter: {
          type: "string",
          description: "Filter results to a specific page type (e.g. 'concept', 'entity').",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Require all listed tags to be present on matching pages.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Default: 10.",
        },
        resolve_link: {
          type: "string",
          description:
            "If set, resolve this wikilink (e.g. '[[Foo]]' or 'Foo') and return the matching page (ignores query).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "kb_read_page",
    description:
      "Read a wiki page by path or page_id. Returns frontmatter and body separately.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path_or_id: {
          type: "string",
          description:
            "Path relative to kb/ (e.g. wiki/concepts/foo.md) OR a page_id (e.g. 'foo').",
        },
      },
      required: ["path_or_id"],
    },
  },
  {
    name: "kb_commit",
    description:
      "Stage all kb/ changes and create a Git commit. Message should follow: 'kb: <action> <source_id> and <description>'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "Git commit message.",
        },
      },
      required: ["message"],
    },
  },
] as const;

const MAINTENANCE_TOOL_DEFINITIONS = [
  {
    name: "kb_rebuild_index",
    description:
      "Rebuild kb/state/cache/page-index.json from kb/wiki/**/*.md deterministically.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "kb_run_lint",
    description:
      "Run deterministic and semantic lint checks for the KB. Deterministic checks are strict and semantic checks are advisory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        include_semantic: {
          type: "boolean",
          description: "Include semantic advisory checks in the report. Default: true.",
        },
      },
    },
  },
  {
    name: "kb_repair",
    description:
      "Repair structural KB artifacts only: restore missing or malformed meta pages and rebuild page-index.json. Does not modify content pages.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dry_run: {
          type: "boolean",
          description: "If true, report intended structural fixes without mutating kb/.",
        },
      },
    },
  },
] as const;

const TOOL_DEFINITIONS = [
  ...WORKFLOW_TOOL_DEFINITIONS,
  ...MAINTENANCE_TOOL_DEFINITIONS,
] as const;

// ---------------------------------------------------------------------------
// Tool dispatch map
// ---------------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;
type ToolResult = { success: boolean; data?: unknown; error?: string };
type ToolHandler = (args: ToolArgs, config: WorkspaceConfig) => Promise<ToolResult>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  kb_source_add: (args, workspace) =>
    kbSourceAdd(args as unknown as Parameters<typeof kbSourceAdd>[0], workspace),
  kb_read_source: (args, workspace) =>
    kbReadSource(args as unknown as Parameters<typeof kbReadSource>[0], workspace),
  kb_write_page: (args, workspace) =>
    kbWritePage(args as unknown as Parameters<typeof kbWritePage>[0], workspace),
  kb_update_section: (args, workspace) =>
    kbUpdateSection(args as unknown as Parameters<typeof kbUpdateSection>[0], workspace),
  kb_ensure_entry: (args, workspace) =>
    kbEnsureEntry(args as unknown as Parameters<typeof kbEnsureEntry>[0], workspace),
  kb_search_wiki: (args, workspace) =>
    kbSearchWiki(args as unknown as Parameters<typeof kbSearchWiki>[0], workspace),
  kb_read_page: (args, workspace) =>
    kbReadPage(args as unknown as Parameters<typeof kbReadPage>[0], workspace),
  kb_commit: (args, workspace) =>
    kbCommit(args as unknown as Parameters<typeof kbCommit>[0], workspace),
  kb_rebuild_index: (args, workspace) =>
    kbRebuildIndex(args as unknown as Parameters<typeof kbRebuildIndex>[0], workspace),
  kb_run_lint: (args, workspace) =>
    kbRunLint(args as unknown as Parameters<typeof kbRunLint>[0], workspace),
  kb_repair: (args, workspace) =>
    kbRepair(args as unknown as Parameters<typeof kbRepair>[0], workspace),
};

async function dispatchTool(name: string, args: ToolArgs): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { success: false, error: `Unknown tool: ${name}` };
  }
  return handler(args, config);
}

function listToolsResponse(): { tools: typeof TOOL_DEFINITIONS } {
  return { tools: TOOL_DEFINITIONS };
}

async function callToolResponse(
  request: { params: { name: string; arguments?: ToolArgs } }
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}> {
  const { name, arguments: rawArgs } = request.params;
  const args: ToolArgs = rawArgs ?? {};
  const result = await dispatchTool(name, args);

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
  server.setRequestHandler(ListToolsRequestSchema, async () => listToolsResponse());

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
