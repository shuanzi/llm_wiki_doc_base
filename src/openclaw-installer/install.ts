import * as fs from "fs";
import * as path from "path";

import { KB_CANONICAL_TOOL_NAMES } from "../runtime/kb_tool_contract";
import { sha256 } from "../utils/hash";
import { checkOpenClawInstallation } from "./check";
import {
  bootstrapExternalKbRoot,
  validateMinimumKbStructure,
  type BootstrapExternalKbRootResult,
} from "./kb-bootstrap";
import {
  createInstallerManifest,
  readInstallerManifest,
  resolveInstallerManifestPath,
  validateInstallerManifest,
  writeInstallerManifest,
} from "./manifest";
import {
  assertAgentWorkspaceBinding,
  resolveAgentWorkspaceBinding,
} from "./llmwiki-binding";
import { probeKbMcpServer } from "./mcp-probe";
import {
  OpenClawCli,
  type OpenClawMcpServerDefinition,
} from "./openclaw-cli";
import {
  materializeSessionRuntimeArtifacts,
  renderSessionRuntimePluginIndex,
  renderSessionRuntimePluginManifest,
  resolveSessionRuntimeArtifactPaths,
} from "./session-runtime-artifact";
import {
  ensureSessionRuntimePluginConfig,
  restoreSessionRuntimePluginConfig,
  type SessionRuntimeConfigSnapshot,
} from "./session-runtime-config";
import {
  ensureSessionRuntimeAgentToolPolicy,
  removeSessionRuntimeAgentToolPolicy,
  restoreSessionRuntimeAgentToolPolicy,
  type SessionRuntimeAgentToolPolicySnapshot,
} from "./session-runtime-agent-policy";
import {
  probeSessionRuntimeSurface,
  toSessionRuntimeProbeSnapshot,
} from "./session-runtime-probe";
import { renderAllOpenClawSkills } from "./skills";
import { renderAllOpenClawWorkspaceDocs } from "./workspace-docs";
import { resolveExplicitWorkspacePath } from "./workspace";
import type {
  InstallCommandArgs,
  InstallerCheckResult,
  InstallerExpectedMcpConfig,
  InstallerManifest,
  ResolvedInstallerEnvironment,
} from "./types";
import {
  areExpectedMcpConfigsEqual,
  buildExpectedMcpConfig,
  normalizeActualMcpConfig,
} from "./check";

const REQUIRED_REPO_FILES = [
  "package.json",
  "openclaw.plugin.json",
  "src/mcp_server.ts",
  "src/openclaw_plugin.ts",
  "skills/kb_ingest/SKILL.md",
  "skills/kb_query/SKILL.md",
  "skills/kb_lint/SKILL.md",
] as const;

export interface InstallOpenClawIntegrationOptions {
  cli?: OpenClawCli;
  nodeCommand?: string;
  openclawPackageRoot?: string;
  resolvePluginToolsEntrypoint?: string;
  openclawCliExecutablePath?: string;
}

export interface InstallOpenClawIntegrationResult {
  checkResult: InstallerCheckResult;
  manifest: InstallerManifest;
  manifestPath: string;
}

interface RollbackState {
  createdKbRoot: boolean;
  createdKbFiles: string[];
  createdKbDirectories: string[];
  createdSkillFiles: string[];
  overwrittenSkillFiles: Array<{ filePath: string; content: string }>;
  createdSkillDirectories: string[];
  createdWorkspaceDocFiles: string[];
  overwrittenWorkspaceDocFiles: Array<{ filePath: string; content: string }>;
  createdSessionRuntimeFiles: string[];
  overwrittenSessionRuntimeFiles: Array<{ filePath: string; content: string }>;
  createdSessionRuntimeDirectories: string[];
  sessionRuntimePluginEnabledUpdated: boolean;
  previousSessionRuntimePluginConfig?: SessionRuntimeConfigSnapshot;
  sessionRuntimeAgentToolPolicyUpdated: boolean;
  previousSessionRuntimeAgentToolPolicy?: SessionRuntimeAgentToolPolicySnapshot;
  createdManifestPath?: string;
  overwrittenManifest?: { manifestPath: string; content: string };
  createdMcpRegistration: boolean;
  previousMcpRegistration?: OpenClawMcpServerDefinition;
  mcpName: string;
  mutated: boolean;
}

interface ConflictInspectionContext {
  existingMcp?: OpenClawMcpServerDefinition;
  existingManifest?: InstallerManifest;
}

