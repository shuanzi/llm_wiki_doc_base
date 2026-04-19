import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface CmdResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runTsx(repoRoot: string, args: string[], envOverrides: Record<string, string> = {}): CmdResult {
  const result = spawnSync(
    "npx",
    ["tsx", "--tsconfig", "tsconfig.scripts.json", ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ...envOverrides },
    }
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function listFilesRecursive(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        results.push(abs);
      }
    }
  }
  walk(root);
  return results;
}

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function snapshotKb(kbRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const absPath of listFilesRecursive(kbRoot)) {
    const relPath = path.relative(kbRoot, absPath).replace(/\\/g, "/");
    const content = fs.readFileSync(absPath);
    map.set(relPath, `${content.length}:${sha256(content)}`);
  }
  return map;
}

function diffSnapshots(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = [];
  const allPaths = new Set<string>([...before.keys(), ...after.keys()]);
  for (const relPath of [...allPaths].sort()) {
    if (before.get(relPath) !== after.get(relPath)) {
      changed.push(relPath);
    }
  }
  return changed;
}

function testDefaultModeDoesNotMutateRealKb(repoRoot: string): void {
  const realKbRoot = path.join(repoRoot, "kb");
  assert(fs.existsSync(realKbRoot) && fs.statSync(realKbRoot).isDirectory(), `kb root not found: ${realKbRoot}`);

  const tempSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-e2e-safe-default-"));
  const sourcePath = path.join(tempSourceDir, "e2e_default_mode_sample.md");
  fs.writeFileSync(
    sourcePath,
    "# e2e default safety sample\n\nThis validates default mode does not mutate repo kb.\n",
    "utf8"
  );

  try {
    const before = snapshotKb(realKbRoot);
    const result = runTsx(repoRoot, ["scripts/e2e_v2_ingest.ts", sourcePath]);
    const after = snapshotKb(realKbRoot);

    assert(result.status === 0, `Default mode run failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    assert(
      result.stdout.includes("throwaway temp copy (safe default)"),
      "Default mode output did not indicate throwaway temp mode."
    );
    const changed = diffSnapshots(before, after);
    assert(changed.length === 0, `Real kb was modified by default run. Changed paths: ${changed.slice(0, 10).join(", ")}`);
  } finally {
    fs.rmSync(tempSourceDir, { recursive: true, force: true });
  }
}

function testIdempotencyNoContentChangeInExplicitMode(repoRoot: string): void {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "kb-e2e-idempotency-"));
  const kbRoot = path.join(tempWorkspace, "kb");
  const sourcePath = path.join(tempWorkspace, "explicit_idempotency_sample.md");
  fs.cpSync(path.join(repoRoot, "kb"), kbRoot, { recursive: true });
  fs.writeFileSync(
    sourcePath,
    "# explicit idempotency sample\n\nThis validates run2 keeps content stable.\n",
    "utf8"
  );

  try {
    const first = runTsx(repoRoot, ["scripts/e2e_v2_ingest.ts", sourcePath, "--kb-root", kbRoot]);
    assert(first.status === 0, `First explicit mode run failed.\nSTDOUT:\n${first.stdout}\nSTDERR:\n${first.stderr}`);
    const afterFirst = snapshotKb(kbRoot);

    const second = runTsx(repoRoot, ["scripts/e2e_v2_ingest.ts", sourcePath, "--kb-root", kbRoot]);
    assert(second.status === 0, `Second explicit mode run failed.\nSTDOUT:\n${second.stdout}\nSTDERR:\n${second.stderr}`);
    const afterSecond = snapshotKb(kbRoot);

    const changed = diffSnapshots(afterFirst, afterSecond);
    assert(
      changed.length === 0,
      `Explicit mode is not content-idempotent across repeated runs. Changed paths: ${changed.slice(0, 10).join(", ")}`
    );
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
}

function testIdempotencyNoCrossDayContentChangeInExplicitMode(repoRoot: string): void {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "kb-e2e-idempotency-cross-day-"));
  const kbRoot = path.join(tempWorkspace, "kb");
  const sourcePath = path.join(tempWorkspace, "explicit_idempotency_cross_day_sample.md");
  fs.cpSync(path.join(repoRoot, "kb"), kbRoot, { recursive: true });
  fs.writeFileSync(
    sourcePath,
    "# explicit idempotency cross-day sample\n\nThis validates run2 keeps content stable across different dates.\n",
    "utf8"
  );

  try {
    const first = runTsx(
      repoRoot,
      ["scripts/e2e_v2_ingest.ts", sourcePath, "--kb-root", kbRoot],
      { E2E_V2_INGEST_TODAY: "2026-01-14" }
    );
    assert(first.status === 0, `First cross-day explicit mode run failed.\nSTDOUT:\n${first.stdout}\nSTDERR:\n${first.stderr}`);
    const afterFirst = snapshotKb(kbRoot);

    const second = runTsx(
      repoRoot,
      ["scripts/e2e_v2_ingest.ts", sourcePath, "--kb-root", kbRoot],
      { E2E_V2_INGEST_TODAY: "2026-02-15" }
    );
    assert(second.status === 0, `Second cross-day explicit mode run failed.\nSTDOUT:\n${second.stdout}\nSTDERR:\n${second.stderr}`);
    const afterSecond = snapshotKb(kbRoot);

    const changed = diffSnapshots(afterFirst, afterSecond);
    assert(
      changed.length === 0,
      `Explicit mode is not cross-day content-idempotent. Changed paths: ${changed.slice(0, 10).join(", ")}`
    );
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
}

function testCommitGuardRejectsNonGitRoot(repoRoot: string): void {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "kb-e2e-commit-guard-"));
  const badKbRoot = path.join(tempWorkspace, "kb");
  const sourcePath = path.join(tempWorkspace, "commit_guard_sample.md");
  fs.mkdirSync(badKbRoot, { recursive: true });
  fs.writeFileSync(sourcePath, "# commit guard sample\n", "utf8");

  try {
    const result = runTsx(repoRoot, [
      "scripts/e2e_v2_ingest.ts",
      sourcePath,
      "--kb-root",
      badKbRoot,
      "--commit",
    ]);
    const combined = result.stdout + "\n" + result.stderr;
    assert(result.status !== 0, "Unsupported commit target unexpectedly succeeded.");
    assert(
      combined.includes("--commit requires parent directory to be a git work tree"),
      `Commit guard error message missing.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
}

function testCommitGuardRejectsNestedRepoKbRoot(repoRoot: string): void {
  const tempSubdir = fs.mkdtempSync(path.join(repoRoot, ".tmp-kb-e2e-nested-"));
  const nestedKbRoot = path.join(tempSubdir, "kb");
  const sourcePath = path.join(tempSubdir, "nested_commit_guard_sample.md");
  fs.cpSync(path.join(repoRoot, "kb"), nestedKbRoot, { recursive: true });
  fs.writeFileSync(sourcePath, "# nested commit guard sample\n", "utf8");

  try {
    const result = runTsx(repoRoot, [
      "scripts/e2e_v2_ingest.ts",
      sourcePath,
      "--kb-root",
      nestedKbRoot,
      "--commit",
    ]);
    const combined = result.stdout + "\n" + result.stderr;
    assert(result.status !== 0, "Nested repo sub/kb commit target unexpectedly succeeded.");
    assert(
      combined.includes(`--commit requires --kb-root to be "<git-top-level>/kb"`),
      `Nested commit-guard error message missing.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  } finally {
    fs.rmSync(tempSubdir, { recursive: true, force: true });
  }
}

function main(): void {
  const repoRoot = path.resolve(__dirname, "..");
  testDefaultModeDoesNotMutateRealKb(repoRoot);
  testIdempotencyNoContentChangeInExplicitMode(repoRoot);
  testIdempotencyNoCrossDayContentChangeInExplicitMode(repoRoot);
  testCommitGuardRejectsNonGitRoot(repoRoot);
  testCommitGuardRejectsNestedRepoKbRoot(repoRoot);
  console.log("PASS: e2e_v2_ingest safety/idempotency/commit-guard validations passed.");
}

main();
