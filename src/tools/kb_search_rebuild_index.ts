import type { ToolResult, WorkspaceConfig } from "../types";
import {
  rebuildSearchIndexes,
  type RebuildSearchIndexOptions,
  type RebuildSearchIndexResult,
} from "../core/wiki-search";

export interface KbSearchRebuildIndexInput extends RebuildSearchIndexOptions {}

export async function kbSearchRebuildIndex(
  input: KbSearchRebuildIndexInput,
  config: WorkspaceConfig
): Promise<ToolResult<RebuildSearchIndexResult>> {
  try {
    return { success: true, data: rebuildSearchIndexes(config, input) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
