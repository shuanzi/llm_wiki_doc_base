import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params?: unknown) => Promise<unknown>;
}

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  register(api: {
    registerTool(tool: RegisteredTool): void;
  }): void;
  activate?: unknown;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
  }
}

function withTempKbRoot<T>(fn: (kbRoot: string) => T): T {
  const previousKbRoot = process.env.KB_ROOT;
  const previousWorkspaceRoot = process.env.WORKSPACE_ROOT;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-openclaw-plugin-surface-"));
  const kbRoot = path.join(tempRoot, "kb");
  fs.mkdirSync(kbRoot, { recursive: true });

  process.env.KB_ROOT = kbRoot;
  delete process.env.WORKSPACE_ROOT;

  try {
    return fn(kbRoot);
  } finally {
    if (previousKbRoot === undefined) {
      delete process.env.KB_ROOT;
    } else {
      process.env.KB_ROOT = previousKbRoot;
    }

    if (previousWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = previousWorkspaceRoot;
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function withEnvOverride<T>(
  env: {
    KB_ROOT?: string;
    WORKSPACE_ROOT?: string;
  },
  fn: () => T
): T {
  const previousKbRoot = process.env.KB_ROOT;
  const previousWorkspaceRoot = process.env.WORKSPACE_ROOT;

  if (env.KB_ROOT === undefined) {
    delete process.env.KB_ROOT;
  } else {
    process.env.KB_ROOT = env.KB_ROOT;
  }

  if (env.WORKSPACE_ROOT === undefined) {
    delete process.env.WORKSPACE_ROOT;
  } else {
    process.env.WORKSPACE_ROOT = env.WORKSPACE_ROOT;
  }

  try {
    return fn();
  } finally {
    if (previousKbRoot === undefined) {
      delete process.env.KB_ROOT;
    } else {
      process.env.KB_ROOT = previousKbRoot;
    }

    if (previousWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = previousWorkspaceRoot;
    }
  }
}

function repoRoot(): string {
  return path.resolve(__dirname, "..");
}

function loadBuiltRuntime(): {
  pluginEntry: PluginEntry;
  canonicalToolNames: readonly string[];
  toolDefinitions: ReadonlyArray<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
} {
  const builtPluginPath = path.resolve(repoRoot(), "dist", "openclaw_plugin.js");
  assert(fs.existsSync(builtPluginPath), `Missing built plugin artifact: ${builtPluginPath}`);
  assert(fs.statSync(builtPluginPath).isFile(), `Built plugin artifact is not a file: ${builtPluginPath}`);

  const builtContractPath = path.resolve(repoRoot(), "dist", "runtime", "kb_tool_contract.js");
  assert(fs.existsSync(builtContractPath), `Missing built tool contract artifact: ${builtContractPath}`);
  assert(fs.statSync(builtContractPath).isFile(), `Built tool contract artifact is not a file: ${builtContractPath}`);

  const pluginEntry = require(builtPluginPath) as PluginEntry;
  const builtContract = require(builtContractPath) as {
    KB_CANONICAL_TOOL_NAMES: readonly string[];
    KB_TOOL_DEFINITIONS: ReadonlyArray<{
      name: string;
      description: string;
      inputSchema: unknown;
    }>;
  };

  return {
    pluginEntry,
    canonicalToolNames: builtContract.KB_CANONICAL_TOOL_NAMES,
    toolDefinitions: builtContract.KB_TOOL_DEFINITIONS,
  };
}

function main(): void {
  const { pluginEntry, canonicalToolNames, toolDefinitions } = loadBuiltRuntime();

  const expectedCanonicalToolNames = [
    "kb_source_add",
    "kb_read_source",
    "kb_write_page",
    "kb_update_section",
    "kb_ensure_entry",
    "kb_search_wiki",
    "kb_read_page",
    "kb_commit",
    "kb_rebuild_index",
    "kb_run_lint",
    "kb_repair",
  ] as const;

  assertDeepEqual(
    canonicalToolNames,
    expectedCanonicalToolNames,
    "Canonical KB tool names drifted from the expected 11-tool contract."
  );

  assert(typeof pluginEntry.register === "function", "Built plugin must export a register(api) hook.");
  assert(
    pluginEntry.activate === undefined,
    "Built plugin should not export activate(api); it risks duplicate tool registration."
  );

  const registrationScenarios: Array<{
    name: string;
    env: { KB_ROOT?: string; WORKSPACE_ROOT?: string };
  }> = [
    { name: "missing roots", env: {} },
    { name: "invalid KB_ROOT", env: { KB_ROOT: "/definitely/missing/kb-root" } },
  ];

  for (const scenario of registrationScenarios) {
    const tools: RegisteredTool[] = [];
    withEnvOverride(scenario.env, () => {
      pluginEntry.register({
        registerTool(tool): void {
          tools.push(tool);
        },
      });
    });

    assert(
      tools.length === expectedCanonicalToolNames.length,
      `Plugin registration under "${scenario.name}" should still register ${expectedCanonicalToolNames.length} tools, got ${tools.length}.`
    );
  }

  const registeredTools: RegisteredTool[] = [];

  withTempKbRoot(() => {
    pluginEntry.register({
      registerTool(tool): void {
        registeredTools.push(tool as RegisteredTool);
      },
    });
  });

  assert(
    registeredTools.length === toolDefinitions.length,
    `Expected ${toolDefinitions.length} registered tools, got ${registeredTools.length}.`
  );

  const registeredNames = registeredTools.map((tool) => tool.name);
  assertDeepEqual(
    registeredNames,
    expectedCanonicalToolNames,
    "Plugin runtime surface does not preserve canonical kb_* tool names."
  );

  const expectedByName = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
  for (const tool of registeredTools) {
    const expected = expectedByName.get(tool.name);
    assert(expected !== undefined, `Plugin registered unknown tool name: ${tool.name}`);
    assertDeepEqual(
      tool.description,
      expected.description,
      `Plugin tool description mismatch for ${tool.name}.`
    );
    assertDeepEqual(
      tool.parameters,
      expected.inputSchema,
      `Plugin tool schema mismatch for ${tool.name}.`
    );
    assert(typeof tool.execute === "function", `Plugin tool execute handler missing for ${tool.name}.`);
  }

  process.stdout.write(
    `PASS validate_openclaw_plugin_surface (${registeredTools.length} tools)\n`
  );
}

main();
