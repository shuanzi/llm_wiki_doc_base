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
import type { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";

import { kbSourceAdd } from "./tools/kb_source_add";
import { kbReadSource } from "./tools/kb_read_source";
import { kbWritePage } from "./tools/kb_write_page";
import { kbUpdateSection } from "./tools/kb_update_section";
import { kbEnsureEntry } from "./tools/kb_ensure_entry";
import { kbSearchWiki } from "./tools/kb_search_wiki";
import { kbReadPage } from "./tools/kb_read_page";
import { kbCommit } from "./tools/kb_commit";

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

const TOOL_DEFINITIONS = [
  {
    name: "kb_source_add",
    description:
      "Register a source file (.md or .txt) into the knowledge base. Returns manifest and source_id.",
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
      "Read raw source content by source_id. Large files are truncated at 200 KB.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source_id: {
          type: "string",
          description: "The source_id returned by kb_source_add.",
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

// ---------------------------------------------------------------------------
// Tool dispatch map
// ---------------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;

async function dispatchTool(
  name: string,
  args: ToolArgs
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  switch (name) {
    case "kb_source_add":
      return kbSourceAdd(args as unknown as Parameters<typeof kbSourceAdd>[0], config);

    case "kb_read_source":
      return kbReadSource(args as unknown as Parameters<typeof kbReadSource>[0], config);

    case "kb_write_page":
      return kbWritePage(args as unknown as Parameters<typeof kbWritePage>[0], config);

    case "kb_update_section":
      return kbUpdateSection(
        args as unknown as Parameters<typeof kbUpdateSection>[0],
        config
      );

    case "kb_ensure_entry":
      return kbEnsureEntry(
        args as unknown as Parameters<typeof kbEnsureEntry>[0],
        config
      );

    case "kb_search_wiki":
      return kbSearchWiki(args as unknown as Parameters<typeof kbSearchWiki>[0], config);

    case "kb_read_page":
      return kbReadPage(args as unknown as Parameters<typeof kbReadPage>[0], config);

    case "kb_commit":
      return kbCommit(args as unknown as Parameters<typeof kbCommit>[0], config);

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
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
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_DEFINITIONS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params as {
      name: string;
      arguments?: ToolArgs;
    };
    const args: ToolArgs = rawArgs ?? {};

    const result = await dispatchTool(name, args);

    if (!result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${result.error ?? "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result.data, null, 2),
        },
      ],
    };
  });

  const transport = new TypedStdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't pollute the JSON-RPC stdout stream
  process.stderr.write(`kb-mcp server started. kb_root=${config.kb_root}\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`);
  process.exit(1);
});
