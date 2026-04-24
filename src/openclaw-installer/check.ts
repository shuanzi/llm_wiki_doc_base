import * as fs from "fs";
import * as path from "path";

import { KB_CANONICAL_TOOL_NAMES } from "../runtime/kb_tool_contract";
import { sha256 } from "../utils/hash";
import { validateMinimumKbStructure } from "./kb-bootstrap";
import { resolveAgentWorkspaceBinding } from "./llmwiki-binding";
import {
  readInstallerManifest,
  validateInstallerManifest,
} from "./manifest";
import { probeKbMcpServer } from "./mcp-probe";
import {
  OpenClawCli,
  type OpenClawMcpServerDefinition,
} from "./openclaw-cli";
import { hasSessionRuntimeAgentToolPolicy } from "./session-runtime-agent-policy";
import {
  readSessionRuntimePluginConfig,
  sessionRuntimePluginConfigDrift,
} from "./session-runtime-config";
import { probeSessionRuntimeSurface, toSessionRuntimeProbeSnapshot } from "./session-runtime-probe";
import { resolveExplicitWorkspacePath } from "./workspace";
import { renderAllOpenClawWorkspaceDocs } from "./workspace-docs";
import type {
  InstallerCheckResult,
  InstallerDriftItem,
  InstallerExpectedMcpConfig,
  InstallerManifest,
  InstallerProbeSnapshot,
  ResolvedInstallerEnvironment,
} from "./types";

export interface CheckOpenClawInstallationOptions {
  environment: ResolvedInstallerEnvironment;
  requestedWorkspace?: string;
  mcpName?: string;
  cli?: OpenClawCli;
  nodeCommand?: string;
  openclawPackageRoot?: string;
  resolvePluginToolsEntrypoint?: string;
  openclawCliExecutablePath?: string;
}

interface CheckContext {
  cliReady: boolean;
  agentBindingOk: boolean;
  resolvedWorkspacePath?: string;
  resolvedManifest?: InstallerManifest;
  expectedMcpConfig?: InstallerExpectedMcpConfig;
  actualMcpConfig?: InstallerExpectedMcpConfig;
  effectiveKbRoot?: string;
  lastProbe?: InstallerProbeSnapshot;
  lastSessionProbe?: InstallerProbeSnapshot;
}

export async function checkOpenClawInstallation(
  options: CheckOpenClawInstallationOptions
): Promise<InstallerCheckResult> {
  const cli = options.cli ?? new OpenClawCli();
  const requestedWorkspace = options.requestedWorkspace ?? options.environment.workspace;
  if (!requestedWorkspace) {
    throw new Error("Workspace is required. Provide --workspace.");
  }

  const resolvedWorkspacePath = resolveExplicitWorkspacePath(requestedWorkspace);
  const mcpName = options.mcpName ?? options.environment.mcpName;
  const environment: ResolvedInstallerEnvironment = {
    ...options.environment,
    workspace: resolvedWorkspacePath,
    mcpName,
    agentId: options.environment.agentId,
    command: "check",
  };

  const driftItems: InstallerDriftItem[] = [];
  const context: CheckContext = {
    cliReady: false,
    agentBindingOk: false,
    resolvedWorkspacePath,
  };

  await checkOpenClawCliAvailability(cli, driftItems, context);
  await checkAgentWorkspaceBinding(cli, environment, driftItems, context);
  await checkManifest(environment, driftItems, context);
  checkWorkspaceDocs(environment, driftItems, context);
  checkBuildArtifact(environment, driftItems, context);
  await checkSavedMcpConfig(cli, environment, driftItems, context);
  checkKbStructure(driftItems, context, environment);
  await checkSessionRuntime(driftItems, context, cli, environment, {
    openclawPackageRoot: options.openclawPackageRoot,
    resolvePluginToolsEntrypoint: options.resolvePluginToolsEntrypoint,
    openclawCliExecutablePath:
      options.openclawCliExecutablePath ?? cli.resolveExecutablePath(),
  });
  await checkActiveProbe(driftItems, context, environment, options.nodeCommand);

  return {
    ok: driftItems.length === 0,
    environment,
    driftItems,
    manifest: context.resolvedManifest,
    lastProbe: context.lastProbe,
    lastSessionProbe: context.lastSessionProbe,
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
  context.lastSessionProbe = manifest.lastSuccessfulSessionProbe;
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
    agentId: environment.agentId,
    expectedMcpConfig,
  });

  driftItems.push(...validationResult.driftItems);
}

