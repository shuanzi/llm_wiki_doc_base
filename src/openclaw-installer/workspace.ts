import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { OpenClawCli } from "./openclaw-cli";

export type OpenClawWorkspaceSource =
  | "agent-specific"
  | "agents.defaults.workspace"
  | "profile-fallback"
  | "default-fallback";

export type OpenClawDefaultAgentSource =
  | "agents.list.default"
  | "agents.list.single"
  | "none";

export interface ResolveOpenClawWorkspaceOptions {
  cli?: OpenClawCli;
  requestedWorkspace?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  requireExistingDirectory?: boolean;
}

export interface OpenClawResolvedWorkspace {
  requestedWorkspace?: string;
  resolvedWorkspace: string;
  workspaceSource: OpenClawWorkspaceSource;
  defaultAgentId?: string;
  defaultAgentSource: OpenClawDefaultAgentSource;
  matchedRequestedWorkspace: boolean;
}

interface OpenClawAgentsConfig {
  defaults?: {
    workspace?: unknown;
  };
  list?: unknown;
}

interface OpenClawAgentConfig {
  id?: unknown;
  default?: unknown;
  workspace?: unknown;
}

export class OpenClawWorkspaceResolutionError extends Error {
  readonly kind: "manual_config_required" | "invalid_workspace_path";
  readonly requestedWorkspace?: string;
  readonly resolvedWorkspace?: string;

  constructor(
    kind: "manual_config_required" | "invalid_workspace_path",
    message: string,
    details: { requestedWorkspace?: string; resolvedWorkspace?: string } = {}
  ) {
    super(message);
    this.name = "OpenClawWorkspaceResolutionError";
    this.kind = kind;
    this.requestedWorkspace = details.requestedWorkspace;
    this.resolvedWorkspace = details.resolvedWorkspace;
  }
}

export async function resolveOpenClawWorkspace(
  options: ResolveOpenClawWorkspaceOptions = {}
): Promise<OpenClawResolvedWorkspace> {
  const cli = options.cli ?? new OpenClawCli();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const requestedWorkspace = options.requestedWorkspace
    ? normalizeOpenClawPath(options.requestedWorkspace, { cwd, homeDir })
    : undefined;

  const agentsPayload = await cli.getConfigValue<unknown>("agents", {
    allowMissing: true,
  });
  const agents = validateAgentsPayload(agentsPayload);

  const defaultsWorkspace = readConfiguredDefaultsWorkspace(agents);
  const agentList = normalizeAgentList(agents?.list);
  const defaultAgentSelection = selectDefaultAgent(agentList);

  if (defaultAgentSelection.ambiguous) {
    throw new OpenClawWorkspaceResolutionError(
      "manual_config_required",
      defaultAgentSelection.reason ?? "Unable to resolve the current default OpenClaw agent workspace.",
      {
        requestedWorkspace,
      }
    );
  }

  let resolvedWorkspace: string;
  let workspaceSource: OpenClawWorkspaceSource;
  let configDir: string | undefined;

  if (typeof defaultAgentSelection.agent?.workspace === "string") {
    configDir = await resolveOpenClawConfigDirectory(cli);
    resolvedWorkspace = normalizeConfiguredOpenClawPath(defaultAgentSelection.agent.workspace, {
      configDir,
      homeDir,
    });
    workspaceSource = "agent-specific";
  } else if (typeof defaultsWorkspace === "string") {
    configDir = await resolveOpenClawConfigDirectory(cli);
    resolvedWorkspace = normalizeConfiguredOpenClawPath(defaultsWorkspace, {
      configDir,
      homeDir,
    });
    workspaceSource = "agents.defaults.workspace";
  } else if (env.OPENCLAW_PROFILE && env.OPENCLAW_PROFILE !== "default") {
    resolvedWorkspace = path.resolve(homeDir, ".openclaw", `workspace-${env.OPENCLAW_PROFILE}`);
    workspaceSource = "profile-fallback";
  } else {
    resolvedWorkspace = path.resolve(homeDir, ".openclaw", "workspace");
    workspaceSource = "default-fallback";
  }

  if (
    requestedWorkspace &&
    !pathsReferToSameLocation(requestedWorkspace, resolvedWorkspace)
  ) {
    throw new OpenClawWorkspaceResolutionError(
      "manual_config_required",
      [
        "Explicit --workspace does not match the current default-agent workspace.",
        `requested: ${requestedWorkspace}`,
        `resolved: ${resolvedWorkspace}`,
        "manual config required",
      ].join(" "),
      {
        requestedWorkspace,
        resolvedWorkspace,
      }
    );
  }

  if (fs.existsSync(resolvedWorkspace)) {
    const stat = fs.statSync(resolvedWorkspace);
    if (!stat.isDirectory()) {
      throw new OpenClawWorkspaceResolutionError(
        "invalid_workspace_path",
        `Resolved OpenClaw workspace is not a directory: ${resolvedWorkspace}`,
        {
          requestedWorkspace,
          resolvedWorkspace,
        }
      );
    }
  } else if (options.requireExistingDirectory) {
    throw new OpenClawWorkspaceResolutionError(
      "invalid_workspace_path",
      `Resolved OpenClaw workspace does not exist: ${resolvedWorkspace}`,
      {
        requestedWorkspace,
        resolvedWorkspace,
      }
    );
  }

  return {
    requestedWorkspace,
    resolvedWorkspace,
    workspaceSource,
    defaultAgentId: defaultAgentSelection.agent?.id,
    defaultAgentSource: defaultAgentSelection.source,
    matchedRequestedWorkspace: requestedWorkspace ? requestedWorkspace === resolvedWorkspace : true,
  };
}

