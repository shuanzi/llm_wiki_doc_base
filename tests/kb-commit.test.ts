import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { kbCommit } from "../src/tools/kb_commit";

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-commit-tool-"));
  runGit(["init"], repoRoot);
  runGit(["config", "user.name", "Test User"], repoRoot);
  runGit(["config", "user.email", "test@example.com"], repoRoot);
  return repoRoot;
}

test("kbCommit surfaces scoped no-op error for external kb_root", async () => {
  const repoRoot = initRepo();
  const kbRoot = path.join(repoRoot, "external-kb");

  fs.mkdirSync(kbRoot, { recursive: true });
  fs.writeFileSync(path.join(kbRoot, "note.md"), "initial\n", "utf8");
  runGit(["add", "."], repoRoot);
  runGit(["commit", "-m", "initial"], repoRoot);

  const result = await kbCommit({ message: "no-op commit" }, { kb_root: kbRoot });

  assert.equal(result.success, false);
  assert.equal(result.error, 'No staged changes in "external-kb" to commit.');
  assert.doesNotMatch(result.error ?? "", /kb\/ to commit/);
});

test("kbCommit returns workspace error when kb_root is not in a git repo", async () => {
  const outsideKbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-commit-outside-"));

  const result = await kbCommit({ message: "no-op" }, { kb_root: outsideKbRoot });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /not inside a git repository|outside the git repository/);
});
