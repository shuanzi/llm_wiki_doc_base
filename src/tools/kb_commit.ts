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
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    const details = `${message}\n${stderr}`;

    if (details.includes("nothing to commit")) {
      return { success: false, error: "No changes in kb/ to commit." };
    }

    if (details.includes("No staged changes")) {
      return { success: false, error: message };
    }

    return { success: false, error: message };
  }
}
