import type { ToolResult, WorkspaceConfig } from "../types";
import { getSearchIndexStatus, type SearchIndexStatus } from "../core/wiki-search";

export interface KbSearchIndexStatusInput {}

export async function kbSearchIndexStatus(
  _input: KbSearchIndexStatusInput,
  config: WorkspaceConfig
): Promise<ToolResult<SearchIndexStatus>> {
  try {
    return { success: true, data: getSearchIndexStatus(config) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
