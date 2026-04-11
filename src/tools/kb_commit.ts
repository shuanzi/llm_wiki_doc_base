import { execSync } from "child_process";
import * as path from "path";
import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbCommitInput {
  message: string;
}

export interface KbCommitOutput {
  commit_hash: string;
  message: string;
}

/**
 * kb_commit — Commit current kb/ changes to Git.
 *
 * Stages all changes under kb/ and commits with the provided message.
 * Message should follow: "kb: <action> <source_id> and <description>"
 */
export async function kbCommit(
  input: KbCommitInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbCommitOutput>> {
  try {
    const repoRoot = path.dirname(config.kb_root);
    const execOpts = { cwd: repoRoot, encoding: "utf8" as const };

    // Stage all kb/ changes
    execSync("git add kb/", execOpts);

    // Check if there are staged changes
    const status = execSync("git diff --cached --name-only -- kb/", execOpts).trim();
    if (!status) {
      return { success: false, error: "No staged changes in kb/ to commit." };
    }

    // Commit
    execSync(`git commit -m ${escapeShellArg(input.message)}`, execOpts);

    // Get the commit hash
    const commitHash = execSync("git rev-parse HEAD", execOpts).trim();

    return {
      success: true,
      data: { commit_hash: commitHash, message: input.message },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // If commit failed, try to get current HEAD for diagnostics
    if (message.includes("nothing to commit")) {
      return { success: false, error: "No changes in kb/ to commit." };
    }

    return { success: false, error: message };
  }
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
