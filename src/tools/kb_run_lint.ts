import { runKbLint } from "../core/wiki-maintenance";
import type { KbLintReport } from "../core/wiki-maintenance";
import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbRunLintInput {
  include_semantic?: boolean;
}

export async function kbRunLint(
  input: KbRunLintInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbLintReport>> {
  try {
    return {
      success: true,
      data: runKbLint(config, input),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