export async function installOpenClawIntegration(
  args: InstallCommandArgs,
  environment: ResolvedInstallerEnvironment,
  options: InstallOpenClawIntegrationOptions = {}
): Promise<InstallOpenClawIntegrationResult> {
  const cli = options.cli ?? new OpenClawCli();
  const nodeCommand = options.nodeCommand ?? process.execPath;
  const openclawCliExecutablePath =
    options.openclawCliExecutablePath ?? cli.resolveExecutablePath();

  const repoRoot = path.resolve(environment.repoRoot);
  const mcpServerEntrypoint = path.resolve(environment.mcpServerEntrypoint);
  const openclawPluginEntrypoint = path.resolve(environment.openclawPluginEntrypoint);
  const openclawPluginManifestPath = path.resolve(environment.openclawPluginManifestPath);
  const kbRoot = path.resolve(args.kbRoot);

  const installEnvironment: ResolvedInstallerEnvironment = {
    ...environment,
    command: "install",
    mcpName: args.mcpName,
    workspace: path.resolve(args.workspace),
    kbRoot,
    repoRoot,
    mcpServerEntrypoint,
    openclawPluginEntrypoint,
    openclawPluginManifestPath,
    agentId: args.agentId,
  };

  validateRepositoryState(repoRoot);
  ensureBuildArtifactsExist([mcpServerEntrypoint, openclawPluginEntrypoint]);
  ensurePluginManifestExists(openclawPluginManifestPath);
  await ensureOpenClawCliReady(cli);

  const workspacePath = resolveExplicitWorkspacePath(args.workspace);
  installEnvironment.workspace = workspacePath;
  assertAgentWorkspaceBinding(
    await resolveAgentWorkspaceBinding({
      cli,
      agentId: args.agentId,
      workspacePath,
    })
  );

  const rollback: RollbackState = {
    createdKbRoot: false,
    createdKbFiles: [],
    createdKbDirectories: [],
    createdSkillFiles: [],
    overwrittenSkillFiles: [],
    createdSkillDirectories: [],
    createdWorkspaceDocFiles: [],
    overwrittenWorkspaceDocFiles: [],
    createdSessionRuntimeFiles: [],
    overwrittenSessionRuntimeFiles: [],
    createdSessionRuntimeDirectories: [],
    sessionRuntimePluginEnabledUpdated: false,
    sessionRuntimeAgentToolPolicyUpdated: false,
    createdMcpRegistration: false,
    mcpName: args.mcpName,
    mutated: false,
  };

  try {
    const kbRootExistedBefore = fs.existsSync(kbRoot);
    if (kbRootExistedBefore) {
      const kbValidation = validateMinimumKbStructure(kbRoot);
      if (!kbValidation.ok && !args.force) {
        throw new Error(
          `Existing KB_ROOT failed validation (install fails closed): ${formatKbValidationFailure(
            kbValidation
          )}`
        );
      }
    }

    if (!kbRootExistedBefore || args.force) {
      const bootstrapResult = bootstrapExternalKbRoot({
        repoRoot,
        kbRoot,
      });
      trackBootstrapRollback(rollback, kbRoot, bootstrapResult, !kbRootExistedBefore);
    }

    const expectedMcpConfig = buildExpectedMcpConfig({
      mcpName: args.mcpName,
      serverEntrypoint: mcpServerEntrypoint,
      kbRoot,
      nodeCommand,
    });

    const conflictContext = await inspectConflicts({
      cli,
      expectedMcpConfig,
      workspacePath,
      repoRoot,
      kbRoot,
      mcpName: args.mcpName,
      agentId: args.agentId,
      force: args.force,
    });

    const renderedSkills = renderAllOpenClawSkills(repoRoot);
    const renderedWorkspaceDocs = renderAllOpenClawWorkspaceDocs();
    inspectSkillConflicts({
      workspacePath,
      renderedSkills,
      existingManifest: conflictContext.existingManifest,
      force: args.force,
    });
    assertSessionRuntimeOwnershipForInstall({
      workspacePath,
      kbRoot,
      existingManifest: conflictContext.existingManifest,
      sourcePluginEntrypoint: openclawPluginEntrypoint,
      sourcePluginManifestPath: openclawPluginManifestPath,
      agentId: args.agentId,
      force: args.force,
    });

    const installedAt = new Date().toISOString();
    const installedSkills = writeRenderedSkills({
      workspacePath,
      renderedSkills,
      installedAt,
      rollback,
    });
    const installedWorkspaceDocs = writeRenderedWorkspaceDocs({
      workspacePath,
      renderedWorkspaceDocs,
      installedAt,
      rollback,
    });

    const sessionRuntime = materializeSessionRuntimeWithRollback({
      workspacePath,
      kbRoot,
      agentId: args.agentId,
      sourcePluginEntrypoint: openclawPluginEntrypoint,
      sourcePluginManifestPath: openclawPluginManifestPath,
      installedAt,
      rollback,
    });

    await enableSessionRuntimePluginWithRollback({
      cli,
      pluginRoot: sessionRuntime.metadata.pluginRoot,
      rollback,
    });
    await enableSessionRuntimeAgentToolPolicyWithRollback({
      cli,
      agentId: args.agentId,
      workspacePath,
      rollback,
    });
    await removeRetargetedSessionRuntimeAgentToolPolicyWithRollback({
      cli,
      previousAgentId: conflictContext.existingManifest?.sessionRuntime?.agentId,
      nextAgentId: args.agentId,
      workspacePath,
      rollback,
    });

    const sessionProbeResult = await probeSessionRuntimeSurface({
      sessionRuntime: sessionRuntime.metadata,
      invocationKbRoot: kbRoot,
      expectedToolNames: KB_CANONICAL_TOOL_NAMES,
      openclawPackageRoot: options.openclawPackageRoot,
      resolvePluginToolsEntrypoint: options.resolvePluginToolsEntrypoint,
      openclawCliExecutablePath,
    });
    if (!sessionProbeResult.ok) {
      throw new Error(
        `Post-install session runtime probe failed: ${
          sessionProbeResult.failureReason ?? "unknown session runtime probe failure"
        }`
      );
    }

    await cli.setMcpServer(args.mcpName, {
      command: expectedMcpConfig.command,
      args: expectedMcpConfig.args,
      env: expectedMcpConfig.env,
    });
    rollback.mutated = true;
    rollback.createdMcpRegistration = conflictContext.existingMcp === undefined;
    rollback.previousMcpRegistration = conflictContext.existingMcp;

    const probeResult = await probeKbMcpServer({
      serverEntrypoint: mcpServerEntrypoint,
      kbRoot,
      nodeCommand,
    });

    if (!probeResult.ok) {
      throw new Error(
        `Post-install active MCP probe failed: ${
          probeResult.failureReason ?? "unknown probe failure"
        }`
      );
    }

    const manifest = createInstallerManifest({
      installerVersion: readInstallerVersion(repoRoot),
      repoRoot,
      workspacePath,
      kbRoot,
      mcpName: args.mcpName,
      installedAt,
      installedSkills,
      installedWorkspaceDocs,
      sessionRuntime: sessionRuntime.metadata,
      expectedMcpConfig,
      lastSuccessfulProbe: {
        checkedAt: probeResult.checkedAt,
        ok: true,
        toolNames: probeResult.toolNames,
      },
      lastSuccessfulSessionProbe: toSessionRuntimeProbeSnapshot(sessionProbeResult),
    });

    const manifestPath = resolveInstallerManifestPath(workspacePath);
    const manifestPreviouslyExisted = fs.existsSync(manifestPath);
    if (manifestPreviouslyExisted) {
      if (!fs.statSync(manifestPath).isFile()) {
        throw new Error(`Conflict: installer manifest path is not a file: ${manifestPath}`);
      }
      rollback.overwrittenManifest = {
        manifestPath,
        content: fs.readFileSync(manifestPath, "utf8"),
      };
    }
    writeInstallerManifest(workspacePath, manifest);
    rollback.mutated = true;
    if (!manifestPreviouslyExisted) {
      rollback.createdManifestPath = manifestPath;
    }

    const checkResult = await checkOpenClawInstallation({
      environment: installEnvironment,
      requestedWorkspace: workspacePath,
      mcpName: args.mcpName,
      cli,
      nodeCommand,
      openclawPackageRoot: options.openclawPackageRoot,
      resolvePluginToolsEntrypoint: options.resolvePluginToolsEntrypoint,
      openclawCliExecutablePath,
    });

    if (!checkResult.ok) {
      throw new Error(
        `Post-install check detected drift: ${formatDriftSummary(checkResult)}`
      );
    }

    return {
      checkResult,
      manifest,
      manifestPath,
    };
  } catch (error) {
    if (rollback.mutated) {
      const rollbackErrors = await rollbackCreatedArtifacts(
        cli,
        workspacePath,
        kbRoot,
        rollback
      );
      if (rollbackErrors.length > 0) {
        throw buildInstallRollbackError(error, rollbackErrors);
      }
    }
    throw error;
  }
}

