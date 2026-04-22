import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { commitKbChanges } from "../src/core/git";

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-"));
  runGit(["init"], repoRoot);
  runGit(["config", "user.name", "Test User"], repoRoot);
  runGit(["config", "user.email", "test@example.com"], repoRoot);
  return repoRoot;
}

test("commitKbChanges scopes staging to the configured kb_root path", () => {
  const repoRoot = initRepo();
  const kbRoot = path.join(repoRoot, "external-kb");
  const decoyKbRoot = path.join(repoRoot, "kb");

  fs.mkdirSync(kbRoot, { recursive: true });
  fs.mkdirSync(decoyKbRoot, { recursive: true });
  fs.writeFileSync(path.join(kbRoot, "note.md"), "initial\n", "utf8");
  fs.writeFileSync(path.join(decoyKbRoot, "decoy.md"), "initial\n", "utf8");

  runGit(["add", "."], repoRoot);
  runGit(["commit", "-m", "initial"], repoRoot);

  fs.writeFileSync(path.join(kbRoot, "note.md"), "updated\n", "utf8");
  fs.writeFileSync(path.join(decoyKbRoot, "decoy.md"), "should stay unstaged\n", "utf8");

  const result = commitKbChanges("update external kb", { kb_root: kbRoot });

  assert.match(result.commit_hash, /^[0-9a-f]{40}$/);
  assert.equal(result.message, "update external kb");

  const committedFiles = runGit(
    ["show", "--name-only", "--pretty=format:", "HEAD"],
    repoRoot
  ).split("\n").filter(Boolean);
  assert.deepEqual(committedFiles, ["external-kb/note.md"]);

  const status = runGit(["status", "--short"], repoRoot);
  assert.match(status, /^M kb\/decoy\.md$/m);
});

test("commitKbChanges rejects kb_root paths outside a git working tree", () => {
  const outsideKbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-outside-"));

  assert.throws(
    () => commitKbChanges("no-op", { kb_root: outsideKbRoot }),
    /not inside a git repository|outside the git repository/
  );
});
