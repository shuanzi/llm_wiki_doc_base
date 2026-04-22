# MCP Contract Inventory

Source snapshot: `src/mcp_server.ts` as of 2026-04-20.
This note mirrors the current `TOOL_DEFINITIONS` array and request handlers in
the source file.

## Tool Surface

```text
kb_source_add
  description: "Register a source file (.md or .txt) into the knowledge base. Returns manifest and source_id."
  inputSchema:
    type: "object"
    properties:
      file_path:
        type: "string"
        description: "Absolute or relative path to the source file to ingest."
    required: ["file_path"]

kb_read_source
  description: "Read raw source content by source_id. Large files are truncated at 200 KB."
  inputSchema:
    type: "object"
    properties:
      source_id:
        type: "string"
        description: "The source_id returned by kb_source_add."
    required: ["source_id"]

kb_write_page
  description: "Create or update a wiki page. Validates YAML frontmatter and refreshes page-index.json."
  inputSchema:
    type: "object"
    properties:
      path:
        type: "string"
        description: "Path to the wiki page, relative to kb/ (e.g. wiki/concepts/foo.md)."
      content:
        type: "string"
        description: "Full Markdown content including YAML frontmatter block."
      create_only:
        type: "boolean"
        description: "If true, fail if the file already exists. Default: false."
    required: ["path", "content"]

kb_update_section
  description: "Update (replace or append to) a specific heading section in an existing wiki page."
  inputSchema:
    type: "object"
    properties:
      path:
        type: "string"
        description: "Path to the wiki page, relative to kb/."
      heading:
        type: "string"
        description: "Exact heading line to find (e.g. '## Summary')."
      content:
        type: "string"
        description: "New content to place under the heading."
      append:
        type: "boolean"
        description: "If true, append content after existing section content. Default: false."
      create_if_missing:
        type: "boolean"
        description: "If true, create the section at end of file when heading is not found. Default: true."
    required: ["path", "heading", "content"]

kb_ensure_entry
  description: "Idempotently insert a line entry into an index or log page. Uses a dedup_key to prevent duplicates."
  inputSchema:
    type: "object"
    properties:
      path:
        type: "string"
        description: "Path to the wiki page, relative to kb/."
      entry:
        type: "string"
        description: "The line content to insert."
      anchor:
        type: ["string", "null"]
        description: "Exact anchor line after which to insert the entry. Pass null to append at end of file."
      dedup_key:
        type: "string"
        description: "Unique key used for idempotency — if already present, no-op."
    required: ["path", "entry", "anchor", "dedup_key"]

kb_search_wiki
  description: "Search the wiki via page-index.json. Supports keyword search, type/tag filtering, and wikilink resolution."
  inputSchema:
    type: "object"
    properties:
      query:
        type: "string"
        description: "Keyword query string."
      type_filter:
        type: "string"
        description: "Filter results to a specific page type (e.g. 'concept', 'entity')."
      tags:
        type: "array"
        items:
          type: "string"
        description: "Require all listed tags to be present on matching pages."
      limit:
        type: "number"
        description: "Maximum number of results to return. Default: 10."
      resolve_link:
        type: "string"
        description: "If set, resolve this wikilink (e.g. '[[Foo]]' or 'Foo') and return the matching page (ignores query)."
    required: ["query"]

kb_read_page
  description: "Read a wiki page by path or page_id. Returns frontmatter and body separately."
  inputSchema:
    type: "object"
    properties:
      path_or_id:
        type: "string"
        description: "Path relative to kb/ (e.g. wiki/concepts/foo.md) OR a page_id (e.g. 'foo')."
    required: ["path_or_id"]

kb_commit
  description: "Stage all kb/ changes and create a Git commit. Message should follow: 'kb: <action> <source_id> and <description>'."
  inputSchema:
    type: "object"
    properties:
      message:
        type: "string"
        description: "Git commit message."
    required: ["message"]
```

## Dispatch Behavior

- Tool dispatch is a direct `switch` on tool name in `dispatchTool`.
- Each known tool name calls the corresponding tool function with the raw args and shared `config`.
- Unknown tool names return `{ success: false, error: "Unknown tool: <name>" }`.
- The MCP `CallTool` handler returns successful tool output as `JSON.stringify(result.data, null, 2)`.

## Error Wrapping Style

- Tool implementations return `{ success: false, error: string }` for recoverable failures.
- The transport layer does not throw tool errors directly.
- Failed MCP tool calls are wrapped as a single text content item prefixed with `Error: ` and marked `isError: true`.