function validateRepositoryState(repoRoot: string): void {
  for (const relativePath of REQUIRED_REPO_FILES) {
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Repository validation failed: missing ${relativePath}`);
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Repository validation failed: expected file at ${relativePath}`);
    }
  }
}

function ensureBuildArtifactsExist(artifactPaths: readonly string[]): void {
  for (const artifactPath of artifactPaths) {
    if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
      throw new Error(
        `Missing build artifact: ${artifactPath}. Run npm run build before install.`
      );
    }
  }
}

function ensurePluginManifestExists(pluginManifestPath: string): void {
  if (!fs.existsSync(pluginManifestPath) || !fs.statSync(pluginManifestPath).isFile()) {
    throw new Error(`Missing OpenClaw plugin manifest: ${pluginManifestPath}.`);
  }
}

async function ensureOpenClawCliReady(cli: OpenClawCli): Promise<void> {
  try {
    await cli.getConfigFilePath();
  } catch (error) {
    throw new Error(`OpenClaw CLI is missing or invalid: ${stringifyError(error)}`);
  }
}

function trackBootstrapRollback(
  rollback: RollbackState,
  kbRoot: string,
  bootstrapResult: BootstrapExternalKbRootResult,
  kbRootCreatedByRun: boolean
): void {
  rollback.createdKbRoot = kbRootCreatedByRun;

  for (const relativePath of bootstrapResult.createdFiles) {
    rollback.createdKbFiles.push(path.resolve(kbRoot, relativePath));
  }

  for (const relativePath of bootstrapResult.createdDirectories) {
    rollback.createdKbDirectories.push(path.resolve(kbRoot, relativePath));
  }

  if (bootstrapResult.createdFiles.length > 0 || bootstrapResult.createdDirectories.length > 0) {
    rollback.mutated = true;
  }
}

