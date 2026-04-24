import { LLMWIKI_AGENT_ID } from "./llmwiki-binding";
import type { OpenClawCli } from "./openclaw-cli";
import { SESSION_RUNTIME_PLUGIN_ID } from "./session-runtime-artifact";
import { normalizeConfiguredWorkspacePath } from "./workspace";

const AGENTS_LIST_CONFIG_PATH = "agents.list" as const;

export interface SessionRuntimeAgentToolPolicySnapshot {
  agentsList: unknown;
}

export interface EnsureSessionRuntimeAgentToolPolicyResult {
  previous: SessionRuntimeAgentToolPolicySnapshot;
  changed: boolean;
}

export async function ensureSessionRuntimeAgentToolPolicy(options: {
  cli: OpenClawCli;
  workspacePath: string;
}): Promise<EnsureSessionRuntimeAgentToolPolicyResult> {
  const previousAgentsList = await readAgentsList(options.cli);
  const nextAgentsList = updateTargetLlmwikiAgent(previousAgentsList, {
    workspacePath: options.workspacePath,
    update: ensurePluginGroupAllowed,
  });
  const changed = JSON.stringify(previousAgentsList) !== JSON.stringify(nextAgentsList);
  if (changed) {
    await options.cli.setConfigValueStrictJson(AGENTS_LIST_CONFIG_PATH, nextAgentsList);
  }

  return {
    previous: { agentsList: previousAgentsList },
    changed,
  };
}

export async function restoreSessionRuntimeAgentToolPolicy(options: {
  cli: OpenClawCli;
  previous: SessionRuntimeAgentToolPolicySnapshot;
}): Promise<void> {
  if (options.previous.agentsList === undefined) {
    await options.cli.unsetConfigValue(AGENTS_LIST_CONFIG_PATH);
    return;
  }
  await options.cli.setConfigValueStrictJson(
    AGENTS_LIST_CONFIG_PATH,
    options.previous.agentsList
  );
}

export async function removeSessionRuntimeAgentToolPolicy(options: {
  cli: OpenClawCli;
  workspacePath: string;
}): Promise<void> {
  const previousAgentsList = await readAgentsList(options.cli);
  const nextAgentsList = updateTargetLlmwikiAgent(previousAgentsList, {
    workspacePath: options.workspacePath,
    update: removePluginGroupAllowed,
  });
  if (JSON.stringify(previousAgentsList) !== JSON.stringify(nextAgentsList)) {
    await options.cli.setConfigValueStrictJson(AGENTS_LIST_CONFIG_PATH, nextAgentsList);
  }
}

export async function hasSessionRuntimeAgentToolPolicy(options: {
  cli: OpenClawCli;
  workspacePath: string;
}): Promise<boolean> {
  const agentsList = await readAgentsList(options.cli);
  const target = findTargetLlmwikiAgent(agentsList, options.workspacePath);
  if (!target) {
    return false;
  }
  const tools = readToolsObject(target);
  return (
    stringListIncludes(tools?.allow, SESSION_RUNTIME_PLUGIN_ID) ||
    stringListIncludes(tools?.alsoAllow, SESSION_RUNTIME_PLUGIN_ID)
  );
}

async function readAgentsList(cli: OpenClawCli): Promise<unknown> {
  return cli.getConfigValue<unknown>(AGENTS_LIST_CONFIG_PATH, { allowMissing: true });
}

function updateTargetLlmwikiAgent(
  agentsList: unknown,
  options: {
    workspacePath: string;
    update: (agent: Record<string, unknown>) => Record<string, unknown>;
  }
): unknown {
  if (!Array.isArray(agentsList)) {
    throw new Error("OpenClaw agents.list must be an array to update llmwiki tool policy.");
  }

  let updated = false;
  const nextAgents = agentsList.map((entry) => {
    if (!isTargetLlmwikiAgent(entry, options.workspacePath)) {
      return entry;
    }
    updated = true;
    return options.update(entry);
  });

  if (!updated) {
    throw new Error(
      `OpenClaw agents.list does not contain agent "${LLMWIKI_AGENT_ID}" bound to ${options.workspacePath}.`
    );
  }
  return nextAgents;
}

function findTargetLlmwikiAgent(
  agentsList: unknown,
  workspacePath: string
): Record<string, unknown> | undefined {
  if (!Array.isArray(agentsList)) {
    return undefined;
  }
  return agentsList.find((entry) => isTargetLlmwikiAgent(entry, workspacePath));
}

function isTargetLlmwikiAgent(
  entry: unknown,
  workspacePath: string
): entry is Record<string, unknown> {
  if (!isRecord(entry) || entry.id !== LLMWIKI_AGENT_ID) {
    return false;
  }
  if (typeof entry.workspace !== "string") {
    return false;
  }
  return (
    normalizeConfiguredWorkspacePath(entry.workspace) ===
    normalizeConfiguredWorkspacePath(workspacePath)
  );
}

function ensurePluginGroupAllowed(agent: Record<string, unknown>): Record<string, unknown> {
  const tools = readToolsObject(agent) ?? {};
  const nextTools = { ...tools };

  if (Array.isArray(nextTools.allow) && nextTools.allow.length > 0) {
    nextTools.allow = ensureStringListEntry(nextTools.allow, SESSION_RUNTIME_PLUGIN_ID);
  } else {
    nextTools.alsoAllow = ensureStringListEntry(
      nextTools.alsoAllow,
      SESSION_RUNTIME_PLUGIN_ID
    );
  }

  return {
    ...agent,
    tools: nextTools,
  };
}

function removePluginGroupAllowed(agent: Record<string, unknown>): Record<string, unknown> {
  const tools = readToolsObject(agent);
  if (!tools) {
    return agent;
  }

  return {
    ...agent,
    tools: {
      ...tools,
      allow: removeStringListEntry(tools.allow, SESSION_RUNTIME_PLUGIN_ID),
      alsoAllow: removeStringListEntry(tools.alsoAllow, SESSION_RUNTIME_PLUGIN_ID),
    },
  };
}

function readToolsObject(
  agent: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (agent.tools === undefined) {
    return undefined;
  }
  if (!isRecord(agent.tools) || Array.isArray(agent.tools)) {
    throw new Error(`OpenClaw agent "${LLMWIKI_AGENT_ID}" tools policy must be an object.`);
  }
  return agent.tools;
}

function ensureStringListEntry(value: unknown, entry: string): string[] {
  const existing = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  return Array.from(new Set([...existing, entry]));
}

function removeStringListEntry(value: unknown, entry: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => item !== entry);
}

function stringListIncludes(value: unknown, entry: string): boolean {
  return Array.isArray(value) && value.includes(entry);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
