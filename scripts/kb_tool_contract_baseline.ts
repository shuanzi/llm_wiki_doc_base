export const VALIDATION_TOOL_DEFINITIONS = [
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
    name: "kb_url_add",
    description:
      "Register a public HTTP/HTTPS text/html URL into the knowledge base as canonical Markdown source content via Defuddle. Authenticated pages, JavaScript-only pages, private-network hosts, and async third-party extraction are disabled.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "Public HTTP/HTTPS URL to fetch and convert to canonical Markdown.",
        },
        accept_language: {
          type: "string",
          description: "Optional Accept-Language header for the URL fetch.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "kb_ingest_finalize",
    description:
      "Finalize source ingest lifecycle by marking a registered source as ingested or failed after wiki integration is complete.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source_id: {
          type: "string",
          description: "The source_id returned by kb_source_add.",
        },
        status: {
          type: "string",
          enum: ["ingested", "failed"],
          description: "Final ingest lifecycle status.",
        },
        summary_page_id: {
          type: "string",
          description: "Source summary page id, required when status is ingested.",
        },
        touched_pages: {
          type: "array",
          items: { type: "string" },
          description: "Wiki-relative page paths changed by the ingest, e.g. wiki/sources/src_sha256_x.md.",
        },
        error: {
          type: "string",
          description: "Failure reason when status is failed.",
        },
      },
      required: ["source_id", "status"],
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
          description: "The source_id returned by kb_source_add or kb_url_add.",
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
      "Create or update a wiki page. Validates YAML frontmatter and refreshes page-index.json/search-index.json.",
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
      "Idempotently insert a single-line entry into an index-like page. Uses a dedup_key to prevent duplicates; use kb_append_log_entry for multi-line log blocks.",
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
    name: "kb_append_log_entry",
    description:
      "Append a structured multi-line ingest/query/lint/repair entry to wiki/log.md idempotently. Prefer this over kb_ensure_entry for log blocks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Log page path relative to kb/. Default: wiki/log.md.",
        },
        kind: {
          type: "string",
          enum: ["ingest", "query", "lint", "repair"],
          description: "Operation kind for the log heading.",
        },
        title: {
          type: "string",
          description: "Log entry title.",
        },
        summary: {
          type: "string",
          description: "One-line summary/result/conclusion.",
        },
        date: {
          type: "string",
          description: "YYYY-MM-DD date. Default: today.",
        },
        run_id: {
          type: "string",
          description: "Optional unique run id, e.g. YYYYMMDDTHHMMSS.",
        },
        changes: {
          type: "array",
          items: { type: "string" },
          description: "Optional one-line changed-page summaries.",
        },
        references: {
          type: "array",
          items: { type: "string" },
          description: "Optional page ids or wikilinks referenced by this entry.",
        },
        output_page_id: {
          type: "string",
          description: "Optional output page id.",
        },
        output_label: {
          type: "string",
          description: "Optional display label for output_page_id.",
        },
        dedup_key: {
          type: "string",
          description: "Unique idempotency key for this log block.",
        },
      },
      required: ["kind", "title", "summary", "dedup_key"],
    },
  },
  {
    name: "kb_search_wiki",
    description:
      "Search the wiki via page-index.json or full-body search-index.json with auto-rebuild on missing cache. Supports keyword search, type/tag filtering, wikilink resolution, and page/chunk modes.",
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
        mode: {
          type: "string",
          enum: ["page", "chunk"],
          description: "Search mode. page uses page-index.json; chunk uses full-body search-index.json.",
        },
        resolve_link: {
          type: "string",
          description:
            "If set, resolve this wikilink (e.g. '[[Foo]]' or 'Foo') and return the matching page (ignores query).",
        },
      },
      required: [],
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
  {
    name: "kb_rebuild_index",
    description:
      "Rebuild kb/state/cache/page-index.json and kb/state/cache/search-index.json from kb/wiki/**/*.md deterministically. Fails fast on invalid pages unless allow_partial is true.",
    inputSchema: {
      type: "object" as const,
      properties: {
        allow_partial: {
          type: "boolean",
          description: "If true, write an index for valid pages and return skipped_pages for invalid pages. Default: false.",
        },
      },
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
      "Repair structural KB artifacts only: restore missing or malformed meta pages and rebuild page-index.json/search-index.json. Does not modify content pages.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dry_run: {
          type: "boolean",
          description: "If true, report intended structural fixes without mutating kb/.",
        },
        force: {
          type: "boolean",
          description: "If true, allow rewriting malformed structural pages such as wiki/index.md or wiki/log.md. Default: false.",
        },
      },
    },
  },
] as const;

export const VALIDATION_CANONICAL_TOOL_NAMES = VALIDATION_TOOL_DEFINITIONS.map(
  (tool) => tool.name
);
