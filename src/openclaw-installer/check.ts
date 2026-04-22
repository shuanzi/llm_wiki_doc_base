import * as fs from "fs";
import * as path from "path";

import { sha256 } from "../utils/hash";
import { validateMinimumKbStructure } from "./kb-bootstrap";
import {
  readInstallerManifest,
  validateInstallerManifest,
} from "./manifest";
import { probeKbMcpServer } from "./mcp-probe";
import {
  OpenClawCli,
  OpenClawCliError,
  type OpenClawMcpServerDefinition,
} from "./openclaw-cli";
import { OPENCLAW_SKILL_NAMES } from "./skills";
import {
  OpenClawWorkspaceResolutionError,
  resolveOpenClawWorkspace,
} from "./workspace";
import { renderAllOpenClawWorkspaceDocs } from "./workspace-docs";
import type {
  InstallerCheckResult,
  InstallerDriftItem,
  InstallerExpectedMcpConfig,
  InstallerManifest,
  InstallerProbeSnapshot,
  ResolvedInstallerEnvironment,
} from "./types";

const CHECK_REQUIRED_SKILLS = [...OPENCLAW_SKILL_NAMES];

export interface CheckOpenClawInstallationOptions {
  environment: ResolvedInstallerEnvironment;
  requestedWorkspace?: string;
  mcpName?: string;
  cli?: OpenClawCli;
  nodeCommand?: string;
}

interface CheckContext {
  cliReady: boolean;
  defaultAgentWorkspaceConfirmed: boolean;
  resolvedWorkspacePath?: string;
  resolvedManifest?: InstallerManifest;
  expectedMcpConfig?: InstallerExpectedMcpConfig;
  actualMcpConfig?: InstallerExpectedMcpConfig;
  effectiveKbRoot?: string;
  lastProbe?: InstallerProbeSnapshot;
}

export async function checkOpenClawInstallation(
  options: CheckOpenClawInstallationOptions
): Promise<InstallerCheckResult> {
  const cli = options.cli ?? new OpenClawCli();
  const requestedWorkspace = options.requestedWorkspace ?? options.environment.workspace;
  const mcpName = options.mcpName ?? options.environment.mcpName;
  const environment: ResolvedInstallerEnvironment = {
    ...options.environment,
    workspace: requestedWorkspace,
    mcpName,
    command: "check",
  };

  const driftItems: InstallerDriftItem[] = [];
  const context: CheckContext = {
    cliReady: false,
    defaultAgentWorkspaceConfirmed: false,
  };

  await checkOpenClawCliAvailability(cli, driftItems, context);
  await resolveWorkspace(cli, requestedWorkspace, environment, driftItems, context);
  await checkManifest(environment, driftItems, context);
  checkWorkspaceDocs(environment, driftItems, context);
  checkBuildArtifact(environment, driftItems, context);
  await checkSavedMcpConfig(cli, environment, driftItems, context);
  checkKbStructure(driftItems, context, environment);
  await checkActiveProbe(driftItems, context, environment, options.nodeCommand);

  if (context.defaultAgentWorkspaceConfirmed) {
    await checkDefaultAgentSkillEligibility(cli, driftItems, context);
  }

  return {
    ok: driftItems.length === 0,
    environment,
    driftItems,
    manifest: context.resolvedManifest,
    lastProbe: context.lastProbe,
  };
}

async function checkOpenClawCliAvailability(
  cli: OpenClawCli,
  driftItems: InstallerDriftItem[],
  context: CheckContext
): Promise<void> {
  try {
    await cli.getConfigFilePath();
    context.cliReady = true;
  } catch (error) {
    context.cliReady = false;
    driftItems.push({
      kind: "invalid_openclaw_cli",
      message: `OpenClaw CLI is missing or unusable: ${stringifyError(error)}`,
      repairable: false,
    });
  }
}

