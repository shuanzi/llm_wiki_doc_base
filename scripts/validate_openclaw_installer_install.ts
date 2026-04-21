import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { renderAllOpenClawSkills } from "../src/openclaw-installer/skills";

interface FakeOpenClawState {
  configFile: string;
  config: {
    agents?: unknown;
  };
  mcpServers: Record<string, unknown>;
  eligibleSkills: string[];
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ValidationSandbox {
  tempRoot: string;
  workspacePath: string;
  kbRoot: string;
  statePath: string;
  env: NodeJS.ProcessEnv;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  assert(
    actualJson === expectedJson,
    `${message}\nexpected:\n${expectedJson}\nactual:\n${actualJson}`
  );
}

function repoRoot(): string {
  return path.resolve(__dirname, "..");
}

function installerEntrypoint(): string {
  return path.resolve(repoRoot(), "dist", "openclaw_installer.js");
}

function ensureInstallerBuildExists(): void {
  const entrypoint = installerEntrypoint();
  if (!fs.existsSync(entrypoint) || !fs.statSync(entrypoint).isFile()) {
    throw new Error(
      `Missing installer build output: ${entrypoint}. Run npm run build before this validation script.`
    );
  }
}

function createSandbox(name: string): ValidationSandbox {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `openclaw-installer-${name}-`));
  const workspacePath = path.join(tempRoot, "workspace-default");
  const kbRoot = path.join(tempRoot, "external-kb");
  const statePath = path.join(tempRoot, "fake-openclaw-state.json");
  const configFile = path.join(tempRoot, "openclaw.json");
  const binDir = path.join(tempRoot, "bin");

  fs.mkdirSync(binDir, { recursive: true });

  const initialState: FakeOpenClawState = {
    configFile,
    config: {
      agents: {
        list: [
          {
            id: "default-agent",
            default: true,
            workspace: workspacePath,
          },
        ],
      },
    },
    mcpServers: {},
    eligibleSkills: ["kb_ingest", "kb_query", "kb_lint"],
  };

  writeState(statePath, initialState);
  fs.writeFileSync(configFile, JSON.stringify({ note: "fake" }, null, 2), "utf8");

  const fakeOpenclawPath = path.join(binDir, process.platform === "win32" ? "openclaw.cmd" : "openclaw");
  writeFakeOpenClawExecutable(fakeOpenclawPath);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    FAKE_OPENCLAW_STATE: statePath,
  };

  return {
    tempRoot,
    workspacePath,
    kbRoot,
    statePath,
    env,
  };
}

function writeFakeOpenClawExecutable(executablePath: string): void {
  const scriptContent = process.platform === "win32" ? buildWindowsShim() : buildPosixShim();
  fs.writeFileSync(executablePath, scriptContent, "utf8");

  if (process.platform === "win32") {
    const windowsCliSourcePath = path.join(path.dirname(executablePath), "fake-openclaw-cli.js");
    fs.writeFileSync(windowsCliSourcePath, buildNodeCliSource(), "utf8");
  } else {
    fs.chmodSync(executablePath, 0o755);
  }
}

function buildWindowsShim(): string {
  return [
    "@echo off",
    "node \"%~dp0\\fake-openclaw-cli.js\" %*",
    "",
  ].join("\n");
}

function buildPosixShim(): string {
  return ["#!/usr/bin/env node", buildNodeCliSource(), ""].join("\n");
}

