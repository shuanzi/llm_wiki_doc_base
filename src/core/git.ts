import * as fs from "fs";
import { execFileSync } from "child_process";
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

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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

  let repoRoot: string;
  try {
    repoRoot = fs.realpathSync(runGit(["rev-parse", "--show-toplevel"], existingAncestor));
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

function listStagedFiles(repoRoot: string): string[] {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return output.split("\0").filter((entry) => entry.length > 0);
}

function isPathWithinScope(repoRelativePath: string, scope: string): boolean {
  return scope === "." || repoRelativePath === scope || repoRelativePath.startsWith(scope + "/");
}

function assertNoStagedFilesOutsideScope(repoRoot: string, scope: string): void {
  const outsideScope = listStagedFiles(repoRoot).filter(
    (filePath) => !isPathWithinScope(filePath, scope)
  );

  if (outsideScope.length > 0) {
    throw new Error(
      `Refusing to commit because files outside "${scope}" are already staged: ${outsideScope.join(", ")}`
    );
  }
}

export function commitKbChanges(
  message: string,
  workspace: WorkspaceLike
): CommitKbChangesResult {
  const { repoRoot, scope } = resolveKbGitScope(workspace);

  assertNoStagedFilesOutsideScope(repoRoot, scope);
  runGit(["add", "-A", "--", scope], repoRoot);
  assertNoStagedFilesOutsideScope(repoRoot, scope);

  const status = runGit(["diff", "--cached", "--name-only", "--", scope], repoRoot);
  if (!status) {
    throw new Error(`No staged changes in "${scope}" to commit.`);
  }

  runGit(["commit", "-m", message], repoRoot);
  const commit_hash = runGit(["rev-parse", "HEAD"], repoRoot);

  return {
    commit_hash,
    message,
  };
}
