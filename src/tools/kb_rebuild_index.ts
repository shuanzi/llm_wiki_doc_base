import { rebuildPageIndex } from "../core/wiki-maintenance";
import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbRebuildIndexInput {}

export interface KbRebuildIndexOutput {
  version: number;
  total_pages: number;
  written_to: string;
}

export async function kbRebuildIndex(
  _input: KbRebuildIndexInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbRebuildIndexOutput>> {
  try {
    return {
      success: true,
      data: rebuildPageIndex(config),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
