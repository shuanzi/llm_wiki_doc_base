import type { ToolResult, WorkspaceConfig } from "../types";
import { commitKbChanges } from "../core/git";

export interface KbCommitInput {
  message: string;
}

export interface KbCommitOutput {
  commit_hash: string;
  message: string;
}

export async function kbCommit(
  input: KbCommitInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbCommitOutput>> {
  try {
    return {
      success: true,
      data: commitKbChanges(input.message, config),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("nothing to commit") || message.includes("No staged changes")) {
      return { success: false, error: message };
    }

    return { success: false, error: message };
  }
}
