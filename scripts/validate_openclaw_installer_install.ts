import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { renderAllOpenClawSkills } from "../src/openclaw-installer/skills";
import { renderAllOpenClawWorkspaceDocs } from "../src/openclaw-installer/workspace-docs";
import { sha256 } from "../src/utils/hash";

interface FakeOpenClawState {
  configFile: string;
  config: {
    agents?: unknown;
  };
  mcpServers: Record<string, unknown>;
  eligibleSkills: string[];
  failMcpSetFor?: string[];
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
  fs.mkdirSync(workspacePath, { recursive: true });

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
    failMcpSetFor: [],
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
    "  const failList = Array.isArray(state.failMcpSetFor) ? state.failMcpSetFor : [];",
    "  if (failList.includes(name)) {",
    "    fail(`Injected mcp set failure for ${JSON.stringify(name)}`);",
    "  }",
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

function runCliGetConfigFilePath(
  env: NodeJS.ProcessEnv,
  options: {
    forceEmptyHomeDirectoryResolver?: boolean;
    cliHomeOverride?: string;
  } = {}
): CommandResult {
  const openclawCliModulePath = path.resolve(
    repoRoot(),
    "dist",
    "openclaw-installer",
    "openclaw-cli.js"
  );
  const cliOptionLiterals: string[] = [];
  if (typeof options.cliHomeOverride === "string") {
    cliOptionLiterals.push(`env: { HOME: ${JSON.stringify(options.cliHomeOverride)} }`);
  }
  if (options.forceEmptyHomeDirectoryResolver) {
    cliOptionLiterals.push("homeDirectoryResolver: () => ''");
  }
  const cliInstantiationLine =
    cliOptionLiterals.length > 0
      ? `  const cli = new OpenClawCli({ ${cliOptionLiterals.join(", ")} });`
      : "  const cli = new OpenClawCli();";
  const script = [
    "const { OpenClawCli } = require(process.argv[1]);",
    "(async () => {",
    cliInstantiationLine,
    "  const value = await cli.getConfigFilePath();",
    "  process.stdout.write(value);",
    "})().catch((error) => {",
    "  const message = error instanceof Error ? error.message : String(error);",
    "  process.stderr.write(`${message}\\n`);",
    "  process.exit(1);",
    "});",
  ].join("\n");

  const result = spawnSync(process.execPath, ["-e", script, openclawCliModulePath], {
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

function testConfigFilePathParserExpandsTildeUsingHomeEnv(): void {
  const sandbox = createSandbox("config-file-parser-home-env");

  try {
    const state = readState(sandbox.statePath);
    state.configFile = "~/.openclaw/openclaw.json";
    writeState(sandbox.statePath, state);

    const homeDirectory = path.join(sandbox.tempRoot, "home-from-env");
    const env = { ...sandbox.env, HOME: homeDirectory };
    const result = runCliGetConfigFilePath(env);

    assert(
      result.status === 0,
      `Config-file parser should accept ~/.openclaw/openclaw.json when HOME is set.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert(
      result.stdout === path.resolve(homeDirectory, ".openclaw", "openclaw.json"),
      `Config-file parser should normalize ~/ path using HOME.\nstdout:\n${result.stdout}`
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testConfigFilePathParserUsesCliEnvHomeOverride(): void {
  const sandbox = createSandbox("config-file-parser-cli-home-override");

  try {
    const state = readState(sandbox.statePath);
    state.configFile = "~/.openclaw/openclaw.json";
    writeState(sandbox.statePath, state);

    const processHomeDirectory = path.join(sandbox.tempRoot, "home-from-process-env");
    const cliHomeDirectory = path.join(sandbox.tempRoot, "home-from-cli-options-env");
    const env = { ...sandbox.env, HOME: processHomeDirectory };
    const result = runCliGetConfigFilePath(env, {
      cliHomeOverride: cliHomeDirectory,
    });

    assert(
      result.status === 0,
      `Config-file parser should accept ~/.openclaw/openclaw.json when CLI env overrides HOME.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert(
      result.stdout === path.resolve(cliHomeDirectory, ".openclaw", "openclaw.json"),
      `Config-file parser should use OpenClawCli env HOME override when normalizing ~/ path.\nstdout:\n${result.stdout}`
    );
    assert(
      result.stdout !== path.resolve(processHomeDirectory, ".openclaw", "openclaw.json"),
      "Config-file parser should not use process HOME when CLI env HOME override is provided"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testConfigFilePathParserFallsBackToPlatformHomeDirectory(): void {
  const sandbox = createSandbox("config-file-parser-home-fallback");

  try {
    const state = readState(sandbox.statePath);
    state.configFile = "~/.openclaw/openclaw.json";
    writeState(sandbox.statePath, state);

    const env = { ...sandbox.env };
    delete env.HOME;
    const result = runCliGetConfigFilePath(env);

    assert(
      result.status === 0,
      `Config-file parser should fall back to platform home-directory helper when HOME is unset.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert(
      result.stdout === path.resolve(os.homedir(), ".openclaw", "openclaw.json"),
      `Config-file parser should normalize ~/ path using platform home-directory helper.\nstdout:\n${result.stdout}`
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testConfigFilePathParserFailsClosedWithoutUsableHomeDirectory(): void {
  const sandbox = createSandbox("config-file-parser-home-fail-closed");

  try {
    const state = readState(sandbox.statePath);
    state.configFile = "~/.openclaw/openclaw.json";
    writeState(sandbox.statePath, state);

    const env = { ...sandbox.env };
    delete env.HOME;
    const result = runCliGetConfigFilePath(env, {
      forceEmptyHomeDirectoryResolver: true,
    });

    assert(
      result.status !== 0,
      "Config-file parser should fail closed when ~/ output cannot resolve a usable home directory"
    );
    assert(
      /no usable home directory/i.test(`${result.stdout}\n${result.stderr}`),
      `Fail-closed home-directory error should mention unusable home directory.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testConfigFilePathParserRejectsMalformedOutput(): void {
  const sandbox = createSandbox("config-file-parser-invalid-output");

  try {
    const validAbsolutePath = path.join(sandbox.tempRoot, "openclaw.json");
    const invalidOutputs = [
      {
        label: "empty output",
        value: "",
      },
      {
        label: "extra newline content",
        value: `${validAbsolutePath}\n`,
      },
      {
        label: "whitespace-padded value",
        value: ` ${validAbsolutePath}`,
      },
      {
        label: "tab-padded value",
        value: `${validAbsolutePath}\t`,
      },
      {
        label: "unsupported relative path",
        value: ".openclaw/openclaw.json",
      },
    ];

    for (const testCase of invalidOutputs) {
      const state = readState(sandbox.statePath);
      state.configFile = testCase.value;
      writeState(sandbox.statePath, state);

      const result = runCliGetConfigFilePath(sandbox.env);
      assert(
        result.status !== 0,
        `Config-file parser should reject ${testCase.label}`
      );
      assert(
        /config file output/i.test(`${result.stdout}\n${result.stderr}`),
        `Config-file parser rejection should mention malformed config file output for ${testCase.label}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    }
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testInstallAndCheckAcceptTildeConfigFilePath(): void {
  const sandbox = createSandbox("config-file-tilde-install-check");

  try {
    const state = readState(sandbox.statePath);
    state.configFile = "~/.openclaw/openclaw.json";
    writeState(sandbox.statePath, state);

    const env = { ...sandbox.env, HOME: path.join(sandbox.tempRoot, "home-from-env") };
    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        sandbox.workspacePath,
        "--kb-root",
        sandbox.kbRoot,
      ],
      env
    );
    assert(
      install.status === 0,
      `Install should accept ~/.openclaw/openclaw.json from openclaw config file.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const check = runInstallerCommand(
      ["check", "--workspace", sandbox.workspacePath, "--json"],
      env
    );
    assert(
      check.status === 0,
      `Check should accept ~/.openclaw/openclaw.json from openclaw config file.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );
    assert(
      parseCheckJson(check.stdout).ok,
      "Check should still report ok=true when openclaw config file path uses ~/..."
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
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

function testExplicitNonDefaultWorkspaceIsAccepted(): void {
  const sandbox = createSandbox("workspace-non-default");

  try {
    const explicitWorkspace = path.join(sandbox.tempRoot, "workspace-other");
    fs.mkdirSync(explicitWorkspace, { recursive: true });

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        explicitWorkspace,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );

    assert(
      install.status === 0,
      `Install should accept an explicit non-default workspace target.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const stateAfterInstall = readState(sandbox.statePath);
    assert(
      stateAfterInstall.mcpServers["llm-kb"] !== undefined,
      "Install should write MCP config for explicit non-default workspace"
    );

    const check = runInstallerCommand(
      ["check", "--workspace", explicitWorkspace, "--json"],
      sandbox.env
    );
    assert(
      check.status === 0,
      `Check should succeed for explicit non-default workspace target.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );
    assert(
      parseCheckJson(check.stdout).ok,
      "Check JSON should report ok=true for explicit non-default workspace target"
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

function testInstallOverwritesWorkspaceRootDocsAndCapturesSnapshots(): void {
  const sandbox = createSandbox("workspace-doc-overwrite");

  try {
    fs.mkdirSync(sandbox.workspacePath, { recursive: true });
    const renderedDocs = renderAllOpenClawWorkspaceDocs();
    const preinstallContentByDocName = new Map<string, string>();

    for (const renderedDoc of renderedDocs) {
      const preinstallContent = `# user-local-${renderedDoc.docName}\n`;
      preinstallContentByDocName.set(renderedDoc.docName, preinstallContent);
      fs.writeFileSync(
        path.join(sandbox.workspacePath, renderedDoc.installRelativeFile),
        preinstallContent,
        "utf8"
      );
    }

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
      `Install should overwrite preexisting workspace-root docs.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    for (const renderedDoc of renderedDocs) {
      const docPath = path.join(sandbox.workspacePath, renderedDoc.installRelativeFile);
      assert(
        fs.readFileSync(docPath, "utf8") === renderedDoc.content,
        `Install should overwrite workspace-root doc content for ${renderedDoc.docName}`
      );
    }

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    const parsedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      installedWorkspaceDocs?: Array<{
        docName?: string;
        contentHash?: string;
        preinstallSnapshot?: {
          existed?: boolean;
          content?: string;
          contentHash?: string;
        };
      }>;
    };

    assert(
      Array.isArray(parsedManifest.installedWorkspaceDocs),
      "Manifest should include installedWorkspaceDocs metadata"
    );

    const entriesByDocName = new Map<
      string,
      NonNullable<typeof parsedManifest.installedWorkspaceDocs>[number]
    >();
    for (const entry of parsedManifest.installedWorkspaceDocs ?? []) {
      if (typeof entry.docName === "string") {
        entriesByDocName.set(entry.docName, entry);
      }
    }

    for (const renderedDoc of renderedDocs) {
      const entry = entriesByDocName.get(renderedDoc.docName);
      assert(entry !== undefined, `Manifest missing workspace doc entry: ${renderedDoc.docName}`);
      assert(
        entry.contentHash === renderedDoc.contentHash,
        `Manifest should track rendered content hash for ${renderedDoc.docName}`
      );

      const preinstallContent = preinstallContentByDocName.get(renderedDoc.docName);
      assert(
        preinstallContent !== undefined,
        `Precondition failed: preinstall content missing for ${renderedDoc.docName}`
      );
      assert(
        entry.preinstallSnapshot?.existed === true,
        `Manifest snapshot should record preexisting doc for ${renderedDoc.docName}`
      );
      assert(
        entry.preinstallSnapshot?.content === preinstallContent,
        `Manifest snapshot should preserve overwritten content for ${renderedDoc.docName}`
      );
      assert(
        entry.preinstallSnapshot?.contentHash === sha256(preinstallContent),
        `Manifest snapshot should preserve overwritten content hash for ${renderedDoc.docName}`
      );
    }
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testCheckDetectsWorkspaceRootDocDrift(): void {
  const sandbox = createSandbox("workspace-doc-drift");

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
      `Baseline install should succeed before workspace-doc drift check.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const driftedDocPath = path.join(sandbox.workspacePath, "TOOLS.md");
    fs.writeFileSync(driftedDocPath, "# drifted\n", "utf8");
    const missingDocPath = path.join(sandbox.workspacePath, "SOUL.md");
    fs.unlinkSync(missingDocPath);

    const check = runInstallerCommand(
      ["check", "--workspace", sandbox.workspacePath, "--json"],
      sandbox.env
    );
    assert(
      check.status === 1,
      `Workspace-root doc drift should fail check.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );

    const parsed = parseCheckJson(check.stdout);
    assert(parsed.ok === false, "Workspace-root doc drift should produce ok=false");
    assert(
      parsed.driftItems.some((item) => item.kind === "workspace_doc_hash_drift"),
      `Check should report hash drift for modified workspace-root docs.\nitems:\n${JSON.stringify(
        parsed.driftItems,
        null,
        2
      )}`
    );
    assert(
      parsed.driftItems.some((item) => item.kind === "missing_workspace_doc"),
      `Check should report missing workspace-root docs.\nitems:\n${JSON.stringify(
        parsed.driftItems,
        null,
        2
      )}`
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testCheckDetectsMissingWorkspaceDocOwnershipInManifest(): void {
  const sandbox = createSandbox("workspace-doc-manifest-ownership");

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
      `Baseline install should succeed before manifest-ownership drift check.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const manifestPath = path.join(
      sandbox.workspacePath,
      ".llm-kb",
      "openclaw-install.json"
    );
    const parsedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete parsedManifest.installedWorkspaceDocs;
    fs.writeFileSync(manifestPath, `${JSON.stringify(parsedManifest, null, 2)}\n`, "utf8");

    const check = runInstallerCommand(
      ["check", "--workspace", sandbox.workspacePath, "--json"],
      sandbox.env
    );
    assert(
      check.status === 1,
      `Manifest missing workspace-doc ownership metadata should fail check.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );

    const parsed = parseCheckJson(check.stdout);
    assert(parsed.ok === false, "Manifest ownership drift should produce ok=false");
    assert(
      parsed.driftItems.some(
        (item) =>
          item.kind === "workspace_doc_hash_drift" &&
          /missing installer-owned workspace doc entry/i.test(item.message)
      ),
      `Check should report missing workspace-doc ownership entries in manifest.\nitems:\n${JSON.stringify(
        parsed.driftItems,
        null,
        2
      )}`
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testInstallFailsClosedOnSymlinkedWorkspaceDocPath(): void {
  const sandbox = createSandbox("workspace-doc-symlink-install");

  try {
    fs.mkdirSync(sandbox.workspacePath, { recursive: true });
    const externalTarget = path.join(sandbox.tempRoot, "external-agents.md");
    fs.writeFileSync(externalTarget, "# external\n", "utf8");
    const agentsPath = path.join(sandbox.workspacePath, "AGENTS.md");
    fs.symlinkSync(externalTarget, agentsPath);

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
      "Install should fail closed when workspace-root doc path is a symlink"
    );
    assert(
      /must not be a symlink/i.test(`${install.stdout}\n${install.stderr}`),
      "Symlink refusal should be explicit in install output"
    );

    const stateAfterFailure = readState(sandbox.statePath);
    assert(
      stateAfterFailure.mcpServers["llm-kb"] === undefined,
      "Symlink refusal should not register MCP config"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testCheckFailsClosedOnSymlinkedWorkspaceDocPath(): void {
  const sandbox = createSandbox("workspace-doc-symlink-check");

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
      `Baseline install should succeed before symlink check.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const externalTarget = path.join(sandbox.tempRoot, "external-tools.md");
    fs.writeFileSync(externalTarget, "# external-tools\n", "utf8");
    const toolsPath = path.join(sandbox.workspacePath, "TOOLS.md");
    fs.unlinkSync(toolsPath);
    fs.symlinkSync(externalTarget, toolsPath);

    const check = runInstallerCommand(
      ["check", "--workspace", sandbox.workspacePath, "--json"],
      sandbox.env
    );
    assert(
      check.status === 1,
      `Symlinked workspace-root doc should fail check.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );

    const parsed = parseCheckJson(check.stdout);
    assert(parsed.ok === false, "Symlinked workspace-root doc should produce ok=false");
    assert(
      parsed.driftItems.some(
        (item) => item.kind === "unknown_ownership" && /symlink/i.test(item.message)
      ),
      `Check should report symlinked workspace-root docs as unknown ownership drift.\nitems:\n${JSON.stringify(
        parsed.driftItems,
        null,
        2
      )}`
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testWorkspaceSymlinkAliasFailsClosedForWorkspaceDocs(): void {
  const sandbox = createSandbox("workspace-symlink-alias-root");

  try {
    const realWorkspace = path.join(sandbox.tempRoot, "workspace-real");
    fs.mkdirSync(realWorkspace, { recursive: true });
    fs.rmSync(sandbox.workspacePath, { recursive: true, force: true });
    fs.symlinkSync(realWorkspace, sandbox.workspacePath);

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
      "Install should fail closed when workspace root path is a symlink alias"
    );
    assert(
      /workspace root must not be a symlink/i.test(
        `${install.stdout}\n${install.stderr}`
      ),
      "Install failure should explicitly mention workspace-root symlink refusal"
    );

    const stateAfterInstallFailure = readState(sandbox.statePath);
    assert(
      stateAfterInstallFailure.mcpServers["llm-kb"] === undefined,
      "Symlink-alias workspace refusal should not register MCP config"
    );

    const check = runInstallerCommand(
      ["check", "--workspace", sandbox.workspacePath, "--json"],
      sandbox.env
    );
    assert(
      check.status === 1,
      `Check should fail for symlinked workspace root alias.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );

    const parsed = parseCheckJson(check.stdout);
    assert(parsed.ok === false, "Symlinked workspace root alias should produce ok=false");
    assert(
      parsed.driftItems.some(
        (item) =>
          item.kind === "unknown_ownership" &&
          /workspace root must not be a symlink/i.test(item.message)
      ),
      `Check should report workspace-root symlink alias as unknown ownership.\nitems:\n${JSON.stringify(
        parsed.driftItems,
        null,
        2
      )}`
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
    const overwrittenAgentsContent = "# preexisting agents doc\n";
    const agentsPath = path.join(sandbox.workspacePath, "AGENTS.md");
    const soulPath = path.join(sandbox.workspacePath, "SOUL.md");

    const stateBefore = readState(sandbox.statePath);
    stateBefore.mcpServers["llm-kb"] = previousMcpConfig;
    stateBefore.failMcpSetFor = ["llm-kb"];
    writeState(sandbox.statePath, stateBefore);

    fs.mkdirSync(path.join(sandbox.workspacePath, "skills", "kb_query"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sandbox.workspacePath, "skills", "kb_query", "SKILL.md"),
      preexistingSkillContent,
      "utf8"
    );
    fs.writeFileSync(agentsPath, overwrittenAgentsContent, "utf8");
    fs.unlinkSync(soulPath);
    assert(
      !fs.existsSync(soulPath),
      "Precondition: SOUL.md should be absent so install creates it before rollback"
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
    assert(
      /Injected mcp set failure/i.test(`${install.stdout}\n${install.stderr}`),
      "Forced install rollback scenario should fail due to injected MCP set failure"
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
    assert(
      fs.readFileSync(agentsPath, "utf8") === overwrittenAgentsContent,
      "Rollback should restore overwritten workspace-root doc content"
    );
    assert(
      !fs.existsSync(soulPath),
      "Rollback should remove workspace-root docs that were newly created during failed install"
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

function testCheckRequiresExplicitWorkspace(): void {
  const sandbox = createSandbox("check-requires-workspace");

  try {
    const plainCheck = runInstallerCommand(["check"], sandbox.env);
    assert(
      plainCheck.status === 2,
      `check without --workspace should be rejected as usage error.\nstdout:\n${plainCheck.stdout}\nstderr:\n${plainCheck.stderr}`
    );
    assert(
      /requires --workspace/i.test(`${plainCheck.stdout}\n${plainCheck.stderr}`),
      "check usage failure should explain that --workspace is required"
    );

    const jsonCheck = runInstallerCommand(["check", "--json"], sandbox.env);
    assert(
      jsonCheck.status === 2,
      `check --json without --workspace should preserve usage exit code.\nstdout:\n${jsonCheck.stdout}\nstderr:\n${jsonCheck.stderr}`
    );
    const parsed = parseCheckJson(jsonCheck.stdout);
    assert(
      parsed.ok === false,
      "check --json without --workspace should emit structured ok=false output"
    );
    assert(
      parsed.driftItems.some((item) =>
        /requires --workspace/i.test(item.message)
      ),
      "check --json usage failure should include --workspace requirement"
    );
    assert(
      !/OpenClaw installer check detected drift/i.test(
        `${jsonCheck.stdout}\n${jsonCheck.stderr}`
      ),
      "check --json usage failures should not fall back to human-readable drift output"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testMissingWorkspacePathFailsDirectly(): void {
  const sandbox = createSandbox("missing-workspace-path");

  try {
    const missingWorkspace = path.join(sandbox.tempRoot, "workspace-missing");

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        missingWorkspace,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );
    assert(
      install.status !== 0,
      "Install should fail when --workspace points to a missing path"
    );
    assert(
      /Workspace path does not exist/i.test(`${install.stdout}\n${install.stderr}`),
      "Install missing-path failure should mention non-existent workspace path"
    );
    assert(
      !fs.existsSync(missingWorkspace),
      "Install should not create a missing workspace directory"
    );

    const stateAfter = readState(sandbox.statePath);
    assert(
      stateAfter.mcpServers["llm-kb"] === undefined,
      "Missing workspace install failure should not register MCP config"
    );

    const plainCheck = runInstallerCommand(
      ["check", "--workspace", missingWorkspace],
      sandbox.env
    );
    assert(
      plainCheck.status === 1,
      `Plain check should fail directly when --workspace path is missing.\nstdout:\n${plainCheck.stdout}\nstderr:\n${plainCheck.stderr}`
    );
    assert(
      /Workspace path does not exist/i.test(`${plainCheck.stdout}\n${plainCheck.stderr}`),
      "Plain check missing-path failure should report invalid workspace path directly"
    );
    assert(
      !/OpenClaw installer check detected drift/i.test(
        `${plainCheck.stdout}\n${plainCheck.stderr}`
      ),
      "Plain check missing-path failure should not render drift report output"
    );

    const jsonCheck = runInstallerCommand(
      ["check", "--workspace", missingWorkspace, "--json"],
      sandbox.env
    );
    assert(
      jsonCheck.status === 1,
      `check --json should fail with structured output for missing workspace path.\nstdout:\n${jsonCheck.stdout}\nstderr:\n${jsonCheck.stderr}`
    );
    const parsed = parseCheckJson(jsonCheck.stdout);
    assert(parsed.ok === false, "Missing-path check --json should emit ok=false");
    assert(
      parsed.driftItems.some((item) =>
        /Workspace path does not exist/i.test(item.message)
      ),
      "Missing-path check --json should include workspace-path validation failure"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testNonDirectoryWorkspacePathFailsDirectly(): void {
  const sandbox = createSandbox("workspace-path-is-file");

  try {
    const workspaceFile = path.join(sandbox.tempRoot, "workspace.txt");
    fs.writeFileSync(workspaceFile, "not a directory\n", "utf8");

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        workspaceFile,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );
    assert(
      install.status !== 0,
      "Install should fail when --workspace points to a non-directory path"
    );
    assert(
      /Workspace path is not a directory/i.test(`${install.stdout}\n${install.stderr}`),
      "Install non-directory workspace failure should mention directory requirement"
    );

    const check = runInstallerCommand(
      ["check", "--workspace", workspaceFile, "--json"],
      sandbox.env
    );
    assert(
      check.status === 1,
      `check --json should fail when --workspace points to a non-directory path.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );
    const parsed = parseCheckJson(check.stdout);
    assert(parsed.ok === false, "Non-directory workspace check --json should emit ok=false");
    assert(
      parsed.driftItems.some((item) =>
        /Workspace path is not a directory/i.test(item.message)
      ),
      "Non-directory workspace check --json should include directory validation failure"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testAmbiguousDefaultAgentDoesNotBlockExplicitWorkspaceTargeting(): void {
  const sandbox = createSandbox("ambiguous-default-agent");

  try {
    const explicitWorkspace = path.join(sandbox.tempRoot, "workspace-explicit");
    fs.mkdirSync(explicitWorkspace, { recursive: true });

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
    writeState(sandbox.statePath, state);

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        explicitWorkspace,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );
    assert(
      install.status === 0,
      `Ambiguous default-agent config should not block explicit workspace install.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const check = runInstallerCommand(
      ["check", "--workspace", explicitWorkspace, "--json"],
      sandbox.env
    );
    assert(
      check.status === 0,
      `Ambiguous default-agent config should not block explicit workspace check.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );
    assert(
      parseCheckJson(check.stdout).ok,
      "Explicit workspace check should pass even when default-agent selection is ambiguous"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function testDefaultAgentSkillRestrictionsDoNotBlockExplicitWorkspaceCheck(): void {
  const sandbox = createSandbox("ignore-default-agent-eligible-skills");

  try {
    const explicitWorkspace = path.join(sandbox.tempRoot, "workspace-explicit");
    fs.mkdirSync(explicitWorkspace, { recursive: true });

    const install = runInstallerCommand(
      [
        "install",
        "--workspace",
        explicitWorkspace,
        "--kb-root",
        sandbox.kbRoot,
      ],
      sandbox.env
    );
    assert(
      install.status === 0,
      `Install should succeed before eligibility regression check.\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
    );

    const state = readState(sandbox.statePath);
    state.eligibleSkills = ["kb_ingest"];
    writeState(sandbox.statePath, state);

    const check = runInstallerCommand(
      ["check", "--workspace", explicitWorkspace, "--json"],
      sandbox.env
    );
    assert(
      check.status === 0,
      `Explicit workspace check should ignore default-agent skill eligibility restrictions.\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`
    );

    const parsed = parseCheckJson(check.stdout);
    assert(
      parsed.ok,
      "Explicit workspace check should still report ok=true when eligible skills are restricted"
    );
    assert(
      !parsed.driftItems.some((item) =>
        /not eligible|skills excludes required|missing kb_/i.test(item.message)
      ),
      "Check output should not contain default-agent-only eligibility drift"
    );
  } finally {
    fs.rmSync(sandbox.tempRoot, { recursive: true, force: true });
  }
}

function main(): void {
  ensureInstallerBuildExists();

  testConfigFilePathParserExpandsTildeUsingHomeEnv();
  testConfigFilePathParserUsesCliEnvHomeOverride();
  testConfigFilePathParserFallsBackToPlatformHomeDirectory();
  testConfigFilePathParserFailsClosedWithoutUsableHomeDirectory();
  testConfigFilePathParserRejectsMalformedOutput();
  testInstallAndCheckAcceptTildeConfigFilePath();
  testSuccessfulInstallAndProbe();
  testExplicitNonDefaultWorkspaceIsAccepted();
  testExistingPartialKbRootFailsClosedWithoutForce();
  testConservativeConflictFailure();
  testUnownedSkillWithInstallerContentStillConflicts();
  testInstallOverwritesWorkspaceRootDocsAndCapturesSnapshots();
  testCheckDetectsWorkspaceRootDocDrift();
  testCheckDetectsMissingWorkspaceDocOwnershipInManifest();
  testInstallFailsClosedOnSymlinkedWorkspaceDocPath();
  testCheckFailsClosedOnSymlinkedWorkspaceDocPath();
  testWorkspaceSymlinkAliasFailsClosedForWorkspaceDocs();
  testForceRollbackRestoresOverwrittenArtifacts();
  testCheckRequiresExplicitWorkspace();
  testMissingWorkspacePathFailsDirectly();
  testNonDirectoryWorkspacePathFailsDirectly();
  testMalformedCheckJsonInvocationSemantics();
  testAmbiguousDefaultAgentDoesNotBlockExplicitWorkspaceTargeting();
  testDefaultAgentSkillRestrictionsDoNotBlockExplicitWorkspaceCheck();

  process.stdout.write(
    "validate_openclaw_installer_install: all scenarios passed\n"
  );
}

main();
