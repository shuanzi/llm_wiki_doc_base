import type { SearchQuery, SearchResult, ToolResult, WorkspaceConfig } from "../types";

/**
 * kb_search_wiki — Search the wiki layer via page-index.json.
 *
 * Performs keyword matching against title, aliases, tags, headings,
 * and body_excerpt. Supports type and tag filtering.
 */
export async function kbSearchWiki(
  input: SearchQuery,
  config: WorkspaceConfig
): Promise<ToolResult<SearchResult[]>> {
  // TODO: implement
  throw new Error("Not implemented");
}
