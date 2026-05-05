import * as fs from "fs";
import * as path from "path";

import {
  VALIDATION_CANONICAL_TOOL_NAMES,
  VALIDATION_TOOL_DEFINITIONS,
} from "./kb_tool_contract_baseline";

interface BuiltToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
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

function repoRoot(): string {
  return path.resolve(__dirname, "..");
}

function requireBuiltModule<T>(relativePath: string): T {
  const builtPath = path.resolve(repoRoot(), relativePath);
  assert(fs.existsSync(builtPath), `Missing built artifact: ${builtPath}`);
  assert(fs.statSync(builtPath).isFile(), `Built artifact is not a file: ${builtPath}`);
  return require(builtPath) as T;
}

function toolSurface(
  tools: ReadonlyArray<BuiltToolDefinition>
): ReadonlyArray<BuiltToolDefinition> {
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

function main(): void {
  const builtContract = requireBuiltModule<{
    KB_CANONICAL_TOOL_NAMES: readonly string[];
    KB_TOOL_DEFINITIONS: ReadonlyArray<BuiltToolDefinition>;
  }>("dist/runtime/kb_tool_contract.js");
  const builtRuntime = requireBuiltModule<{
    listKbToolsResponse(): { tools: ReadonlyArray<BuiltToolDefinition> };
  }>("dist/runtime/kb_tool_runtime.js");

  assertDeepEqual(
    builtContract.KB_CANONICAL_TOOL_NAMES,
    VALIDATION_CANONICAL_TOOL_NAMES,
    "Built KB canonical tool names drifted from validation baseline."
  );
  assertDeepEqual(
    builtContract.KB_TOOL_DEFINITIONS.map((tool) => tool.name),
    VALIDATION_CANONICAL_TOOL_NAMES,
    "Built KB tool definition names must preserve validation baseline order."
  );
  assertDeepEqual(
    toolSurface(builtContract.KB_TOOL_DEFINITIONS),
    VALIDATION_TOOL_DEFINITIONS,
    "Built KB tool definitions must match validation tool surface snapshot."
  );

  const runtimeTools = builtRuntime.listKbToolsResponse().tools;
  assertDeepEqual(
    toolSurface(runtimeTools),
    VALIDATION_TOOL_DEFINITIONS,
    "Built runtime listKbToolsResponse surface must match validation tool surface snapshot."
  );

  assert(
    builtContract.KB_TOOL_DEFINITIONS.some((tool) => tool.name === "kb_url_add"),
    "Built KB tool definitions must include kb_url_add."
  );
  assertDeepEqual(
    builtContract.KB_TOOL_DEFINITIONS.slice(0, 4).map((tool) => tool.name),
    ["kb_source_add", "kb_url_add", "kb_ingest_finalize", "kb_read_source"],
    "Built KB tool definitions must preserve targeted ingest tool ordering."
  );

  process.stdout.write(
    `PASS validate_mcp_dist_surface (${builtContract.KB_TOOL_DEFINITIONS.length} tools)\n`
  );
}

main();
