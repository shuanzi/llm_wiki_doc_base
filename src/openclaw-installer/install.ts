import * as fs from "fs";
import * as path from "path";

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
import { probeKbMcpServer } from "./mcp-probe";
import {
  OpenClawCli,
  type OpenClawMcpServerDefinition,
} from "./openclaw-cli";
import { renderAllOpenClawSkills } from "./skills";
import {
  OpenClawWorkspaceResolutionError,
  resolveOpenClawWorkspace,
} from "./workspace";
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
  "src/mcp_server.ts",
  "skills/kb_ingest/SKILL.md",
  "skills/kb_query/SKILL.md",
  "skills/kb_lint/SKILL.md",
] as const;

export interface InstallOpenClawIntegrationOptions {
  cli?: OpenClawCli;
  nodeCommand?: string;
}

export interface InstallOpenClawIntegrationResult {
  checkResult: InstallerCheckResult;
  manifest: InstallerManifest;
  manifestPath: string;
}

interface RollbackState {
  workspaceCreated: boolean;
  createdWorkspacePath?: string;
  createdKbRoot: boolean;
  createdKbFiles: string[];
  createdKbDirectories: string[];
  createdSkillFiles: string[];
  overwrittenSkillFiles: Array<{ filePath: string; content: string }>;
  createdSkillDirectories: string[];
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

  const repoRoot = path.resolve(environment.repoRoot);
  const mcpServerEntrypoint = path.resolve(environment.mcpServerEntrypoint);
  const kbRoot = path.resolve(args.kbRoot);

  const installEnvironment: ResolvedInstallerEnvironment = {
    ...environment,
    command: "install",
    mcpName: args.mcpName,
    workspace: path.resolve(args.workspace),
    kbRoot,
    repoRoot,
    mcpServerEntrypoint,
  };

  validateRepositoryState(repoRoot);
  ensureBuildArtifactExists(mcpServerEntrypoint);
  await ensureOpenClawCliReady(cli);

  const workspacePath = await resolveAndValidateWorkspace(cli, args.workspace);
  installEnvironment.workspace = workspacePath;

  const rollback: RollbackState = {
    workspaceCreated: false,
    createdKbRoot: false,
    createdKbFiles: [],
    createdKbDirectories: [],
    createdSkillFiles: [],
    overwrittenSkillFiles: [],
    createdSkillDirectories: [],
    createdMcpRegistration: false,
    mcpName: args.mcpName,
    mutated: false,
  };

  try {
    ensureWorkspaceDirectory(workspacePath, rollback);

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
      force: args.force,
    });

    const renderedSkills = renderAllOpenClawSkills(repoRoot);
    inspectSkillConflicts({
      workspacePath,
      renderedSkills,
      existingManifest: conflictContext.existingManifest,
      force: args.force,
    });

    const installedAt = new Date().toISOString();
    const installedSkills = writeRenderedSkills({
      workspacePath,
      renderedSkills,
      installedAt,
      rollback,
    });

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
      expectedMcpConfig,
      lastSuccessfulProbe: {
        checkedAt: probeResult.checkedAt,
        ok: true,
        toolNames: probeResult.toolNames,
      },
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

function ensureBuildArtifactExists(mcpServerEntrypoint: string): void {
  if (!fs.existsSync(mcpServerEntrypoint) || !fs.statSync(mcpServerEntrypoint).isFile()) {
    throw new Error(
      `Missing build artifact: ${mcpServerEntrypoint}. Run npm run build before install.`
    );
  }
}

async function ensureOpenClawCliReady(cli: OpenClawCli): Promise<void> {
  try {
    await cli.getConfigFilePath();
  } catch (error) {
    throw new Error(`OpenClaw CLI is missing or invalid: ${stringifyError(error)}`);
  }
}

async function resolveAndValidateWorkspace(
  cli: OpenClawCli,
  requestedWorkspace: string
): Promise<string> {
  try {
    const resolved = await resolveOpenClawWorkspace({
      cli,
      requestedWorkspace,
      requireExistingDirectory: false,
    });

    return resolved.resolvedWorkspace;
  } catch (error) {
    if (error instanceof OpenClawWorkspaceResolutionError) {
      throw new Error(error.message);
    }
    throw error;
  }
}

function ensureWorkspaceDirectory(workspacePath: string, rollback: RollbackState): void {
  if (fs.existsSync(workspacePath)) {
    const stat = fs.statSync(workspacePath);
    if (!stat.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${workspacePath}`);
    }
    return;
  }

  fs.mkdirSync(workspacePath, { recursive: true });
  rollback.workspaceCreated = true;
  rollback.createdWorkspacePath = workspacePath;
  rollback.mutated = true;
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

  for (const filePath of rollback.createdSkillFiles) {
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

  for (const directoryPath of dedupePathsDescending(rollback.createdSkillDirectories)) {
    removeDirectoryIfEmpty(directoryPath);
  }

  for (const directoryPath of dedupePathsDescending(rollback.createdKbDirectories)) {
    removeDirectoryIfEmpty(directoryPath);
  }

  if (rollback.createdManifestPath) {
    removeDirectoryIfEmpty(path.dirname(rollback.createdManifestPath));
  }

  if (rollback.workspaceCreated && rollback.createdWorkspacePath) {
    removeDirectoryIfEmpty(rollback.createdWorkspacePath);
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