function buildNodeCliSource(): string {
  return [
    "const fs = require('fs');",
    "",
    "function fail(message) {",
    "  process.stderr.write(`${message}\\n`);",
    "  process.exit(1);",
    "}",
    "",
    "function loadState(statePath) {",
    "  return JSON.parse(fs.readFileSync(statePath, 'utf8'));",
    "}",
    "",
    "function saveState(statePath, state) {",
    "  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\\n`, 'utf8');",
    "}",
    "",
    "function getPathValue(root, dottedPath) {",
    "  const segments = dottedPath.split('.');",
    "  let cursor = root;",
    "  for (const segment of segments) {",
    "    if (cursor === undefined || cursor === null || typeof cursor !== 'object') {",
    "      return undefined;",
    "    }",
    "    cursor = cursor[segment];",
    "  }",
    "  return cursor;",
    "}",
    "",
    "const statePath = process.env.FAKE_OPENCLAW_STATE;",
    "if (!statePath) {",
    "  fail('FAKE_OPENCLAW_STATE is required');",
    "}",
    "",
    "const args = process.argv.slice(2);",
    "const state = loadState(statePath);",
    "",
    "if (args[0] === 'config' && args[1] === 'file') {",
    "  process.stdout.write(`${state.configFile}\\n`);",
    "  process.exit(0);",
    "}",
    "",
    "if (args[0] === 'config' && args[1] === 'get' && args[3] === '--json') {",
    "  const configPath = args[2];",
    "  const value = getPathValue(state.config, configPath);",
    "  if (value === undefined) {",
    "    fail(`Config path ${JSON.stringify(configPath)} not found`);",
    "  }",
    "  process.stdout.write(`${JSON.stringify(value)}\\n`);",
    "  process.exit(0);",
    "}",
    "",
    "if (args[0] === 'mcp' && args[1] === 'show' && args[3] === '--json') {",
    "  const name = args[2];",
    "  const definition = state.mcpServers[name];",
    "  if (!definition) {",
    "    fail(`MCP server ${JSON.stringify(name)} not found`);",
    "  }",
    "  process.stdout.write(`${JSON.stringify(definition)}\\n`);",
    "  process.exit(0);",
    "}",
    "",
    "if (args[0] === 'mcp' && args[1] === 'set' && args.length === 4) {",
    "  const name = args[2];",
    "  let parsed;",
    "  try {",
    "    parsed = JSON.parse(args[3]);",
    "  } catch (error) {",
    "    fail(`Invalid MCP JSON payload: ${error instanceof Error ? error.message : String(error)}`);",
    "  }",
    "  state.mcpServers[name] = parsed;",
    "  saveState(statePath, state);",
    "  process.stdout.write('ok\\n');",
    "  process.exit(0);",
    "}",
    "",
    "if (args[0] === 'mcp' && args[1] === 'unset' && args.length === 3) {",
    "  delete state.mcpServers[args[2]];",
    "  saveState(statePath, state);",
    "  process.stdout.write('ok\\n');",
    "  process.exit(0);",
    "}",
    "",
    "if (args[0] === 'skills' && args[1] === 'list' && args[2] === '--eligible' && args[3] === '--json') {",
    "  process.stdout.write(`${JSON.stringify({ skills: state.eligibleSkills.map((name) => ({ name })) })}\\n`);",
    "  process.exit(0);",
    "}",
    "",
    "fail(`Unsupported fake openclaw command: ${args.join(' ')}`);",
    "",
  ].join("\n");
}

function writeState(statePath: string, state: FakeOpenClawState): void {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readState(statePath: string): FakeOpenClawState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as FakeOpenClawState;
}