async function inspectConflicts(options: {
  cli: OpenClawCli;
  expectedMcpConfig: InstallerExpectedMcpConfig;
  workspacePath: string;
  repoRoot: string;
  kbRoot: string;
  mcpName: string;
  agentId: string;
  force: boolean;
}): Promise<ConflictInspectionContext> {
  const context: ConflictInspectionContext = {};

  const existingManifest = readInstallerManifest(options.workspacePath, {
    allowMissing: true,
  });
  context.existingManifest = existingManifest;

  if (existingManifest) {
    const ownershipMismatch =
      path.resolve(existingManifest.repoRoot) !== path.resolve(options.repoRoot) ||
      path.resolve(existingManifest.workspacePath) !== path.resolve(options.workspacePath) ||
      path.resolve(existingManifest.kbRoot) !== path.resolve(options.kbRoot);

    if (ownershipMismatch && !options.force) {
      throw new Error(
        `Conflict: installer manifest ownership differs from requested install target at ${resolveInstallerManifestPath(
          options.workspacePath
        )}. Use --force to override installer-owned metadata.`
      );
    }

    const manifestValidation = validateInstallerManifest(existingManifest, {
      repoRoot: options.repoRoot,
      workspacePath: options.workspacePath,
      kbRoot: options.kbRoot,
      mcpName: options.mcpName,
      agentId: options.agentId,
      expectedMcpConfig: options.expectedMcpConfig,
    });

    if (manifestValidation.status === "unknown_ownership" && !options.force) {
      throw new Error(
        `Conflict: existing manifest has unknown ownership. ${formatDriftMessages(
          manifestValidation.driftItems
        )}`
      );
    }
  }

  const existingMcp = await options.cli.showMcpServer(options.mcpName);
  context.existingMcp = existingMcp;

  if (!existingMcp) {
    return context;
  }

  const normalizedExistingMcp = normalizeActualMcpConfig(options.mcpName, existingMcp);
  const matchesExpected =
    normalizedExistingMcp !== undefined &&
    areExpectedMcpConfigsEqual(options.expectedMcpConfig, normalizedExistingMcp);

  if (!matchesExpected && !options.force) {
    throw new Error(
      `Conflict: existing OpenClaw MCP server "${options.mcpName}" has different config. Use --force to override.`
    );
  }

  return context;
}

function inspectSkillConflicts(options: {
  workspacePath: string;
  renderedSkills: Array<{
    skillName: string;
    installRelativeDir: string;
    installRelativeFile: string;
    contentHash: string;
  }>;
  existingManifest?: InstallerManifest;
  force: boolean;
}): void {
  for (const renderedSkill of options.renderedSkills) {
    const installDir = path.resolve(options.workspacePath, renderedSkill.installRelativeDir);
    const skillFile = path.resolve(options.workspacePath, renderedSkill.installRelativeFile);
    const ownedByManifest = isSkillOwnedByManifest(
      options.existingManifest,
      renderedSkill.skillName,
      installDir,
      skillFile
    );

    if (fs.existsSync(installDir) && !fs.statSync(installDir).isDirectory()) {
      throw new Error(
        `Conflict: skill target path exists but is not a directory: ${installDir}`
      );
    }

    if (!fs.existsSync(installDir)) {
      continue;
    }

    if (!ownedByManifest && !options.force) {
      throw new Error(
        `Conflict: skill ${renderedSkill.skillName} already exists but is not installer-owned by manifest. Use --force to overwrite.`
      );
    }

    if (!fs.existsSync(skillFile)) {
      continue;
    }

    if (!fs.statSync(skillFile).isFile()) {
      throw new Error(`Conflict: skill file path is not a file: ${skillFile}`);
    }

    const existingHash = sha256(fs.readFileSync(skillFile, "utf8"));
    if (ownedByManifest && existingHash !== renderedSkill.contentHash && !options.force) {
      throw new Error(
        `Conflict: skill ${renderedSkill.skillName} already exists with non-installer content. Use --force to overwrite.`
      );
    }
  }
}