export function normalizeOpenClawPath(
  value: string,
  options: { cwd?: string; homeDir?: string } = {}
): string {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  if (value === "~") {
    return homeDir;
  }

  if (value.startsWith("~/")) {
    return path.resolve(homeDir, value.slice(2));
  }

  return path.resolve(cwd, value);
}

function normalizeAgentList(value: unknown): readonly unknown[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new OpenClawWorkspaceResolutionError(
      "manual_config_required",
      "OpenClaw config contains a malformed agents.list value. manual config required"
    );
  }

  return value;
}

function selectDefaultAgent(
  agents: readonly unknown[]
): {
  agent?: { id: string; workspace?: string };
  source: OpenClawDefaultAgentSource;
  ambiguous: boolean;
  reason?: string;
} {
  const normalizedAgents: Array<{
    id: string;
    default: boolean;
    workspace?: string;
  }> = [];

  for (const [index, agent] of agents.entries()) {
    if (!isRecord(agent)) {
      return {
        source: "none",
        ambiguous: true,
        reason: `OpenClaw config contains a malformed agent entry at index ${index}. manual config required`,
      };
    }

    if (typeof agent.id !== "string" || !agent.id.trim()) {
      return {
        source: "none",
        ambiguous: true,
        reason: `OpenClaw config contains an agent entry without a valid string id at index ${index}. manual config required`,
      };
    }

    if (agent.default !== undefined && typeof agent.default !== "boolean") {
      return {
        source: "none",
        ambiguous: true,
        reason: `OpenClaw config contains an agent entry with a non-boolean default flag for agent ${agent.id}. manual config required`,
      };
    }

    if (agent.workspace !== undefined && typeof agent.workspace !== "string") {
      return {
        source: "none",
        ambiguous: true,
        reason: `OpenClaw config contains an agent entry with a non-string workspace for agent ${agent.id}. manual config required`,
      };
    }

    if (typeof agent.workspace === "string" && !agent.workspace.trim()) {
      return {
        source: "none",
        ambiguous: true,
        reason: `OpenClaw config contains an agent entry with an empty workspace for agent ${agent.id}. manual config required`,
      };
    }

    normalizedAgents.push({
      id: agent.id,
      default: agent.default === true,
      workspace: agent.workspace,
    });
  }

  const explicitDefaults = normalizedAgents.filter((agent) => agent.default);
  if (explicitDefaults.length > 1) {
    return {
      source: "none",
      ambiguous: true,
      reason:
        "OpenClaw config has multiple agents marked as default. Resolve the default agent manually before using the installer.",
    };
  }

  if (explicitDefaults.length === 1) {
    return {
      agent: explicitDefaults[0],
      source: "agents.list.default",
      ambiguous: false,
    };
  }

  if (normalizedAgents.length === 1) {
    return {
      agent: normalizedAgents[0],
      source: "agents.list.single",
      ambiguous: false,
    };
  }

  if (normalizedAgents.length > 1) {
    return {
      source: "none",
      ambiguous: true,
      reason:
        "OpenClaw config does not identify a single current default agent. manual config required",
    };
  }

  return {
    source: "none",
    ambiguous: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateAgentsPayload(payload: unknown): OpenClawAgentsConfig | undefined {
  if (payload === undefined) {
    return undefined;
  }

  if (!isRecord(payload) || Array.isArray(payload)) {
    throw new OpenClawWorkspaceResolutionError(
      "manual_config_required",
      "OpenClaw config contains a malformed top-level agents payload. manual config required"
    );
  }

  return payload;
}

function readConfiguredDefaultsWorkspace(agents: OpenClawAgentsConfig | undefined): string | undefined {
  if (!agents || !Object.prototype.hasOwnProperty.call(agents, "defaults")) {
    return undefined;
  }

  if (agents.defaults === undefined) {
    return undefined;
  }

  if (!isRecord(agents.defaults)) {
    throw new OpenClawWorkspaceResolutionError(
      "manual_config_required",
      "OpenClaw config contains a malformed agents.defaults value. manual config required"
    );
  }

  if (!Object.prototype.hasOwnProperty.call(agents.defaults, "workspace")) {
    return undefined;
  }

  const { workspace } = agents.defaults;

  if (typeof workspace !== "string") {
    throw new OpenClawWorkspaceResolutionError(
      "manual_config_required",
      "OpenClaw config contains a malformed agents.defaults.workspace value. manual config required"
    );
  }

  if (!workspace.trim()) {
    throw new OpenClawWorkspaceResolutionError(
      "manual_config_required",
      "OpenClaw config contains an empty agents.defaults.workspace value. manual config required"
    );
  }

  return workspace;
}

async function resolveOpenClawConfigDirectory(cli: OpenClawCli): Promise<string> {
  return path.dirname(await cli.getConfigFilePath());
}

function normalizeConfiguredOpenClawPath(
  value: string,
  options: { configDir: string; homeDir?: string }
): string {
  const homeDir = options.homeDir ?? os.homedir();

  if (value === "~") {
    return homeDir;
  }

  if (value.startsWith("~/")) {
    return path.resolve(homeDir, value.slice(2));
  }

  if (path.isAbsolute(value)) {
    return path.normalize(value);
  }

  // Config-defined relative paths must not depend on the caller's cwd.
  // Resolve them from the OpenClaw config directory to keep workspace discovery deterministic.
  return path.resolve(options.configDir, value);
}

function pathsReferToSameLocation(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  if (fs.existsSync(left) && fs.existsSync(right)) {
    return realpathForComparison(left) === realpathForComparison(right);
  }

  return false;
}

function realpathForComparison(targetPath: string): string {
  return fs.realpathSync.native
    ? fs.realpathSync.native(targetPath)
    : fs.realpathSync(targetPath);
}
