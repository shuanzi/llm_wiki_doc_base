import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

interface FakeOpenClawState {
  configFile: string;
  config: {
    agents?: unknown;
  };
  mcpServers: Record<string, unknown>;
  eligibleSkills: string[];
  failMcpUnsetFor?: string[];
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `openclaw-repair-uninstall-${name}-`));
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
    failMcpUnsetFor: [],
  };

  writeState(statePath, initialState);
  fs.writeFileSync(configFile, JSON.stringify({ note: "fake" }, null, 2), "utf8");

  const fakeOpenclawPath = path.join(
    binDir,
    process.platform === "win32" ? "openclaw.cmd" : "openclaw"
  );
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
  return ["@echo off", "node \"%~dp0\\fake-openclaw-cli.js\" %*", ""].join("\n");
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
    "  const name = args[2];",
    "  const failList = Array.isArray(state.failMcpUnsetFor) ? state.failMcpUnsetFor : [];",
    "  if (failList.includes(name)) {",
    "    fail(`Injected mcp unset failure for ${JSON.stringify(name)}`);",
    "  }",
    "  delete state.mcpServers[name];",
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

function runInstallerCommand(args: string[], env: NodeJS.ProcessEnv): CommandResult {
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

function writeState(statePath: string, state: FakeOpenClawState): void {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readState(statePath: string): FakeOpenClawState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as FakeOpenClawState;
}

function parseCheckJson(stdout: string): {
  ok: boolean;
  driftItems: Array<{ kind: string; message: string }>;
} {
  try {
    return JSON.parse(stdout) as {
      ok: boolean;
      driftItems: Array<{ kind: string; message: string }>;
    };
  } catch (error) {
    throw new Error(`Failed to parse check JSON output: ${String(error)}\nstdout:\n${stdout}`);
  }
}

function runBaselineInstall(sandbox: ValidationSandbox): void {
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
    `Baseline install should succeed.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
  );
}

function testRepairFromMissingSkills(): void {
  const sandbox = createSandbox("repair-missing-skills");

  try {
    runBaselineInstall(sandbox);

    fs.rmSync(path.join(sandbox.workspacePath, "skills", "kb_query"), {
      recursive: true,
      force: true,
    });

    const repair = runInstallerCommand(
      ["repair", "--workspace", sandbox.workspacePath, "--mcp-name", "llm-kb"],
      sandbox.env
    );
    assert(
      repair.status === 0,
      `Repair should recreate missing skills.\nstdout:\n${repair.stdout}\nstderr:\n${repair.stderr}`
    );

    const repairedSkill = path.join(
      sandbox.workspacePath,
      "skills",
      "kb_query",
      "SKILL.md"
    );
    assert(
      fs.existsSync(repairedSkill),
      "Repair should recreate missing adapted skill file for kb_query"
    );

    const check = runInstallerCommand(
      ["check", "--workspace", sandbox.workspacePath, "--json"],
      sandbox.env
    );
    assert(
      check.status === 0,
      `Post-repair check should succeed.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );
    assert(parseCheckJson(check.stdout).ok, "Post-repair check JSON should report ok=true");
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testRepairFromMissingManifestWithSufficientState(): void {
  const sandbox = createSandbox("repair-missing-manifest");

  try {
    runBaselineInstall(sandbox);

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    fs.unlinkSync(manifestPath);

    const repair = runInstallerCommand(
      ["repair", "--workspace", sandbox.workspacePath, "--mcp-name", "llm-kb"],
      sandbox.env
    );
    assert(
      repair.status === 0,
      `Repair should reconstruct missing manifest when state is sufficient.\nstdout:\n${repair.stdout}\nstderr:\n${repair.stderr}`
    );
    assert(fs.existsSync(manifestPath), "Repair should recreate missing installer manifest");

    const parsedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      kbRoot?: string;
      mcpName?: string;
    };
    assert(
      path.resolve(parsedManifest.kbRoot ?? "") === path.resolve(sandbox.kbRoot),
      "Repaired manifest should preserve KB_ROOT from surviving state"
    );
    assert(
      parsedManifest.mcpName === "llm-kb",
      "Repaired manifest should use requested MCP name"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testRepairRefusalWhenStateAmbiguous(): void {
  const sandbox = createSandbox("repair-ambiguous");

  try {
    fs.mkdirSync(sandbox.workspacePath, { recursive: true });

    const repair = runInstallerCommand(
      [
        "repair",
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
      repair.status !== 0,
      "Repair should fail closed when ownership state is too ambiguous"
    );
    assert(
      /ownership is uncertain|too ambiguous|missing manifest and missing MCP registration/i.test(
        `${repair.stdout}\n${repair.stderr}`
      ),
      "Ambiguous repair refusal should explain ownership uncertainty"
    );

    const state = readState(sandbox.statePath);
    assert(
      state.mcpServers["llm-kb"] === undefined,
      "Ambiguous repair refusal should not register MCP config"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testRepairRejectsConflictingKbRootWithoutForce(): void {
  const sandbox = createSandbox("repair-kb-root-conflict");

  try {
    runBaselineInstall(sandbox);

    const differentKbRoot = path.join(sandbox.tempRoot, "external-kb-other");
    fs.mkdirSync(differentKbRoot, { recursive: true });

    const repair = runInstallerCommand(
      [
        "repair",
        "--workspace",
        sandbox.workspacePath,
        "--mcp-name",
        "llm-kb",
        "--kb-root",
        differentKbRoot,
      ],
      sandbox.env
    );

    assert(
      repair.status !== 0,
      "Repair should fail closed when --kb-root conflicts with existing owned KB_ROOT without --force"
    );
    assert(
      /re-home|different KB_ROOT|without --force/i.test(
        `${repair.stdout}\n${repair.stderr}`
      ),
      "Repair KB_ROOT conflict should explain conservative re-home refusal"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testRepairLateFailureRollsBackMutations(): void {
  const sandbox = createSandbox("repair-rollback");

  try {
    runBaselineInstall(sandbox);

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    const manifestBefore = fs.readFileSync(manifestPath, "utf8");

    const stateBefore = readState(sandbox.statePath);
    stateBefore.mcpServers["llm-kb"] = {
      command: "node",
      args: [path.join(sandbox.tempRoot, "custom-mcp.js")],
      env: {
        KB_ROOT: sandbox.kbRoot,
      },
    };
    stateBefore.eligibleSkills = ["kb_ingest", "kb_query"];
    writeState(sandbox.statePath, stateBefore);

    const removedSkillFile = path.join(
      sandbox.workspacePath,
      "skills",
      "kb_query",
      "SKILL.md"
    );
    fs.unlinkSync(removedSkillFile);
    assert(!fs.existsSync(removedSkillFile), "Expected precondition: skill file removed");

    const repair = runInstallerCommand(
      ["repair", "--workspace", sandbox.workspacePath, "--mcp-name", "llm-kb"],
      sandbox.env
    );
    assert(
      repair.status !== 0,
      "Repair should fail when post-repair check detects non-repairable drift"
    );
    assert(
      /Post-repair check detected drift/i.test(`${repair.stdout}\n${repair.stderr}`),
      "Repair rollback scenario should fail at post-repair check stage"
    );

    const stateAfter = readState(sandbox.statePath);
    assertDeepEqual(
      stateAfter.mcpServers["llm-kb"],
      stateBefore.mcpServers["llm-kb"],
      "Repair rollback should restore previous MCP registration"
    );
    assert(
      !fs.existsSync(removedSkillFile),
      "Repair rollback should restore pre-existing missing skill state"
    );
    assert(
      fs.readFileSync(manifestPath, "utf8") === manifestBefore,
      "Repair rollback should restore previous manifest content"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testUninstallRemovesOnlyInstallerOwnedArtifacts(): void {
  const sandbox = createSandbox("uninstall-owned-only");

  try {
    runBaselineInstall(sandbox);

    const userSkillPath = path.join(
      sandbox.workspacePath,
      "skills",
      "my_custom_skill",
      "SKILL.md"
    );
    fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
    fs.writeFileSync(userSkillPath, "# user skill\n", "utf8");

    const uninstall = runInstallerCommand(
      ["uninstall", "--workspace", sandbox.workspacePath, "--mcp-name", "llm-kb"],
      sandbox.env
    );
    assert(
      uninstall.status === 0,
      `Uninstall should succeed for installer-owned artifacts.\nstdout:\n${uninstall.stdout}\nstderr:\n${uninstall.stderr}`
    );

    const state = readState(sandbox.statePath);
    assert(
      state.mcpServers["llm-kb"] === undefined,
      "Uninstall should remove the installer MCP registration"
    );

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    assert(
      !fs.existsSync(manifestPath),
      "Uninstall should remove installer manifest"
    );

    for (const skillName of ["kb_ingest", "kb_query", "kb_lint"]) {
      assert(
        !fs.existsSync(path.join(sandbox.workspacePath, "skills", skillName)),
        `Uninstall should remove installer-owned skill directory: ${skillName}`
      );
    }

    assert(
      fs.existsSync(userSkillPath),
      "Uninstall should not remove non-installer custom skill directory"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testUninstallLeavesExternalKbUntouched(): void {
  const sandbox = createSandbox("uninstall-leaves-kb");

  try {
    runBaselineInstall(sandbox);

    const sentinelPath = path.join(sandbox.kbRoot, "wiki", "reports", "sentinel.md");
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    fs.writeFileSync(sentinelPath, "keep me\n", "utf8");

    const uninstall = runInstallerCommand(
      ["uninstall", "--workspace", sandbox.workspacePath, "--mcp-name", "llm-kb"],
      sandbox.env
    );
    assert(
      uninstall.status === 0,
      `Uninstall should succeed while preserving external KB.\nstdout:\n${uninstall.stdout}\nstderr:\n${uninstall.stderr}`
    );

    assert(fs.existsSync(sandbox.kbRoot), "Uninstall must leave external KB_ROOT directory intact");
    assert(
      fs.existsSync(path.join(sandbox.kbRoot, "wiki", "index.md")),
      "Uninstall must leave KB wiki content intact"
    );
    assert(
      fs.existsSync(sentinelPath),
      "Uninstall must not delete user files under external KB_ROOT"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testUninstallRefusesWhenSkillDirHasExtraUserContent(): void {
  const sandbox = createSandbox("uninstall-extra-skill-content");

  try {
    runBaselineInstall(sandbox);

    const extraFile = path.join(
      sandbox.workspacePath,
      "skills",
      "kb_query",
      "notes.txt"
    );
    fs.writeFileSync(extraFile, "user data\n", "utf8");

    const uninstall = runInstallerCommand(
      ["uninstall", "--workspace", sandbox.workspacePath, "--mcp-name", "llm-kb"],
      sandbox.env
    );
    assert(
      uninstall.status !== 0,
      "Uninstall should fail closed when installer skill directory contains extra user content"
    );
    assert(
      /contains additional user content|Re-run with --force/i.test(
        `${uninstall.stdout}\n${uninstall.stderr}`
      ),
      "Uninstall refusal should explain extra user content protection"
    );

    assert(
      fs.existsSync(extraFile),
      "Uninstall refusal should leave user-added file intact"
    );
    const stateAfter = readState(sandbox.statePath);
    assert(
      stateAfter.mcpServers["llm-kb"] !== undefined,
      "Uninstall refusal should not remove MCP registration"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testForceUninstallDoesNotRemoveAmbiguousMcpOwnership(): void {
  const sandbox = createSandbox("uninstall-force-ambiguous-mcp");

  try {
    const stateBefore = readState(sandbox.statePath);
    stateBefore.mcpServers["llm-kb"] = {
      command: "node",
      args: [path.join(sandbox.tempRoot, "third-party-mcp.js")],
      env: {
        KB_ROOT: path.join(sandbox.tempRoot, "third-party-kb"),
      },
    };
    writeState(sandbox.statePath, stateBefore);

    const uninstall = runInstallerCommand(
      [
        "uninstall",
        "--workspace",
        sandbox.workspacePath,
        "--mcp-name",
        "llm-kb",
        "--force",
      ],
      sandbox.env
    );

    assert(
      uninstall.status === 0,
      `Force uninstall should complete while preserving ambiguous MCP ownership.\nstdout:\n${uninstall.stdout}\nstderr:\n${uninstall.stderr}`
    );

    const stateAfter = readState(sandbox.statePath);
    assertDeepEqual(
      stateAfter.mcpServers["llm-kb"],
      stateBefore.mcpServers["llm-kb"],
      "Force uninstall should not remove ambiguous/non-installer MCP registration"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testUninstallMcpUnsetFailureDoesNotDeleteLocalArtifacts(): void {
  const sandbox = createSandbox("uninstall-unset-failure");

  try {
    runBaselineInstall(sandbox);

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    const skillPath = path.join(
      sandbox.workspacePath,
      "skills",
      "kb_query",
      "SKILL.md"
    );
    assert(fs.existsSync(manifestPath), "Precondition: manifest should exist before uninstall");
    assert(fs.existsSync(skillPath), "Precondition: skill should exist before uninstall");

    const state = readState(sandbox.statePath);
    state.failMcpUnsetFor = ["llm-kb"];
    writeState(sandbox.statePath, state);

    const uninstall = runInstallerCommand(
      ["uninstall", "--workspace", sandbox.workspacePath, "--mcp-name", "llm-kb"],
      sandbox.env
    );
    assert(
      uninstall.status !== 0,
      "Uninstall should fail when owned MCP unset fails"
    );
    assert(
      /Injected mcp unset failure/i.test(`${uninstall.stdout}\n${uninstall.stderr}`),
      "Uninstall unset failure should report CLI unset failure"
    );

    const stateAfter = readState(sandbox.statePath);
    assert(
      stateAfter.mcpServers["llm-kb"] !== undefined,
      "Unset failure should leave MCP registration present"
    );
    assert(
      fs.existsSync(manifestPath),
      "Unset failure should leave installer manifest intact"
    );
    assert(
      fs.existsSync(skillPath),
      "Unset failure should leave installer skill artifacts intact"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function main(): void {
  ensureInstallerBuildExists();

  testRepairFromMissingSkills();
  testRepairFromMissingManifestWithSufficientState();
  testRepairRefusalWhenStateAmbiguous();
  testRepairRejectsConflictingKbRootWithoutForce();
  testRepairLateFailureRollsBackMutations();
  testUninstallRemovesOnlyInstallerOwnedArtifacts();
  testUninstallLeavesExternalKbUntouched();
  testUninstallRefusesWhenSkillDirHasExtraUserContent();
  testForceUninstallDoesNotRemoveAmbiguousMcpOwnership();
  testUninstallMcpUnsetFailureDoesNotDeleteLocalArtifacts();

  process.stdout.write(
    "validate_openclaw_installer_repair_uninstall: all scenarios passed\n"
  );
}

main();