function writeRenderedSkills(options: {
  workspacePath: string;
  renderedSkills: Array<{
    skillName: string;
    sourceRelativePath: string;
    sourceContentHash: string;
    installRelativeDir: string;
    installRelativeFile: string;
    content: string;
    contentHash: string;
  }>;
  installedAt: string;
  rollback: RollbackState;
}): InstallerManifest["installedSkills"] {
  const installedSkills: InstallerManifest["installedSkills"] = [];

  for (const renderedSkill of options.renderedSkills) {
    const installDir = path.resolve(options.workspacePath, renderedSkill.installRelativeDir);
    const installFile = path.resolve(options.workspacePath, renderedSkill.installRelativeFile);

    const installDirAlreadyExisted = fs.existsSync(installDir);
    const installFileAlreadyExisted = fs.existsSync(installFile);
    let previousSkillContent: string | undefined;

    if (installFileAlreadyExisted) {
      if (!fs.statSync(installFile).isFile()) {
        throw new Error(`Skill file path is not a regular file: ${installFile}`);
      }
      previousSkillContent = fs.readFileSync(installFile, "utf8");
    }

    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(installFile, renderedSkill.content, "utf8");

    options.rollback.mutated = true;
    if (!installDirAlreadyExisted) {
      options.rollback.createdSkillDirectories.push(installDir);
    }
    if (!installFileAlreadyExisted) {
      options.rollback.createdSkillFiles.push(installFile);
    } else if (previousSkillContent !== undefined) {
      options.rollback.overwrittenSkillFiles.push({
        filePath: installFile,
        content: previousSkillContent,
      });
    }

    installedSkills.push({
      skillName: renderedSkill.skillName,
      installDir,
      skillFile: installFile,
      contentHash: renderedSkill.contentHash,
      installedAt: options.installedAt,
      variantSet: "openclaw-adapted-v1",
      sourceProvenance: {
        sourceKind: "repo-skill-template",
        sourceSkillName: renderedSkill.skillName,
        sourceRelativePath: renderedSkill.sourceRelativePath,
        sourceContentHash: renderedSkill.sourceContentHash,
      },
    });
  }

  installedSkills.sort((left, right) => left.skillName.localeCompare(right.skillName));
  return installedSkills;
}

function writeRenderedWorkspaceDocs(options: {
  workspacePath: string;
  renderedWorkspaceDocs: Array<{
    docName: InstallerManifest["installedWorkspaceDocs"][number]["docName"];
    installRelativeFile: string;
    content: string;
    contentHash: string;
  }>;
  installedAt: string;
  rollback: RollbackState;
}): InstallerManifest["installedWorkspaceDocs"] {
  const installedWorkspaceDocs: InstallerManifest["installedWorkspaceDocs"] = [];
  assertWorkspaceRootSafeForDocs(options.workspacePath);

  for (const renderedDoc of options.renderedWorkspaceDocs) {
    const docFile = path.resolve(options.workspacePath, renderedDoc.installRelativeFile);

    const docFileAlreadyExisted = fs.existsSync(docFile);
    let previousDocContent: string | undefined;

    if (docFileAlreadyExisted) {
      const existingDocStat = fs.lstatSync(docFile);
      if (existingDocStat.isSymbolicLink()) {
        throw new Error(`Workspace doc path must not be a symlink: ${docFile}`);
      }
      if (!existingDocStat.isFile()) {
        throw new Error(`Workspace doc path is not a regular file: ${docFile}`);
      }
      previousDocContent = fs.readFileSync(docFile, "utf8");
    }

    fs.writeFileSync(docFile, renderedDoc.content, "utf8");

    options.rollback.mutated = true;
    if (!docFileAlreadyExisted) {
      options.rollback.createdWorkspaceDocFiles.push(docFile);
    } else if (previousDocContent !== undefined) {
      options.rollback.overwrittenWorkspaceDocFiles.push({
        filePath: docFile,
        content: previousDocContent,
      });
    }

    installedWorkspaceDocs.push({
      docName: renderedDoc.docName,
      docFile,
      contentHash: renderedDoc.contentHash,
      installedAt: options.installedAt,
      preinstallSnapshot:
        previousDocContent === undefined
          ? {
              known: true,
              existed: false,
            }
          : {
              known: true,
              existed: true,
              content: previousDocContent,
              contentHash: sha256(previousDocContent),
            },
    });
  }

  installedWorkspaceDocs.sort((left, right) =>
    left.docName.localeCompare(right.docName)
  );
  return installedWorkspaceDocs;
}

