import {
  type OpenClawConfiguredAgent,
  OpenClawCli,
} from "./openclaw-cli";
import { normalizeConfiguredWorkspacePath } from "./workspace";

export const LLMWIKI_AGENT_ID = "llmwiki" as const;
export const DEFAULT_OPENCLAW_AGENT_ID = LLMWIKI_AGENT_ID;

export type AgentWorkspaceBindingStatus =
  | "bound"
  | "missing_binding"
  | "ambiguous_binding";

interface AgentWorkspaceBindingBaseResult {
  status: AgentWorkspaceBindingStatus;
  agentId: string;
  requestedWorkspace: string;
  normalizedRequestedWorkspace: string;
  candidateWorkspaces: string[];
  agentCount: number;
  malformedWorkspaceEntryCount: number;
  message: string;
}

export interface AgentWorkspaceBoundResult
  extends AgentWorkspaceBindingBaseResult {
  status: "bound";
  boundWorkspace: string;
}

export interface AgentWorkspaceMissingBindingResult
  extends AgentWorkspaceBindingBaseResult {
  status: "missing_binding";
}

export interface AgentWorkspaceAmbiguousBindingResult
  extends AgentWorkspaceBindingBaseResult {
  status: "ambiguous_binding";
}

export type AgentWorkspaceBindingResult =
  | AgentWorkspaceBoundResult
  | AgentWorkspaceMissingBindingResult
  | AgentWorkspaceAmbiguousBindingResult;

export interface ResolveAgentWorkspaceBindingOptions {
  cli?: OpenClawCli;
  agentId: string;
  workspacePath: string;
  homeDir?: string;
}

export class AgentWorkspaceBindingError extends Error {
  readonly result: AgentWorkspaceBindingResult;

  constructor(result: AgentWorkspaceBindingResult) {
    super(result.message);
    this.name = "AgentWorkspaceBindingError";
    this.result = result;
  }
}

export async function resolveAgentWorkspaceBinding(
  options: ResolveAgentWorkspaceBindingOptions
): Promise<AgentWorkspaceBindingResult> {
  const cli = options.cli ?? new OpenClawCli();
  const agentId = options.agentId;
  const normalizedRequestedWorkspace = normalizeConfiguredWorkspacePath(
    options.workspacePath,
    {
      homeDir: options.homeDir,
    }
  );
  if (!normalizedRequestedWorkspace) {
    return {
      status: "missing_binding",
      agentId,
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace: options.workspacePath,
      candidateWorkspaces: [],
      agentCount: 0,
      malformedWorkspaceEntryCount: 0,
      message:
        `OpenClaw fail-closed: explicit workspace ${options.workspacePath} ` +
        `is not a valid absolute/~/ path for agent "${agentId}" binding resolution.`,
    };
  }

  const agents = await cli.listConfiguredAgents();

  const matchingAgents = agents.filter((agent) => agent.id === agentId);
  const resolution = extractAgentWorkspaceCandidates({
    agents: matchingAgents,
    homeDir: options.homeDir,
  });

  if (matchingAgents.length > 1) {
    return {
      status: "ambiguous_binding",
      agentId,
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: resolution.candidateWorkspaces,
      agentCount: matchingAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: agent "${agentId}" has ambiguous duplicate entries ` +
        "in agents.list; cannot safely resolve explicit workspace binding.",
    };
  }

  if (resolution.malformedWorkspaceEntryCount > 0) {
    return {
      status: "ambiguous_binding",
      agentId,
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: resolution.candidateWorkspaces,
      agentCount: matchingAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: agent "${agentId}" has malformed workspace ` +
        "binding entries in agents.list; cannot safely resolve explicit workspace binding.",
    };
  }

  if (resolution.candidateWorkspaces.length === 0) {
    return {
      status: "missing_binding",
      agentId,
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: [],
      agentCount: matchingAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: explicit workspace ${normalizedRequestedWorkspace} ` +
        `is not bound to agent "${agentId}".`,
    };
  }

  if (resolution.candidateWorkspaces.length > 1) {
    return {
      status: "ambiguous_binding",
      agentId,
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: resolution.candidateWorkspaces,
      agentCount: matchingAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: agent "${agentId}" has ambiguous workspace bindings ` +
        `(${resolution.candidateWorkspaces.join(", ")}).`,
    };
  }

  const [boundWorkspace] = resolution.candidateWorkspaces;
  if (boundWorkspace !== normalizedRequestedWorkspace) {
    return {
      status: "missing_binding",
      agentId,
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: resolution.candidateWorkspaces,
      agentCount: matchingAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: explicit workspace ${normalizedRequestedWorkspace} ` +
        `does not match agent "${agentId}" workspace binding ${boundWorkspace}.`,
    };
  }

  return {
    status: "bound",
    agentId,
    requestedWorkspace: options.workspacePath,
    normalizedRequestedWorkspace,
    candidateWorkspaces: resolution.candidateWorkspaces,
    agentCount: matchingAgents.length,
    malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
    boundWorkspace,
    message:
      `Explicit workspace ${normalizedRequestedWorkspace} is bound to agent "${agentId}".`,
  };
}

export function assertAgentWorkspaceBinding(
  result: AgentWorkspaceBindingResult
): AgentWorkspaceBoundResult {
  if (result.status === "bound") {
    return result;
  }

  throw new AgentWorkspaceBindingError(result);
}

export type LlmwikiWorkspaceBindingStatus = AgentWorkspaceBindingStatus;
export type LlmwikiWorkspaceBoundResult = AgentWorkspaceBoundResult;
export type LlmwikiWorkspaceMissingBindingResult =
  AgentWorkspaceMissingBindingResult;
export type LlmwikiWorkspaceAmbiguousBindingResult =
  AgentWorkspaceAmbiguousBindingResult;
export type LlmwikiWorkspaceBindingResult = AgentWorkspaceBindingResult;
export type ResolveLlmwikiWorkspaceBindingOptions = Omit<
  ResolveAgentWorkspaceBindingOptions,
  "agentId"
>;
export class LlmwikiWorkspaceBindingError extends AgentWorkspaceBindingError {
  constructor(result: AgentWorkspaceBindingResult) {
    super(result);
    this.name = "LlmwikiWorkspaceBindingError";
  }
}

export function resolveLlmwikiWorkspaceBinding(
  options: ResolveLlmwikiWorkspaceBindingOptions
): Promise<AgentWorkspaceBindingResult> {
  return resolveAgentWorkspaceBinding({
    ...options,
    agentId: LLMWIKI_AGENT_ID,
  });
}

export function assertLlmwikiWorkspaceBinding(
  result: AgentWorkspaceBindingResult
): AgentWorkspaceBoundResult {
  return assertAgentWorkspaceBinding(result);
}

function extractAgentWorkspaceCandidates(options: {
  agents: OpenClawConfiguredAgent[];
  homeDir?: string;
}): { candidateWorkspaces: string[]; malformedWorkspaceEntryCount: number } {
  const candidates = new Set<string>();
  let malformedWorkspaceEntryCount = 0;

  for (const agent of options.agents) {
    if (!agent.workspace) {
      continue;
    }

    const normalizedWorkspace = normalizeConfiguredWorkspacePath(agent.workspace, {
      homeDir: options.homeDir,
    });
    if (!normalizedWorkspace) {
      malformedWorkspaceEntryCount += 1;
      continue;
    }

    candidates.add(normalizedWorkspace);
  }

  return {
    candidateWorkspaces: [...candidates].sort((left, right) =>
      left.localeCompare(right)
    ),
    malformedWorkspaceEntryCount,
  };
}