function runInstallerCommand(
  args: string[],
  env: NodeJS.ProcessEnv
): CommandResult {
  const result = spawnSync(process.execPath, [installerEntrypoint(), ...args], {
    cwd: repoRoot(),
    env,
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseCheckJson(stdout: string): {
  ok: boolean;
  driftItems: Array<{ kind: string; message: string }>;
  lastProbe?: { ok: boolean };
} {
  try {
    return JSON.parse(stdout) as {
      ok: boolean;
      driftItems: Array<{ kind: string; message: string }>;
      lastProbe?: { ok: boolean };
    };
  } catch (error) {
    throw new Error(`Failed to parse check JSON output: ${String(error)}\nstdout:\n${stdout}`);
  }
}

function testSuccessfulInstallAndProbe(): void {
  const sandbox = createSandbox("success");

  try {
    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
        "--mcp-name",
        "llm-kb",
      ],
      sandbox.env
    );

    assert(
      install.status === 0,
      `Successful install should exit 0.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const stateAfterInstall = readState(sandbox.statePath);
    assert(
      stateAfterInstall.mcpServers["llm-kb"] !== undefined,
      "Install should register llm-kb MCP config via fake openclaw"
    );

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    assert(fs.existsSync(manifestPath), "Install should write workspace manifest");

    const check = runInstallerCommand(
      [
        "check",
        "--workspace",
        sandbox.workspacePath,
        "--mcp-name",
        "llm-kb",
        "--json",
      ],
      sandbox.env
    );

    assert(
      check.status === 0,
      `Post-install check should succeed.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );

    const parsed = parseCheckJson(check.stdout);
    assert(parsed.ok, "Post-install check JSON should report ok=true");
    assert(parsed.lastProbe?.ok === true, "Post-install check should report active probe success");
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testWorkspaceMismatchFailure(): void {
  const sandbox = createSandbox("workspace-mismatch");

  try {
    const mismatchedWorkspace = path.join(sandbox.tempRoot, "workspace-other");

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        mismatchedWorkspace,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );

    assert(
      install.status !== 0,
      "Install should fail when --workspace does not match current default-agent workspace"
    );
    assert(
      /manual config required|does not match the current default-agent workspace/i.test(
        `${install.stdout}\n${install.stderr}`
      ),
      "Workspace mismatch failure should explain manual config requirement"
    );

    const stateAfterFailure = readState(sandbox.statePath);
    assert(
      stateAfterFailure.mcpServers["llm-kb"] === undefined,
      "Workspace mismatch failure should not write MCP config"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testExistingPartialKbRootFailsClosedWithoutForce(): void {
  const sandbox = createSandbox("partial-kb-root");

  try {
    fs.mkdirSync(path.join(sandbox.kbRoot, "raw", "inbox"), { recursive: true });

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );

    assert(
      install.status !== 0,
      "Install should fail closed when existing KB_ROOT is partial/malformed"
    );
    assert(
      /failed validation|fails closed|missing files|missing directories/i.test(
        `${install.stdout}\n${install.stderr}`
      ),
      "Partial KB_ROOT failure should explain validation/closed failure"
    );
    assert(
      !fs.existsSync(path.join(sandbox.kbRoot, "wiki", "index.md")),
      "Fail-closed install should not bootstrap missing KB_ROOT structure without --force"
    );

    const stateAfterFailure = readState(sandbox.statePath);
    assert(
      stateAfterFailure.mcpServers["llm-kb"] === undefined,
      "Fail-closed KB_ROOT rejection should not register MCP config"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testConservativeConflictFailure(): void {
  const sandbox = createSandbox("conflict");

  try {
    fs.mkdirSync(path.join(sandbox.workspacePath, "skills", "kb_query"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sandbox.workspacePath, "skills", "kb_query", "SKILL.md"),
      "# user-modified-skill\n",
      "utf8"
    );

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );

    assert(
      install.status !== 0,
      "Install should fail conservatively on conflicting workspace skill content"
    );
    assert(
      /Conflict: skill/i.test(`${install.stdout}\n${install.stderr}`),
      "Conflict failure should mention skill conflict"
    );

    const stateAfterFailure = readState(sandbox.statePath);
    assert(
      stateAfterFailure.mcpServers["llm-kb"] === undefined,
      "Conflict failure should not register MCP config"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testUnownedSkillWithInstallerContentStillConflicts(): void {
  const sandbox = createSandbox("unowned-same-content");

  try {
    const renderedKbQuery = renderAllOpenClawSkills(repoRoot()).find(
      (skill) => skill.skillName === "kb_query"
    );
    assert(renderedKbQuery !== undefined, "Expected rendered kb_query skill content");

    fs.mkdirSync(path.join(sandbox.workspacePath, "skills", "kb_query"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sandbox.workspacePath, "skills", "kb_query", "SKILL.md"),
      renderedKbQuery.content,
      "utf8"
    );

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );

    assert(
      install.status !== 0,
      "Install should fail when same-named preexisting skill is unowned, even if content matches"
    );
    assert(
      /not installer-owned by manifest/i.test(`${install.stdout}\n${install.stderr}`),
      "Unowned same-content conflict should mention manifest ownership"
    );

    const stateAfterFailure = readState(sandbox.statePath);
    assert(
      stateAfterFailure.mcpServers["llm-kb"] === undefined,
      "Unowned skill conflict should not register MCP config"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testForceRollbackRestoresOverwrittenArtifacts(): void {
  const sandbox = createSandbox("rollback-restore");

  try {
    const baselineInstall = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );
    assert(
      baselineInstall.status === 0,
      `Baseline install should succeed before rollback test.\nstdout:\n${baselineInstall.stdout}\nstderr:\n${baselineInstall.stderr}`
    );

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    const preexistingManifestContent = fs.readFileSync(manifestPath, "utf8");

    const previousMcpConfig = {
      command: "node",
      args: [path.join(sandbox.tempRoot, "old-mcp.js")],
      env: {
        KB_ROOT: path.join(sandbox.tempRoot, "old-kb"),
        EXTRA_FLAG: "1",
      },
    };
    const preexistingSkillContent = "# preexisting skill content\n";

    const stateBefore = readState(sandbox.statePath);
    stateBefore.mcpServers["llm-kb"] = previousMcpConfig;
    stateBefore.eligibleSkills = ["kb_ingest", "kb_query"];
    writeState(sandbox.statePath, stateBefore);

    fs.mkdirSync(path.join(sandbox.workspacePath, "skills", "kb_query"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sandbox.workspacePath, "skills", "kb_query", "SKILL.md"),
      preexistingSkillContent,
      "utf8"
    );

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
        "--force",
      ],
      sandbox.env
    );

    assert(
      install.status !== 0,
      "Forced install should fail in this scenario so rollback can be verified"
    );

    const stateAfter = readState(sandbox.statePath);
    assertDeepEqual(
      stateAfter.mcpServers["llm-kb"],
      previousMcpConfig,
      "Rollback should restore overwritten MCP config"
    );

    const skillPath = path.join(
      sandbox.workspacePath,
      "skills",
      "kb_query",
      "SKILL.md"
    );
    assert(
      fs.readFileSync(skillPath, "utf8") === preexistingSkillContent,
      "Rollback should restore overwritten skill file content"
    );
    assert(
      fs.readFileSync(manifestPath, "utf8") === preexistingManifestContent,
      "Rollback should restore overwritten installer manifest content"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testMalformedCheckJsonInvocationSemantics(): void {
  const sandbox = createSandbox("malformed-check-json");

  try {
    const malformedCheck = runInstallerCommand(
      ["check", "--workspace", "--json"],
      sandbox.env
    );

    assert(
      malformedCheck.status === 2,
      `Malformed check invocation should exit with usage code 2.\nstdout:\n${malformedCheck.stdout}\nstderr:\n${malformedCheck.stderr}`
    );

    const parsed = parseCheckJson(malformedCheck.stdout);
    assert(parsed.ok === false, "Malformed check --json invocation should emit ok=false JSON");
    assert(
      parsed.driftItems.some((item) =>
        /requires a value|option --workspace/i.test(item.message)
      ),
      "Malformed check --json invocation should include parser error in JSON drift items"
    );
    assert(
      !/OpenClaw installer check detected drift/i.test(
        `${malformedCheck.stdout}\n${malformedCheck.stderr}`
      ),
      "Malformed check --json invocation should not fall back to human-readable check output"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testAmbiguousDefaultAgentSuppressesEligibilityChecks(): void {
  const sandbox = createSandbox("ambiguous-default-agent");

  try {
    const state = readState(sandbox.statePath);
    state.config = {
      agents: {
        list: [
          {
            id: "agent-a",
            default: true,
            workspace: sandbox.workspacePath,
          },
          {
            id: "agent-b",
            default: true,
            workspace: path.join(sandbox.tempRoot, "workspace-other"),
          },
        ],
      },
    };
    state.eligibleSkills = [];
    writeState(sandbox.statePath, state);

    fs.mkdirSync(sandbox.workspacePath, { recursive: true });

    const check = runInstallerCommand(
      [
        "check",
        "--workspace",
        sandbox.workspacePath,
        "--json",
      ],
      sandbox.env
    );

    assert(
      check.status === 1,
      `Ambiguous default-agent resolution should fail check.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );

    const parsed = parseCheckJson(check.stdout);
    assert(parsed.ok === false, "Ambiguous default-agent check should produce ok=false");
    assert(
      parsed.driftItems.some((item) =>
        /multiple agents.*default|manual config required/i.test(item.message)
      ),
      "Ambiguous default-agent resolution should report manual config required"
    );
    assert(
      !parsed.driftItems.some((item) =>
        /not eligible|skills excludes required|missing kb_/i.test(item.message)
      ),
      "Eligibility-specific drift should be suppressed when default-agent workspace confirmation failed"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testFreshArtifactRollbackCleansUpNewState(): void {
  const sandbox = createSandbox("rollback-cleanup-new");

  try {
    const stateBefore = readState(sandbox.statePath);
    stateBefore.eligibleSkills = ["kb_ingest", "kb_query"];
    writeState(sandbox.statePath, stateBefore);

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );

    assert(
      install.status !== 0,
      "Install should fail after creating fresh artifacts so cleanup-only rollback can be verified"
    );

    const stateAfter = readState(sandbox.statePath);
    assert(
      stateAfter.mcpServers["llm-kb"] === undefined,
      "Cleanup-only rollback should remove newly created MCP registration"
    );

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    assert(
      !fs.existsSync(manifestPath),
      "Cleanup-only rollback should remove newly created manifest"
    );

    const createdSkillPath = path.join(
      sandbox.workspacePath,
      "skills",
      "kb_query",
      "SKILL.md"
    );
    assert(
      !fs.existsSync(createdSkillPath),
      "Cleanup-only rollback should remove newly created skill files"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testIneligibleSkillFailureWithFilesPresent(): void {
  const sandbox = createSandbox("ineligible");

  try {
    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );

    assert(
      install.status === 0,
      `Baseline install should succeed before eligibility drift check.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const state = readState(sandbox.statePath);
    state.eligibleSkills = ["kb_ingest", "kb_query"];
    writeState(sandbox.statePath, state);

    const check = runInstallerCommand(
      [
        "check",
        "--workspace",
        sandbox.workspacePath,
        "--json",
      ],
      sandbox.env
    );

    assert(
      check.status === 1,
      `Eligibility drift should fail check with exit code 1.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );

    const parsed = parseCheckJson(check.stdout);
    assert(parsed.ok === false, "Eligibility drift should produce ok=false");
    assert(
      parsed.driftItems.some((item) =>
        /not eligible|missing kb_lint|skills excludes required/i.test(item.message)
      ),
      "Eligibility drift should be reported even when skill files are present"
    );

    for (const skillName of ["kb_ingest", "kb_query", "kb_lint"]) {
      const skillFilePath = path.join(
        sandbox.workspacePath,
        "skills",
        skillName,
        "SKILL.md"
      );
      assert(
        fs.existsSync(skillFilePath),
        `Skill file should still exist during ineligible-skill check: ${skillFilePath}`
      );
    }
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function main(): void {
  ensureInstallerBuildExists();

  testSuccessfulInstallAndProbe();
  testWorkspaceMismatchFailure();
  testExistingPartialKbRootFailsClosedWithoutForce();
  testConservativeConflictFailure();
  testUnownedSkillWithInstallerContentStillConflicts();
  testForceRollbackRestoresOverwrittenArtifacts();
  testMalformedCheckJsonInvocationSemantics();
  testAmbiguousDefaultAgentSuppressesEligibilityChecks();
  testFreshArtifactRollbackCleansUpNewState();
  testIneligibleSkillFailureWithFilesPresent();

  process.stdout.write(
    "validate_openclaw_installer_install: all scenarios passed\n"
  );
}

main();