function assertWorkspaceRootSafeForDocs(workspacePath: string): void {
  if (!fs.existsSync(workspacePath)) {
    return;
  }

  const workspaceLstat = fs.lstatSync(workspacePath);
  if (workspaceLstat.isSymbolicLink()) {
    throw new Error(
      `Workspace root must not be a symlink for installer-managed workspace docs: ${workspacePath}`
    );
  }
}

function assertSessionRuntimeOwnershipForInstall(options: {
  workspacePath: string;
  kbRoot: string;
  agentId: string;
  existingManifest?: InstallerManifest;
  sourcePluginEntrypoint: string;
  sourcePluginManifestPath: string;
  force: boolean;
}): void {
  if (options.existingManifest?.sessionRuntime) {
    if (
      options.existingManifest.sessionRuntime.agentId !== options.agentId &&
      !options.force
    ) {
      throw new Error(
        `Conflict: installer manifest is owned by agent "${options.existingManifest.sessionRuntime.agentId}", not requested agent "${options.agentId}". Use --force to override installer-owned metadata.`
      );
    }
    return;
  }

  const expectedPaths = resolveSessionRuntimeArtifactPaths(options.workspacePath);
  const pluginRootExists = fs.existsSync(expectedPaths.pluginRoot);
  const pluginIndexExists = fs.existsSync(expectedPaths.pluginIndexFile);
  const pluginManifestExists = fs.existsSync(expectedPaths.pluginManifestFile);

  if (!pluginRootExists && !pluginIndexExists && !pluginManifestExists) {
    return;
  }

  const expectedIndexHash = renderSessionRuntimePluginIndex({
    sourcePluginEntrypoint: options.sourcePluginEntrypoint,
    kbRoot: options.kbRoot,
  }).contentHash;
  const expectedManifestHash = renderSessionRuntimePluginManifest({
    sourcePluginManifestPath: options.sourcePluginManifestPath,
    canonicalToolNames: KB_CANONICAL_TOOL_NAMES,
  }).contentHash;

  const exactMatch =
    isRegularFileWithHash(expectedPaths.pluginIndexFile, expectedIndexHash) &&
    isRegularFileWithHash(expectedPaths.pluginManifestFile, expectedManifestHash) &&
    isInstallerOwnedSessionRuntimeDirectory(expectedPaths.pluginRoot);

  if (!exactMatch && !options.force) {
    throw new Error(
      [
        "Conflict: session runtime shim already exists but installer ownership is uncertain.",
        `expected root: ${expectedPaths.pluginRoot}`,
        "Use --force only after verifying the workspace-local session runtime shim is installer-owned.",
      ].join(" ")
    );
  }
}

function materializeSessionRuntimeWithRollback(options: {
  workspacePath: string;
  kbRoot: string;
  agentId: string;
  sourcePluginEntrypoint: string;
  sourcePluginManifestPath: string;
  installedAt: string;
  rollback: RollbackState;
}): ReturnType<typeof materializeSessionRuntimeArtifacts> {
  const expectedPaths = resolveSessionRuntimeArtifactPaths(options.workspacePath);
  const previousContentByPath = new Map<string, string>();
  for (const candidatePath of [expectedPaths.pluginIndexFile, expectedPaths.pluginManifestFile]) {
    if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
      continue;
    }
    previousContentByPath.set(candidatePath, fs.readFileSync(candidatePath, "utf8"));
  }

  const materialization = materializeSessionRuntimeArtifacts({
    workspacePath: options.workspacePath,
    kbRoot: options.kbRoot,
    agentId: options.agentId,
    sourcePluginEntrypoint: options.sourcePluginEntrypoint,
    sourcePluginManifestPath: options.sourcePluginManifestPath,
    canonicalToolNames: KB_CANONICAL_TOOL_NAMES,
    installedAt: options.installedAt,
  });

  for (const createdFile of materialization.createdFiles) {
    options.rollback.createdSessionRuntimeFiles.push(path.resolve(createdFile));
  }

  for (const overwrittenFile of materialization.overwrittenFiles) {
    const restoredContent = previousContentByPath.get(path.resolve(overwrittenFile));
    if (restoredContent === undefined) {
      continue;
    }
    options.rollback.overwrittenSessionRuntimeFiles.push({
      filePath: path.resolve(overwrittenFile),
      content: restoredContent,
    });
  }

  for (const createdDirectory of materialization.createdDirectories) {
    options.rollback.createdSessionRuntimeDirectories.push(path.resolve(createdDirectory));
  }

  if (
    materialization.createdFiles.length > 0 ||
    materialization.overwrittenFiles.length > 0 ||
    materialization.createdDirectories.length > 0
  ) {
    options.rollback.mutated = true;
  }

  return materialization;
}

