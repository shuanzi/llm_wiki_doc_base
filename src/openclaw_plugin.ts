import {
  buildKbRootMissingMessage,
  isExistingDirectory,
  resolveKbWorkspaceConfig,
} from "./runtime/kb_workspace_config";
import {
  KB_TOOL_DEFINITIONS,
  type KbCanonicalToolName,
} from "./runtime/kb_tool_contract";
import {
  dispatchKbTool,
  type KbToolArgs,
} from "./runtime/kb_tool_runtime";
import type { WorkspaceConfig } from "./types";

interface OpenClawToolRegistration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(toolCallId: string, params?: unknown): Promise<OpenClawToolExecutionResult>;
}

interface OpenClawToolExecutionResult {
  content: Array<{ type: "text"; text: string }>;
}

interface OpenClawPluginApi {
  registerTool(tool: OpenClawToolRegistration, options?: { optional?: boolean }): void;
}

interface OpenClawPluginEntry {
  id: string;
  name: string;
  description: string;
  register(api: OpenClawPluginApi): void;
}

function register(api: OpenClawPluginApi): void {
  for (const definition of KB_TOOL_DEFINITIONS) {
    api.registerTool({
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
      execute: async (_toolCallId, params) =>
        executeKbTool(definition.name, params),
    });
  }
}

async function executeKbTool(
  toolName: KbCanonicalToolName,
  params: unknown
): Promise<OpenClawToolExecutionResult> {
  const workspace = resolveWorkspaceForExecution();
  const result = await dispatchKbTool(toolName, normalizeToolArgs(params), workspace);
  if (!result.success) {
    throw new Error(result.error ?? `Tool ${toolName} failed`);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result.data, null, 2),
      },
    ],
  };
}

function normalizeToolArgs(params: unknown): KbToolArgs {
  if (params === undefined || params === null) {
    return {};
  }

  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  return params as KbToolArgs;
}

function resolveWorkspaceForExecution(): WorkspaceConfig {
  const resolved = resolveKbWorkspaceConfig();
  if (!isExistingDirectory(resolved.config.kb_root)) {
    throw new Error(
      buildKbRootMissingMessage({
        kbRoot: resolved.config.kb_root,
        kbRootSource: resolved.kbRootSource,
        prefix: "[kb-openclaw-plugin]",
      }).trim()
    );
  }
  return resolved.config;
}

const pluginEntry: OpenClawPluginEntry = {
  id: "llmwiki-kb-tools",
  name: "LLMWiki KB Tools",
  description:
    "Expose canonical kb_* knowledge-base tools inside OpenClaw sessions.",
  register,
};

export = pluginEntry;