async function resolveWorkspace(
  cli: OpenClawCli,
  requestedWorkspace: string | undefined,
  environment: ResolvedInstallerEnvironment,
  driftItems: InstallerDriftItem[],
  context: CheckContext
): Promise<void> {
  if (!context.cliReady) {
    if (requestedWorkspace) {
      const normalizedRequestedWorkspace = path.resolve(requestedWorkspace);
      context.resolvedWorkspacePath = normalizedRequestedWorkspace;
      environment.workspace = normalizedRequestedWorkspace;
    }
    return;
  }

  try {
    const resolved = await resolveOpenClawWorkspace({
      cli,
      requestedWorkspace,
      requireExistingDirectory: false,
    });
    context.resolvedWorkspacePath = resolved.resolvedWorkspace;
    context.defaultAgentWorkspaceConfirmed = true;
    environment.workspace = resolved.resolvedWorkspace;

    if (!fs.existsSync(resolved.resolvedWorkspace)) {
      driftItems.push({
        kind: "workspace_mismatch",
        message: `Resolved OpenClaw workspace does not exist: ${resolved.resolvedWorkspace}`,
        repairable: true,
      });
      return;
    }

    if (!fs.statSync(resolved.resolvedWorkspace).isDirectory()) {
      driftItems.push({
        kind: "workspace_mismatch",
        message: `Resolved OpenClaw workspace is not a directory: ${resolved.resolvedWorkspace}`,
        repairable: false,
      });
    }
  } catch (error) {
    if (error instanceof OpenClawWorkspaceResolutionError) {
      if (error.resolvedWorkspace) {
        context.resolvedWorkspacePath = error.resolvedWorkspace;
        environment.workspace = error.resolvedWorkspace;
      } else if (error.requestedWorkspace) {
        context.resolvedWorkspacePath = error.requestedWorkspace;
        environment.workspace = error.requestedWorkspace;
      }

      const isWorkspaceMismatch =
        error.kind === "manual_config_required" &&
        Boolean(error.requestedWorkspace && error.resolvedWorkspace);
      const driftKind =
        isWorkspaceMismatch || error.kind === "invalid_workspace_path"
          ? "workspace_mismatch"
          : "manual_config_required";

      driftItems.push({
        kind: driftKind,
        message: error.message,
        repairable: false,
        expected: error.resolvedWorkspace,
        actual: error.requestedWorkspace,
      });
      return;
    }

    driftItems.push({
      kind: "other",
      message: `Failed to resolve OpenClaw workspace: ${stringifyError(error)}`,
      repairable: false,
    });
  }
}

async function checkManifest(
  environment: ResolvedInstallerEnvironment,
  driftItems: InstallerDriftItem[],
  context: CheckContext
): Promise<void> {
  const workspacePath = context.resolvedWorkspacePath ?? environment.workspace;
  if (!workspacePath) {
    driftItems.push({
      kind: "missing_manifest",
      message: "Cannot resolve target workspace, so manifest status is unknown.",
      repairable: false,
    });
    return;
  }

  if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
    driftItems.push({
      kind: "missing_manifest",
      message: `Workspace is unavailable; manifest cannot be read: ${workspacePath}`,
      repairable: false,
    });
    return;
  }

  let manifest: InstallerManifest | undefined;
  try {
    manifest = readInstallerManifest(workspacePath, { allowMissing: true });
  } catch (error) {
    driftItems.push({
      kind: "missing_manifest",
      message: `Installer manifest is malformed: ${stringifyError(error)}`,
      repairable: true,
    });
    return;
  }

  if (!manifest) {
    driftItems.push({
      kind: "missing_manifest",
      message: "Installer manifest is missing.",
      repairable: true,
    });
    return;
  }

  context.resolvedManifest = manifest;
  environment.kbRoot = manifest.kbRoot;

  const expectedMcpConfig = buildExpectedMcpConfig({
    mcpName: environment.mcpName,
    serverEntrypoint: expectedServerEntrypointForRepoRoot(manifest.repoRoot),
    kbRoot: manifest.kbRoot,
  });

  context.expectedMcpConfig = expectedMcpConfig;

  const validationResult = validateInstallerManifest(manifest, {
    repoRoot: environment.repoRoot,
    workspacePath,
    kbRoot: manifest.kbRoot,
    mcpName: environment.mcpName,
    expectedMcpConfig,
  });

  driftItems.push(...validationResult.driftItems);
}