async function enableSessionRuntimePluginWithRollback(options: {
  cli: OpenClawCli;
  pluginRoot: string;
  rollback: RollbackState;
}): Promise<void> {
  const result = await ensureSessionRuntimePluginConfig({
    cli: options.cli,
    pluginRoot: options.pluginRoot,
  });
  options.rollback.previousSessionRuntimePluginConfig = result.previous;

  if (result.changed) {
    options.rollback.sessionRuntimePluginEnabledUpdated = true;
    options.rollback.mutated = true;
  }
}

async function enableSessionRuntimeAgentToolPolicyWithRollback(options: {
  cli: OpenClawCli;
  agentId: string;
  workspacePath: string;
  rollback: RollbackState;
}): Promise<void> {
  const result = await ensureSessionRuntimeAgentToolPolicy({
    cli: options.cli,
    agentId: options.agentId,
    workspacePath: options.workspacePath,
  });
  options.rollback.previousSessionRuntimeAgentToolPolicy = result.previous;

  if (result.changed) {
    options.rollback.sessionRuntimeAgentToolPolicyUpdated = true;
    options.rollback.mutated = true;
  }
}

async function removeRetargetedSessionRuntimeAgentToolPolicyWithRollback(options: {
  cli: OpenClawCli;
  previousAgentId?: string;
  nextAgentId: string;
  workspacePath: string;
  rollback: RollbackState;
}): Promise<void> {
  if (
    !options.previousAgentId ||
    options.previousAgentId === options.nextAgentId
  ) {
    return;
  }

  const changed = await removeSessionRuntimeAgentToolPolicy({
    cli: options.cli,
    agentId: options.previousAgentId,
    workspacePath: options.workspacePath,
    allowMissingTarget: true,
    matchAgentIdOnly: true,
  });
  if (!changed) {
    return;
  }

  options.rollback.sessionRuntimeAgentToolPolicyUpdated = true;
  options.rollback.mutated = true;
}

async function rollbackCreatedArtifacts(
  cli: OpenClawCli,
  workspacePath: string,
  kbRoot: string,
  rollback: RollbackState
): Promise<string[]> {
  const rollbackErrors: string[] = [];

  for (const overwrittenSkillFile of rollback.overwrittenSkillFiles) {
    fs.mkdirSync(path.dirname(overwrittenSkillFile.filePath), { recursive: true });
    fs.writeFileSync(overwrittenSkillFile.filePath, overwrittenSkillFile.content, "utf8");
  }
  for (const overwrittenWorkspaceDoc of rollback.overwrittenWorkspaceDocFiles) {
    fs.mkdirSync(path.dirname(overwrittenWorkspaceDoc.filePath), { recursive: true });
    fs.writeFileSync(overwrittenWorkspaceDoc.filePath, overwrittenWorkspaceDoc.content, "utf8");
  }
  for (const overwrittenSessionRuntimeFile of rollback.overwrittenSessionRuntimeFiles) {
    fs.mkdirSync(path.dirname(overwrittenSessionRuntimeFile.filePath), {
      recursive: true,
    });
    fs.writeFileSync(
      overwrittenSessionRuntimeFile.filePath,
      overwrittenSessionRuntimeFile.content,
      "utf8"
    );
  }

  for (const filePath of rollback.createdSkillFiles) {
    removeFileIfExists(filePath);
  }
  for (const filePath of rollback.createdWorkspaceDocFiles) {
    removeFileIfExists(filePath);
  }
  for (const filePath of rollback.createdSessionRuntimeFiles) {
    removeFileIfExists(filePath);
  }

  for (const filePath of rollback.createdKbFiles) {
    removeFileIfExists(filePath);
  }

  if (rollback.createdManifestPath) {
    removeFileIfExists(rollback.createdManifestPath);
  }
  if (rollback.overwrittenManifest) {
    fs.mkdirSync(path.dirname(rollback.overwrittenManifest.manifestPath), {
      recursive: true,
    });
    fs.writeFileSync(
      rollback.overwrittenManifest.manifestPath,
      rollback.overwrittenManifest.content,
      "utf8"
    );
  }

  if (rollback.previousMcpRegistration) {
    try {
      await cli.setMcpServer(rollback.mcpName, rollback.previousMcpRegistration);
    } catch (error) {
      rollbackErrors.push(
        `failed to restore MCP registration "${rollback.mcpName}": ${stringifyError(error)}`
      );
    }
  } else if (rollback.createdMcpRegistration) {
    try {
      await cli.unsetMcpServer(rollback.mcpName);
    } catch (error) {
      rollbackErrors.push(
        `failed to remove MCP registration "${rollback.mcpName}": ${stringifyError(error)}`
      );
    }
  }

  if (rollback.sessionRuntimePluginEnabledUpdated) {
    try {
      await restoreSessionRuntimePluginConfig({
        cli,
        previous: rollback.previousSessionRuntimePluginConfig ?? {
          enabled: undefined,
          allow: undefined,
          loadPaths: undefined,
        },
      });
    } catch (error) {
      rollbackErrors.push(
        `failed to restore OpenClaw session runtime plugin config: ${stringifyError(error)}`
      );
    }
  }

  if (rollback.sessionRuntimeAgentToolPolicyUpdated) {
    try {
      await restoreSessionRuntimeAgentToolPolicy({
        cli,
        previous: rollback.previousSessionRuntimeAgentToolPolicy ?? {
          agentsList: undefined,
        },
      });
    } catch (error) {
      rollbackErrors.push(
        `failed to restore OpenClaw agent tool policy: ${stringifyError(error)}`
      );
    }
  }

  for (const directoryPath of dedupePathsDescending(rollback.createdSkillDirectories)) {
    removeDirectoryIfEmpty(directoryPath);
  }

  for (const directoryPath of dedupePathsDescending(rollback.createdSessionRuntimeDirectories)) {
    removeDirectoryIfEmpty(directoryPath);
  }

  for (const directoryPath of dedupePathsDescending(rollback.createdKbDirectories)) {
    removeDirectoryIfEmpty(directoryPath);
  }

  if (rollback.createdManifestPath) {
    removeDirectoryIfEmpty(path.dirname(rollback.createdManifestPath));
  }

  if (rollback.createdKbRoot) {
    removeDirectoryIfEmpty(path.resolve(kbRoot));
  }

  return rollbackErrors;
}

