import {
  type OpenClawConfiguredAgent,
  OpenClawCli,
} from "./openclaw-cli";
import { normalizeConfiguredWorkspacePath } from "./workspace";

export const LLMWIKI_AGENT_ID = "llmwiki" as const;

export type LlmwikiWorkspaceBindingStatus =
  | "bound"
  | "missing_binding"
  | "ambiguous_binding";

interface LlmwikiWorkspaceBindingBaseResult {
  status: LlmwikiWorkspaceBindingStatus;
  requestedWorkspace: string;
  normalizedRequestedWorkspace: string;
  candidateWorkspaces: string[];
  llmwikiAgentCount: number;
  malformedWorkspaceEntryCount: number;
  message: string;
}

export interface LlmwikiWorkspaceBoundResult
  extends LlmwikiWorkspaceBindingBaseResult {
  status: "bound";
  boundWorkspace: string;
}

export interface LlmwikiWorkspaceMissingBindingResult
  extends LlmwikiWorkspaceBindingBaseResult {
  status: "missing_binding";
}

export interface LlmwikiWorkspaceAmbiguousBindingResult
  extends LlmwikiWorkspaceBindingBaseResult {
  status: "ambiguous_binding";
}

export type LlmwikiWorkspaceBindingResult =
  | LlmwikiWorkspaceBoundResult
  | LlmwikiWorkspaceMissingBindingResult
  | LlmwikiWorkspaceAmbiguousBindingResult;

export interface ResolveLlmwikiWorkspaceBindingOptions {
  cli?: OpenClawCli;
  workspacePath: string;
  homeDir?: string;
}

export class LlmwikiWorkspaceBindingError extends Error {
  readonly result: LlmwikiWorkspaceBindingResult;

  constructor(result: LlmwikiWorkspaceBindingResult) {
    super(result.message);
    this.name = "LlmwikiWorkspaceBindingError";
    this.result = result;
  }
}

export async function resolveLlmwikiWorkspaceBinding(
  options: ResolveLlmwikiWorkspaceBindingOptions
): Promise<LlmwikiWorkspaceBindingResult> {
  const cli = options.cli ?? new OpenClawCli();
  const normalizedRequestedWorkspace = normalizeConfiguredWorkspacePath(
    options.workspacePath,
    {
      homeDir: options.homeDir,
    }
  );
  if (!normalizedRequestedWorkspace) {
    return {
      status: "missing_binding",
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace: options.workspacePath,
      candidateWorkspaces: [],
      llmwikiAgentCount: 0,
      malformedWorkspaceEntryCount: 0,
      message:
        `OpenClaw fail-closed: explicit workspace ${options.workspacePath} ` +
        "is not a valid absolute/~/ path for llmwiki binding resolution.",
    };
  }

  const agents = await cli.listConfiguredAgents();

  const llmwikiAgents = agents.filter((agent) => agent.id === LLMWIKI_AGENT_ID);
  const resolution = extractLlmwikiWorkspaceCandidates({
    agents: llmwikiAgents,
    homeDir: options.homeDir,
  });

  if (resolution.malformedWorkspaceEntryCount > 0) {
    return {
      status: "ambiguous_binding",
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: resolution.candidateWorkspaces,
      llmwikiAgentCount: llmwikiAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: agent "${LLMWIKI_AGENT_ID}" has malformed workspace ` +
        "binding entries in agents.list; cannot safely resolve explicit workspace binding.",
    };
  }

  if (resolution.candidateWorkspaces.length === 0) {
    return {
      status: "missing_binding",
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: [],
      llmwikiAgentCount: llmwikiAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: explicit workspace ${normalizedRequestedWorkspace} ` +
        `is not bound to agent "${LLMWIKI_AGENT_ID}".`,
    };
  }

  if (resolution.candidateWorkspaces.length > 1) {
    return {
      status: "ambiguous_binding",
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: resolution.candidateWorkspaces,
      llmwikiAgentCount: llmwikiAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: agent "${LLMWIKI_AGENT_ID}" has ambiguous workspace bindings ` +
        `(${resolution.candidateWorkspaces.join(", ")}).`,
    };
  }

  const [boundWorkspace] = resolution.candidateWorkspaces;
  if (boundWorkspace !== normalizedRequestedWorkspace) {
    return {
      status: "missing_binding",
      requestedWorkspace: options.workspacePath,
      normalizedRequestedWorkspace,
      candidateWorkspaces: resolution.candidateWorkspaces,
      llmwikiAgentCount: llmwikiAgents.length,
      malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
      message:
        `OpenClaw fail-closed: explicit workspace ${normalizedRequestedWorkspace} ` +
        `does not match "${LLMWIKI_AGENT_ID}" workspace binding ${boundWorkspace}.`,
    };
  }

  return {
    status: "bound",
    requestedWorkspace: options.workspacePath,
    normalizedRequestedWorkspace,
    candidateWorkspaces: resolution.candidateWorkspaces,
    llmwikiAgentCount: llmwikiAgents.length,
    malformedWorkspaceEntryCount: resolution.malformedWorkspaceEntryCount,
    boundWorkspace,
    message:
      `Explicit workspace ${normalizedRequestedWorkspace} is bound to "${LLMWIKI_AGENT_ID}".`,
  };
}

export function assertLlmwikiWorkspaceBinding(
  result: LlmwikiWorkspaceBindingResult
): LlmwikiWorkspaceBoundResult {
  if (result.status === "bound") {
    return result;
  }

  throw new LlmwikiWorkspaceBindingError(result);
}

function extractLlmwikiWorkspaceCandidates(options: {
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
