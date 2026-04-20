import { execSync } from "child_process";
import * as path from "path";
import type { WorkspaceConfig } from "../types";

export interface CommitKbChangesResult {
  commit_hash: string;
  message: string;
}

type WorkspaceLike = string | WorkspaceConfig;

function getKbRoot(workspace: WorkspaceLike): string {
  return typeof workspace === "string" ? workspace : workspace.kb_root;
}

function escapeShellArg(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function commitKbChanges(
  message: string,
  workspace: WorkspaceLike
): CommitKbChangesResult {
  const repoRoot = path.dirname(getKbRoot(workspace));
  const execOpts = { cwd: repoRoot, encoding: "utf8" as const };

  execSync("git add kb/", execOpts);

  const status = execSync("git diff --cached --name-only -- kb/", execOpts).trim();
  if (!status) {
    throw new Error("No staged changes in kb/ to commit.");
  }

  execSync(`git commit -m ${escapeShellArg(message)}`, execOpts);
  const commit_hash = execSync("git rev-parse HEAD", execOpts).trim();

  return {
    commit_hash,
    message,
  };
}