function readInstallerVersion(repoRoot: string): string {
  const packageJsonPath = path.resolve(repoRoot, "package.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version
      ? parsed.version
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function removeFileIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  if (!fs.statSync(filePath).isFile()) {
    return;
  }

  fs.unlinkSync(filePath);
}

function removeDirectoryIfEmpty(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    return;
  }

  if (fs.readdirSync(directoryPath).length > 0) {
    return;
  }

  fs.rmdirSync(directoryPath);
}

function dedupePathsDescending(paths: readonly string[]): string[] {
  return [...new Set(paths)]
    .map((candidatePath) => path.resolve(candidatePath))
    .sort((left, right) => right.length - left.length);
}

function isRegularFileWithHash(filePath: string, expectedHash: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const fileLstat = fs.lstatSync(filePath);
  if (fileLstat.isSymbolicLink() || !fileLstat.isFile()) {
    return false;
  }

  return sha256(fs.readFileSync(filePath, "utf8")) === expectedHash;
}

function isInstallerOwnedSessionRuntimeDirectory(pluginRoot: string): boolean {
  if (!fs.existsSync(pluginRoot)) {
    return false;
  }

  const pluginRootLstat = fs.lstatSync(pluginRoot);
  if (pluginRootLstat.isSymbolicLink() || !pluginRootLstat.isDirectory()) {
    return false;
  }

  const entries = fs.readdirSync(pluginRoot).sort((left, right) =>
    left.localeCompare(right)
  );
  return (
    entries.length === 2 &&
    entries[0] === "index.ts" &&
    entries[1] === "openclaw.plugin.json"
  );
}

function formatDriftSummary(checkResult: InstallerCheckResult): string {
  return checkResult.driftItems
    .map((item) => `[${item.kind}] ${item.message}`)
    .join(" | ");
}

function formatDriftMessages(items: readonly { message: string }[]): string {
  return items.map((item) => item.message).join(" | ");
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildInstallRollbackError(
  originalError: unknown,
  rollbackErrors: readonly string[]
): Error {
  const originalMessage = stringifyError(originalError);
  const message = [
    `Install failed: ${originalMessage}`,
    `Rollback also failed: ${rollbackErrors.join(" | ")}`,
  ].join(" ");

  if (originalError instanceof Error) {
    return new Error(message, { cause: originalError });
  }

  return new Error(message);
}

function formatKbValidationFailure(validation: {
  kbRoot: string;
  missingDirectories: string[];
  missingFiles: string[];
  invalidPaths: string[];
}): string {
  return [
    validation.kbRoot,
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
    .filter((entry): entry is string => Boolean(entry))
    .join(" | ");
}

function isSkillOwnedByManifest(
  manifest: InstallerManifest | undefined,
  skillName: string,
  installDir: string,
  skillFile: string
): boolean {
  if (!manifest) {
    return false;
  }

  return manifest.installedSkills.some((installedSkill) => {
    return (
      installedSkill.skillName === skillName &&
      path.resolve(installedSkill.installDir) === path.resolve(installDir) &&
      path.resolve(installedSkill.skillFile) === path.resolve(skillFile)
    );
  });
}
