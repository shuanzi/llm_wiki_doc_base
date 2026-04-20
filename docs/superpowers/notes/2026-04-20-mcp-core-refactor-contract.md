# MCP Contract Inventory

Source snapshot: `src/mcp_server.ts` as of 2026-04-20.

## Tool Surface

- `kb_source_add`
  - Description: register a source file into the knowledge base.
  - Input schema: `{ file_path: string }`
- `kb_read_source`
  - Description: read raw source content by `source_id`.
  - Input schema: `{ source_id: string }`
- `kb_write_page`
  - Description: create or update a wiki page and refresh `page-index.json`.
  - Input schema: `{ path: string, content: string, create_only?: boolean }`
- `kb_update_section`
  - Description: update or append to a specific heading section in a wiki page.
  - Input schema: `{ path: string, heading: string, content: string, append?: boolean, create_if_missing?: boolean }`
- `kb_ensure_entry`
  - Description: idempotently insert a line entry into an index or log page.
  - Input schema: `{ path: string, entry: string, anchor: string | null, dedup_key: string }`
- `kb_search_wiki`
  - Description: search `page-index.json` by keyword, type, tags, or wikilink resolution.
  - Input schema: `{ query: string, type_filter?: string, tags?: string[], limit?: number, resolve_link?: string }`
- `kb_read_page`
  - Description: read a wiki page by path or `page_id`.
  - Input schema: `{ path_or_id: string }`
- `kb_commit`
  - Description: stage kb changes and create a git commit.
  - Input schema: `{ message: string }`

## Dispatch Behavior

- Tool dispatch is a direct `switch` on tool name in `dispatchTool`.
- Known tool names call the corresponding tool function with the raw args and the shared `config`.
- Unknown tool names return `{ success: false, error: "Unknown tool: <name>" }`.
- The MCP `CallTool` handler wraps failures as `Error: <message>` and sets `isError: true`.
- Successful tool results are returned as `JSON.stringify(result.data, null, 2)`.

## Error Wrapping Style

- Tool implementations return `{ success: false, error: string }` for recoverable failures.
- The transport layer does not throw tool errors directly.
- The only transport-level error wrapper is the MCP response text prefix `Error: `.

