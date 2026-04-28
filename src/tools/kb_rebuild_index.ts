import { rebuildPageIndex } from "../core/wiki-maintenance";
import type { RebuildPageIndexResult } from "../core/wiki-maintenance";
import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbRebuildIndexInput {
  allow_partial?: boolean;
}

export type KbRebuildIndexOutput = RebuildPageIndexResult;

export async function kbRebuildIndex(
  input: KbRebuildIndexInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbRebuildIndexOutput>> {
  try {
    return {
      success: true,
      data: rebuildPageIndex(config, input),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
