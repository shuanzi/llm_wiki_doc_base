import * as fs from "fs";
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

function isRepoRelativePath(relativePath: string): boolean {
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function findNearestExistingAncestor(targetPath: string): {
  existingAncestor: string;
  missingSegments: string[];
} {
  const missingSegments: string[] = [];
  let candidate = targetPath;

  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      break;
    }
    missingSegments.unshift(path.basename(candidate));
    candidate = parent;
  }

  if (!fs.existsSync(candidate)) {
    throw new Error(`Cannot resolve an existing ancestor for kb_root "${targetPath}".`);
  }

  return { existingAncestor: candidate, missingSegments };
}

function resolveKbGitScope(workspace: WorkspaceLike): { repoRoot: string; scope: string } {
  const kbRootInput = path.resolve(getKbRoot(workspace));
  const { existingAncestor, missingSegments } = findNearestExistingAncestor(kbRootInput);
  const existingAncestorReal = fs.realpathSync(existingAncestor);
  const kbRootCanonical =
    missingSegments.length > 0
      ? path.join(existingAncestorReal, ...missingSegments)
      : existingAncestorReal;
  const execOpts = { cwd: existingAncestor, encoding: "utf8" as const };

  let repoRoot: string;
  try {
    repoRoot = fs.realpathSync(
      execSync("git rev-parse --show-toplevel", {
        ...execOpts,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim()
    );
  } catch {
    throw new Error(
      `kb_root "${kbRootInput}" is not inside a git repository; kb_commit only supports KB roots within a git working tree.`
    );
  }

  const relativeKbRootCanonical = path.relative(repoRoot, kbRootCanonical);
  if (!isRepoRelativePath(relativeKbRootCanonical)) {
    throw new Error(
      `kb_root "${kbRootInput}" is outside the git repository "${repoRoot}"; kb_commit cannot safely scope the commit.`
    );
  }

  const scope = (relativeKbRootCanonical || ".").split(path.sep).join("/");
  return { repoRoot, scope };
}

export function commitKbChanges(
  message: string,
  workspace: WorkspaceLike
): CommitKbChangesResult {
  const { repoRoot, scope } = resolveKbGitScope(workspace);
  const execOpts = { cwd: repoRoot, encoding: "utf8" as const };
  const escapedScope = escapeShellArg(scope);

  execSync(`git add -- ${escapedScope}`, execOpts);

  const status = execSync(`git diff --cached --name-only -- ${escapedScope}`, execOpts).trim();
  if (!status) {
    throw new Error(`No staged changes in "${scope}" to commit.`);
  }

  execSync(`git commit -m ${escapeShellArg(message)}`, execOpts);
  const commit_hash = execSync("git rev-parse HEAD", execOpts).trim();

  return {
    commit_hash,
    message,
  };
}