function checkWorkspaceDocs(
  environment: ResolvedInstallerEnvironment,
  driftItems: InstallerDriftItem[],
  context: CheckContext
): void {
  const workspacePath = context.resolvedWorkspacePath ?? environment.workspace;
  if (!workspacePath) {
    driftItems.push({
      kind: "missing_workspace_doc",
      message:
        "Cannot resolve target workspace, so workspace-root doc status is unknown.",
      repairable: false,
    });
    return;
  }

  if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
    driftItems.push({
      kind: "missing_workspace_doc",
      message: `Workspace is unavailable; workspace-root docs cannot be checked: ${workspacePath}`,
      repairable: false,
    });
    return;
  }

  const workspaceLstat = fs.lstatSync(workspacePath);
  if (workspaceLstat.isSymbolicLink()) {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Workspace root must not be a symlink for installer-managed workspace docs: ${workspacePath}`,
      repairable: false,
    });
    return;
  }

  const renderedWorkspaceDocs = renderAllOpenClawWorkspaceDocs();

  for (const renderedDoc of renderedWorkspaceDocs) {
    const docFile = path.resolve(workspacePath, renderedDoc.installRelativeFile);
    if (!fs.existsSync(docFile)) {
      driftItems.push({
        kind: "missing_workspace_doc",
        message: `Workspace-root doc is missing: ${docFile}`,
        repairable: true,
      });
      continue;
    }

    const docLstat = fs.lstatSync(docFile);
    if (docLstat.isSymbolicLink()) {
      driftItems.push({
        kind: "unknown_ownership",
        message: `Workspace-root doc path must not be a symlink: ${docFile}`,
        repairable: false,
      });
      continue;
    }

    if (!docLstat.isFile()) {
      driftItems.push({
        kind: "missing_workspace_doc",
        message: `Workspace-root doc path is not a regular file: ${docFile}`,
        repairable: true,
      });
      continue;
    }

    const diskContentHash = sha256(fs.readFileSync(docFile, "utf8"));
    if (diskContentHash !== renderedDoc.contentHash) {
      driftItems.push({
        kind: "workspace_doc_hash_drift",
        message: `Workspace-root doc drift detected: ${docFile}`,
        repairable: true,
        expected: renderedDoc.contentHash,
        actual: diskContentHash,
      });
    }
  }
}

function checkBuildArtifact(
  environment: ResolvedInstallerEnvironment,
  driftItems: InstallerDriftItem[],
  context: CheckContext
): void {
  const buildArtifactPath = context.resolvedManifest
    ? expectedServerEntrypointForRepoRoot(context.resolvedManifest.repoRoot)
    : environment.mcpServerEntrypoint;

  if (!fs.existsSync(buildArtifactPath) || !fs.statSync(buildArtifactPath).isFile()) {
    driftItems.push({
      kind: "missing_build_artifact",
      message: `MCP build artifact is missing: ${buildArtifactPath}`,
      repairable: true,
      expected: buildArtifactPath,
    });
  }
}

async function checkSavedMcpConfig(
  cli: OpenClawCli,
  environment: ResolvedInstallerEnvironment,
  driftItems: InstallerDriftItem[],
  context: CheckContext
): Promise<void> {
  if (!context.cliReady) {
    return;
  }

  let actualMcpServer: OpenClawMcpServerDefinition | undefined;
  try {
    actualMcpServer = await cli.showMcpServer(environment.mcpName);
  } catch (error) {
    driftItems.push({
      kind: "mcp_config_drift",
      message: `Failed to inspect OpenClaw MCP config: ${stringifyError(error)}`,
      repairable: true,
    });
    return;
  }

  if (!actualMcpServer) {
    driftItems.push({
      kind: "mcp_config_drift",
      message: `OpenClaw MCP server entry is missing: ${environment.mcpName}`,
      repairable: true,
    });
    return;
  }

  const normalizedActualConfig = normalizeActualMcpConfig(environment.mcpName, actualMcpServer);
  if (!normalizedActualConfig) {
    driftItems.push({
      kind: "mcp_config_drift",
      message:
        "OpenClaw MCP server entry is present but does not match the expected stdio command/args/env shape.",
      repairable: true,
      actual: JSON.stringify(actualMcpServer),
    });
    return;
  }

  context.actualMcpConfig = normalizedActualConfig;

  if (!context.expectedMcpConfig) {
    const kbRootFromConfig = normalizedActualConfig.env.KB_ROOT;
    if (kbRootFromConfig) {
      context.effectiveKbRoot = path.resolve(kbRootFromConfig);
      environment.kbRoot = context.effectiveKbRoot;
    }
    return;
  }

  if (!areExpectedMcpConfigsEqual(context.expectedMcpConfig, normalizedActualConfig)) {
    driftItems.push({
      kind: "mcp_config_drift",
      message: "Saved OpenClaw MCP config drifted from installer expectation.",
      repairable: true,
      expected: JSON.stringify(context.expectedMcpConfig),
      actual: JSON.stringify(normalizedActualConfig),
    });
  }

  if (!context.effectiveKbRoot) {
    context.effectiveKbRoot = path.resolve(normalizedActualConfig.env.KB_ROOT);
    environment.kbRoot = context.effectiveKbRoot;
  }
}

function checkKbStructure(
  driftItems: InstallerDriftItem[],
  context: CheckContext,
  environment: ResolvedInstallerEnvironment
): void {
  const kbRoot =
    context.resolvedManifest?.kbRoot ??
    context.effectiveKbRoot ??
    environment.kbRoot;

  if (!kbRoot) {
    driftItems.push({
      kind: "other",
      message: "KB_ROOT could not be resolved from manifest or saved MCP config.",
      repairable: true,
    });
    return;
  }

  const validation = validateMinimumKbStructure(kbRoot);
  if (!validation.ok) {
    driftItems.push({
      kind: "other",
      message: [
        `External KB root is missing required structure: ${validation.kbRoot}`,
        validation.missingDirectories.length > 0
          ? `missing directories: ${validation.missingDirectories.join(", ")}`
          : undefined,
        validation.missingFiles.length > 0
          ? `missing files: ${validation.missingFiles.join(", ")}`
          : undefined,
        validation.invalidPaths.length > 0
          ? `invalid paths: ${validation.invalidPaths.join(", ")}`
          : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join(" | "),
      repairable: true,
    });
  }

  context.effectiveKbRoot = validation.kbRoot;
  environment.kbRoot = validation.kbRoot;
}

async function checkActiveProbe(
  driftItems: InstallerDriftItem[],
  context: CheckContext,
  environment: ResolvedInstallerEnvironment,
  nodeCommand: string | undefined
): Promise<void> {
  const kbRoot =
    context.effectiveKbRoot ??
    context.resolvedManifest?.kbRoot ??
    context.actualMcpConfig?.env.KB_ROOT ??
    environment.kbRoot;

  if (!kbRoot) {
    driftItems.push({
      kind: "mcp_probe_failure",
      message: "Cannot run active MCP probe because KB_ROOT is unresolved.",
      repairable: true,
    });
    return;
  }

  const serverEntrypoint = context.resolvedManifest
    ? expectedServerEntrypointForRepoRoot(context.resolvedManifest.repoRoot)
    : environment.mcpServerEntrypoint;

  if (!fs.existsSync(serverEntrypoint) || !fs.statSync(serverEntrypoint).isFile()) {
    driftItems.push({
      kind: "mcp_probe_failure",
      message: `Cannot run active MCP probe because server entrypoint is missing: ${serverEntrypoint}`,
      repairable: true,
    });
    return;
  }

  const probeResult = await probeKbMcpServer({
    serverEntrypoint,
    kbRoot,
    nodeCommand,
  });

  context.lastProbe = {
    checkedAt: probeResult.checkedAt,
    ok: probeResult.ok,
    toolNames: probeResult.toolNames,
    failureReason: probeResult.failureReason,
  };

  if (!probeResult.ok) {
    driftItems.push({
      kind: "mcp_probe_failure",
      message:
        probeResult.failureReason ??
        "Active MCP probe failed without a detailed error.",
      repairable: true,
    });
  }
}

async function checkDefaultAgentSkillEligibility(
  cli: OpenClawCli,
  driftItems: InstallerDriftItem[],
  context: CheckContext
): Promise<void> {
  if (!context.cliReady || !context.resolvedWorkspacePath) {
    return;
  }

  let agentsPayload: unknown;
  try {
    agentsPayload = await cli.getConfigValue<unknown>("agents", { allowMissing: true });
  } catch (error) {
    driftItems.push({
      kind: "manual_config_required",
      message: `Failed to inspect OpenClaw agent config for skill eligibility: ${stringifyError(error)}`,
      repairable: false,
    });
    return;
  }

  const defaultSkillConfig = evaluateDefaultSkillRestrictions(agentsPayload);
  driftItems.push(...defaultSkillConfig);

  let eligibleSkills: string[];
  try {
    const listed = await cli.listEligibleSkills();
    eligibleSkills = listed.map((entry) => entry.name);
  } catch (error) {
    const kind =
      error instanceof OpenClawCliError && error.exitCode < 0
        ? "invalid_openclaw_cli"
        : "manual_config_required";
    driftItems.push({
      kind,
      message: `Failed to list OpenClaw eligible skills: ${stringifyError(error)}`,
      repairable: false,
    });
    return;
  }

  const eligibleSet = new Set(eligibleSkills);
  const missingSkills = CHECK_REQUIRED_SKILLS.filter((skill) => !eligibleSet.has(skill));

  if (missingSkills.length > 0) {
    driftItems.push({
      kind: "manual_config_required",
      message: `Installed skills are not eligible for the current default agent: missing ${missingSkills.join(", ")}`,
      repairable: false,
      expected: CHECK_REQUIRED_SKILLS.join(", "),
      actual: eligibleSkills.sort((left, right) => left.localeCompare(right)).join(", "),
    });
  }
}

function evaluateDefaultSkillRestrictions(agentsPayload: unknown): InstallerDriftItem[] {
  if (agentsPayload === undefined) {
    return [];
  }

  if (!isRecord(agentsPayload)) {
    return [
      {
        kind: "manual_config_required",
        message: "OpenClaw agents config payload is malformed.",
        repairable: false,
      },
    ];
  }

  const restrictions: InstallerDriftItem[] = [];

  const defaultsSkills = readOptionalSkillList(
    isRecord(agentsPayload.defaults) ? agentsPayload.defaults.skills : undefined,
    "agents.defaults.skills"
  );

  if (defaultsSkills.error) {
    restrictions.push(defaultsSkills.error);
  } else if (defaultsSkills.value) {
    const defaultsSkillList = defaultsSkills.value;
    const missing = CHECK_REQUIRED_SKILLS.filter(
      (skill) => !defaultsSkillList.includes(skill)
    );
    if (missing.length > 0) {
      restrictions.push({
        kind: "manual_config_required",
        message: `agents.defaults.skills excludes required installer skills: ${missing.join(", ")}`,
        repairable: false,
      });
    }
  }

  const defaultAgent = pickConfiguredDefaultAgent(agentsPayload.list);
  if (defaultAgent.error) {
    restrictions.push(defaultAgent.error);
    return restrictions;
  }

  if (defaultAgent.value && Object.prototype.hasOwnProperty.call(defaultAgent.value, "skills")) {
    const agentSkills = readOptionalSkillList(
      defaultAgent.value.skills,
      `agents.list[${defaultAgent.valueIndex}].skills`
    );

    if (agentSkills.error) {
      restrictions.push(agentSkills.error);
    } else if (agentSkills.value) {
      const agentSkillList = agentSkills.value;
      const missing = CHECK_REQUIRED_SKILLS.filter(
        (skill) => !agentSkillList.includes(skill)
      );
      if (missing.length > 0) {
        restrictions.push({
          kind: "manual_config_required",
          message: `Default agent skills list excludes required installer skills: ${missing.join(", ")}`,
          repairable: false,
        });
      }
    }
  }

  return restrictions;
}

function pickConfiguredDefaultAgent(value: unknown): {
  value?: Record<string, unknown>;
  valueIndex: number;
  error?: InstallerDriftItem;
} {
  if (value === undefined) {
    return { valueIndex: -1 };
  }

  if (!Array.isArray(value)) {
    return {
      valueIndex: -1,
      error: {
        kind: "manual_config_required",
        message: "OpenClaw agents.list is malformed.",
        repairable: false,
      },
    };
  }

  const normalized: Array<{ index: number; value: Record<string, unknown> }> = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      return {
        valueIndex: -1,
        error: {
          kind: "manual_config_required",
          message: `OpenClaw agents.list entry at index ${index} is malformed.`,
          repairable: false,
        },
      };
    }
    normalized.push({ index, value: item });
  }

  const explicitDefaults = normalized.filter((entry) => entry.value.default === true);
  if (explicitDefaults.length > 1) {
    return {
      valueIndex: -1,
      error: {
        kind: "manual_config_required",
        message: "Multiple agents are marked as default; manual config required.",
        repairable: false,
      },
    };
  }

  if (explicitDefaults.length === 1) {
    return {
      value: explicitDefaults[0].value,
      valueIndex: explicitDefaults[0].index,
    };
  }

  if (normalized.length === 1) {
    return {
      value: normalized[0].value,
      valueIndex: normalized[0].index,
    };
  }

  if (normalized.length > 1) {
    return {
      valueIndex: -1,
      error: {
        kind: "manual_config_required",
        message: "No single default agent could be identified from agents.list.",
        repairable: false,
      },
    };
  }

  return { valueIndex: -1 };
}

function readOptionalSkillList(
  value: unknown,
  label: string
): { value?: string[]; error?: InstallerDriftItem } {
  if (value === undefined) {
    return {};
  }

  if (!Array.isArray(value)) {
    return {
      error: {
        kind: "manual_config_required",
        message: `${label} must be an array of skill names.`,
        repairable: false,
      },
    };
  }

  const normalized: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      return {
        error: {
          kind: "manual_config_required",
          message: `${label}[${index}] must be a non-empty skill name.`,
          repairable: false,
        },
      };
    }
    normalized.push(item);
  }

  return { value: normalized };
}

function normalizeActualMcpConfig(
  mcpName: string,
  definition: OpenClawMcpServerDefinition
): InstallerExpectedMcpConfig | undefined {
  if (typeof definition.command !== "string" || !definition.command) {
    return undefined;
  }

  if (!Array.isArray(definition.args) || definition.args.some((item) => typeof item !== "string")) {
    return undefined;
  }

  if (!isRecord(definition.env)) {
    return undefined;
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(definition.env)) {
    if (typeof value !== "string") {
      return undefined;
    }
    env[key] = value;
  }

  if (typeof env.KB_ROOT !== "string" || !env.KB_ROOT) {
    return undefined;
  }

  return {
    name: mcpName,
    command: definition.command,
    args: [...definition.args],
    env,
  };
}

function areExpectedMcpConfigsEqual(
  left: InstallerExpectedMcpConfig,
  right: InstallerExpectedMcpConfig
): boolean {
  if (left.name !== right.name || left.command !== right.command) {
    return false;
  }

  if (left.args.length !== right.args.length) {
    return false;
  }

  for (let index = 0; index < left.args.length; index += 1) {
    if (left.args[index] !== right.args[index]) {
      return false;
    }
  }

  const leftEnvEntries = Object.entries(left.env).sort(([a], [b]) => a.localeCompare(b));
  const rightEnvEntries = Object.entries(right.env).sort(([a], [b]) => a.localeCompare(b));

  if (leftEnvEntries.length !== rightEnvEntries.length) {
    return false;
  }

  for (let index = 0; index < leftEnvEntries.length; index += 1) {
    const [leftKey, leftValue] = leftEnvEntries[index];
    const [rightKey, rightValue] = rightEnvEntries[index];
    if (leftKey !== rightKey || leftValue !== rightValue) {
      return false;
    }
  }

  return true;
}

function expectedServerEntrypointForRepoRoot(repoRoot: string): string {
  return path.resolve(repoRoot, "dist", "mcp_server.js");
}

function buildExpectedMcpConfig(options: {
  mcpName: string;
  serverEntrypoint: string;
  kbRoot: string;
  nodeCommand?: string;
}): InstallerExpectedMcpConfig {
  return {
    name: options.mcpName,
    command: options.nodeCommand ?? process.execPath,
    args: [path.resolve(options.serverEntrypoint)],
    env: {
      KB_ROOT: path.resolve(options.kbRoot),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  areExpectedMcpConfigsEqual,
  buildExpectedMcpConfig,
  expectedServerEntrypointForRepoRoot,
  normalizeActualMcpConfig,
};
