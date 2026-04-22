import { repairKb } from "../core/wiki-maintenance";
import type { KbRepairResult } from "../core/wiki-maintenance";
import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbRepairInput {
  dry_run?: boolean;
}

export async function kbRepair(
  input: KbRepairInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbRepairResult>> {
  try {
    return {
      success: true,
      data: repairKb(config, input),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