async function checkAgentWorkspaceBinding(
  cli: OpenClawCli,
  environment: ResolvedInstallerEnvironment,
  driftItems: InstallerDriftItem[],
  context: CheckContext
): Promise<void> {
  if (!context.cliReady) {
    return;
  }

  const workspacePath = context.resolvedWorkspacePath ?? environment.workspace;
  if (!workspacePath) {
    driftItems.push({
      kind: "session_runtime_binding_failure",
      message:
        `Cannot validate agent "${environment.agentId}" workspace binding because explicit workspace is unresolved.`,
      repairable: false,
    });
    return;
  }

  try {
    const bindingResult = await resolveAgentWorkspaceBinding({
      cli,
      agentId: environment.agentId,
      workspacePath,
    });
    if (bindingResult.status !== "bound") {
      driftItems.push({
        kind: "session_runtime_binding_failure",
        message: bindingResult.message,
        repairable: false,
      });
      return;
    }
    context.agentBindingOk = true;
  } catch (error) {
    driftItems.push({
      kind: "session_runtime_binding_failure",
      message: `Failed to validate agent "${environment.agentId}" workspace binding: ${stringifyError(error)}`,
      repairable: false,
    });
  }
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
  const runtimeArtifacts = context.resolvedManifest
    ? {
        mcpEntrypoint: expectedServerEntrypointForRepoRoot(context.resolvedManifest.repoRoot),
        pluginEntrypoint: expectedOpenClawPluginEntrypointForRepoRoot(
          context.resolvedManifest.repoRoot
        ),
        pluginManifest: expectedOpenClawPluginManifestPathForRepoRoot(
          context.resolvedManifest.repoRoot
        ),
      }
    : {
        mcpEntrypoint: environment.mcpServerEntrypoint,
        pluginEntrypoint: environment.openclawPluginEntrypoint,
        pluginManifest: environment.openclawPluginManifestPath,
      };

  const artifactChecks = [
    { label: "MCP build artifact", path: runtimeArtifacts.mcpEntrypoint },
    { label: "OpenClaw plugin runtime artifact", path: runtimeArtifacts.pluginEntrypoint },
    { label: "OpenClaw plugin manifest", path: runtimeArtifacts.pluginManifest },
  ] as const;

  for (const artifact of artifactChecks) {
    if (fs.existsSync(artifact.path) && fs.statSync(artifact.path).isFile()) {
      continue;
    }

    driftItems.push({
      kind: "missing_build_artifact",
      message: `${artifact.label} is missing: ${artifact.path}`,
      repairable: true,
      expected: artifact.path,
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

async function checkSessionRuntime(
  driftItems: InstallerDriftItem[],
  context: CheckContext,
  cli: OpenClawCli,
  environment: ResolvedInstallerEnvironment,
  options: {
    openclawPackageRoot?: string;
    resolvePluginToolsEntrypoint?: string;
    openclawCliExecutablePath?: string;
  }
): Promise<void> {
  if (!context.resolvedManifest) {
    return;
  }

  const sessionRuntime = context.resolvedManifest.sessionRuntime;
  if (!sessionRuntime) {
    driftItems.push({
      kind: "missing_session_runtime",
      message:
        `Installer manifest is missing session runtime metadata for agent "${environment.agentId}" session-visible tool integration.`,
      repairable: true,
    });
    return;
  }
  if (sessionRuntime.agentId !== environment.agentId) {
    return;
  }

  if (!context.cliReady) {
    return;
  }

  let configuredPluginConfig: Awaited<ReturnType<typeof readSessionRuntimePluginConfig>>;
  try {
    configuredPluginConfig = await readSessionRuntimePluginConfig(cli);
  } catch (error) {
    driftItems.push({
      kind: "session_runtime_binding_failure",
      message:
        `Failed to inspect session runtime plugin config: ${stringifyError(error)}`,
      repairable: true,
    });
    return;
  }
  const pluginConfigDrift = sessionRuntimePluginConfigDrift({
    snapshot: configuredPluginConfig,
    pluginRoot: sessionRuntime.pluginRoot,
  });
  if (pluginConfigDrift.length > 0) {
    driftItems.push({
      kind: "missing_session_runtime",
      message:
        `Session runtime plugin is not fully registered in OpenClaw config: ` +
        pluginConfigDrift.join(", ") +
        ".",
      repairable: true,
      expected: "enabled plugin entry, plugin allowlist entry, and plugin load path",
      actual: JSON.stringify(configuredPluginConfig),
    });
  }

  let agentToolPolicyOk = false;
  try {
    agentToolPolicyOk = await hasSessionRuntimeAgentToolPolicy({
      cli,
      agentId: environment.agentId,
      workspacePath:
        context.resolvedWorkspacePath ??
        path.resolve(sessionRuntime.pluginRoot, "..", "..", ".."),
    });
  } catch (error) {
    driftItems.push({
      kind: "session_runtime_binding_failure",
      message:
        `Failed to inspect agent "${environment.agentId}" tool policy: ${stringifyError(error)}`,
      repairable: true,
    });
    return;
  }
  if (!agentToolPolicyOk) {
    driftItems.push({
      kind: "missing_session_runtime",
      message:
        `Agent "${environment.agentId}" does not allow the ` +
        `"${sessionRuntime.pluginId}" plugin tool group in tools.allow/tools.alsoAllow.`,
      repairable: true,
      expected: sessionRuntime.pluginId,
      actual: "missing from tools.allow/tools.alsoAllow",
    });
  }

  if (!context.agentBindingOk) {
    return;
  }

  if (hasSessionRuntimeUnknownOwnershipDrift(driftItems)) {
    return;
  }

  const invocationKbRoot =
    context.effectiveKbRoot ??
    context.resolvedManifest.kbRoot ??
    context.actualMcpConfig?.env.KB_ROOT ??
    environment.kbRoot;
  if (!invocationKbRoot) {
    driftItems.push({
      kind: "session_runtime_probe_failure",
      message:
        "Session runtime probe cannot invoke kb_read_page because KB_ROOT is unresolved.",
      repairable: true,
    });
    return;
  }

  const probeResult = await probeSessionRuntimeSurface({
    sessionRuntime,
    invocationKbRoot,
    expectedToolNames: KB_CANONICAL_TOOL_NAMES,
    openclawPackageRoot: options.openclawPackageRoot,
    resolvePluginToolsEntrypoint: options.resolvePluginToolsEntrypoint,
    openclawCliExecutablePath: options.openclawCliExecutablePath,
  });
  context.lastSessionProbe = toSessionRuntimeProbeSnapshot(probeResult);
  if (!probeResult.ok) {
    driftItems.push({
      kind: "session_runtime_probe_failure",
      message:
        probeResult.failureReason ??
        "Session runtime probe failed without a detailed error.",
      repairable: true,
    });
  }
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

function hasSessionRuntimeUnknownOwnershipDrift(
  driftItems: readonly InstallerDriftItem[]
): boolean {
  return driftItems.some((item) => {
    if (item.kind !== "unknown_ownership") {
      return false;
    }
    return item.message.toLowerCase().includes("session runtime");
  });
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

function expectedOpenClawPluginEntrypointForRepoRoot(repoRoot: string): string {
  return path.resolve(repoRoot, "dist", "openclaw_plugin.js");
}

function expectedOpenClawPluginManifestPathForRepoRoot(repoRoot: string): string {
  return path.resolve(repoRoot, "openclaw.plugin.json");
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
  expectedOpenClawPluginEntrypointForRepoRoot,
  expectedOpenClawPluginManifestPathForRepoRoot,
  expectedServerEntrypointForRepoRoot,
  normalizeActualMcpConfig,
};
