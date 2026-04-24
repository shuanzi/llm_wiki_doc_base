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
  agentId: string;
  workspacePath: string;
}): Promise<EnsureSessionRuntimeAgentToolPolicyResult> {
  const previousAgentsList = await readAgentsList(options.cli);
  const nextAgentsList = updateTargetAgent(previousAgentsList, {
    agentId: options.agentId,
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
  agentId: string;
  workspacePath: string;
  allowMissingTarget?: boolean;
  matchAgentIdOnly?: boolean;
}): Promise<boolean> {
  const previousAgentsList = await readAgentsList(options.cli);
  const nextAgentsList = updateTargetAgent(previousAgentsList, {
    agentId: options.agentId,
    workspacePath: options.workspacePath,
    allowMissingTarget: options.allowMissingTarget,
    matchAgentIdOnly: options.matchAgentIdOnly,
    update: removePluginGroupAllowed,
  });
  const changed = JSON.stringify(previousAgentsList) !== JSON.stringify(nextAgentsList);
  if (changed) {
    await options.cli.setConfigValueStrictJson(AGENTS_LIST_CONFIG_PATH, nextAgentsList);
  }
  return changed;
}

export async function assertCanRemoveSessionRuntimeAgentToolPolicy(options: {
  cli: OpenClawCli;
  agentId: string;
  workspacePath: string;
  allowMissingTarget?: boolean;
  matchAgentIdOnly?: boolean;
}): Promise<void> {
  const agentsList = await readAgentsList(options.cli);
  updateTargetAgent(agentsList, {
    agentId: options.agentId,
    workspacePath: options.workspacePath,
    allowMissingTarget: options.allowMissingTarget,
    matchAgentIdOnly: options.matchAgentIdOnly,
    update: removePluginGroupAllowed,
  });
}

export async function hasSessionRuntimeAgentToolPolicy(options: {
  cli: OpenClawCli;
  agentId: string;
  workspacePath: string;
}): Promise<boolean> {
  const agentsList = await readAgentsList(options.cli);
  const target = findTargetAgent(agentsList, {
    agentId: options.agentId,
    workspacePath: options.workspacePath,
  });
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

function updateTargetAgent(
  agentsList: unknown,
  options: {
    agentId: string;
    workspacePath: string;
    allowMissingTarget?: boolean;
    matchAgentIdOnly?: boolean;
    update: (agent: Record<string, unknown>) => Record<string, unknown>;
  }
): unknown {
  if (!Array.isArray(agentsList)) {
    throw new Error(
      `OpenClaw agents.list must be an array to update agent "${options.agentId}" tool policy.`
    );
  }

  if (options.matchAgentIdOnly) {
    const agentIdMatches = agentsList.filter((entry) => {
      return isRecord(entry) && entry.id === options.agentId;
    });
    if (agentIdMatches.length > 1) {
      throw new Error(
        `OpenClaw fail-closed: ambiguous tool policy cleanup for agent "${options.agentId}" because agents.list contains ${agentIdMatches.length} matching entries.`
      );
    }
  }

  const targetMatches = agentsList.filter((entry) => isTargetAgent(entry, options));
  if (targetMatches.length > 1) {
    throw new Error(
      `OpenClaw fail-closed: ambiguous tool policy update for agent "${options.agentId}" because agents.list contains ${targetMatches.length} matching entries.`
    );
  }

  let updated = false;
  const nextAgents = agentsList.map((entry) => {
    if (!isTargetAgent(entry, options)) {
      return entry;
    }
    updated = true;
    return options.update(entry);
  });

  if (!updated && !options.allowMissingTarget) {
    if (options.matchAgentIdOnly) {
      throw new Error(`OpenClaw agents.list does not contain agent "${options.agentId}".`);
    }
    throw new Error(
      `OpenClaw agents.list does not contain agent "${options.agentId}" bound to ${options.workspacePath}.`
    );
  }
  return nextAgents;
}

function findTargetAgent(
  agentsList: unknown,
  options: {
    agentId: string;
    workspacePath: string;
  }
): Record<string, unknown> | undefined {
  if (!Array.isArray(agentsList)) {
    return undefined;
  }
  return agentsList.find((entry) => isTargetAgent(entry, options));
}

function isTargetAgent(
  entry: unknown,
  options: {
    agentId: string;
    workspacePath: string;
    matchAgentIdOnly?: boolean;
  }
): entry is Record<string, unknown> {
  if (!isRecord(entry) || entry.id !== options.agentId) {
    return false;
  }
  if (options.matchAgentIdOnly) {
    return true;
  }
  if (typeof entry.workspace !== "string") {
    return false;
  }
  return (
    normalizeConfiguredWorkspacePath(entry.workspace) ===
    normalizeConfiguredWorkspacePath(options.workspacePath)
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
    throw new Error("OpenClaw agent tools policy must be an object.");
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
