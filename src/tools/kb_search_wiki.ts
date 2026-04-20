import type { SearchQuery, SearchResult, ToolResult, WorkspaceConfig } from "../types";
import { searchWiki } from "../core/wiki-search";

export async function kbSearchWiki(
  input: SearchQuery,
  config: WorkspaceConfig
): Promise<ToolResult<SearchResult[]>> {
  try {
    return { success: true, data: searchWiki(input, config) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
