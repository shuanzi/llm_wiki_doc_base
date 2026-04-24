import * as fs from "fs";
import * as path from "path";

import { sha256 } from "../utils/hash";
import {
  renderSessionRuntimePluginIndex,
  renderSessionRuntimePluginManifest,
  resolveSessionRuntimeArtifactPaths,
} from "./session-runtime-artifact";
import {
  assertCanRemoveSessionRuntimeAgentToolPolicy,
  removeSessionRuntimeAgentToolPolicy,
} from "./session-runtime-agent-policy";
import { removeSessionRuntimePluginConfig } from "./session-runtime-config";
import {
  areExpectedMcpConfigsEqual,
  normalizeActualMcpConfig,
} from "./check";
import {
  readInstallerManifest,
  resolveInstallerManifestPath,
  validateInstallerManifest,
} from "./manifest";
import {
  assertAgentWorkspaceBinding,
  resolveAgentWorkspaceBinding,
} from "./llmwiki-binding";
import { OpenClawCli } from "./openclaw-cli";
import { OPENCLAW_SKILL_NAMES } from "./skills";
import { renderOpenClawWorkspaceDoc } from "./workspace-docs";
import {
  INSTALLER_WORKSPACE_DOC_NAMES,
  type InstallerWorkspaceDocName,
  type ResolvedInstallerEnvironment,
  type UninstallCommandArgs,
} from "./types";
import { resolveExplicitWorkspacePath } from "./workspace";

export interface UninstallOpenClawIntegrationOptions {
  cli?: OpenClawCli;
}

export interface UninstallOpenClawIntegrationResult {
  workspacePath: string;
  manifestPath: string;
  removedMcpRegistration: boolean;
  removedManifest: boolean;
  removedSkillDirectories: string[];
}

interface PlannedSkillRemoval {
  skillName: string;
  installDir: string;
}

interface PlannedWorkspaceDocLifecycleAction {
  docName: string;
  docFile: string;
  action: "restore" | "keep";
  restoreContent?: string;
}

interface PlannedSessionRuntimeRemoval {
  pluginRoot: string;
}

export async function uninstallOpenClawIntegration(
  args: UninstallCommandArgs,
  environment: ResolvedInstallerEnvironment,
  options: UninstallOpenClawIntegrationOptions = {}
): Promise<UninstallOpenClawIntegrationResult> {
  const cli = options.cli ?? new OpenClawCli();
  await ensureOpenClawCliReady(cli);

  const workspacePath = resolveExplicitWorkspacePath(args.workspace);
  assertAgentWorkspaceBinding(
    await resolveAgentWorkspaceBinding({
      cli,
      agentId: args.agentId,
      workspacePath,
    })
  );
  const manifestPath = resolveInstallerManifestPath(workspacePath);

  const manifest = readManifestForUninstall(workspacePath, args.force);
  validateManifestForUninstall(manifest, {
    repoRoot: path.resolve(environment.repoRoot),
    workspacePath,
    mcpName: args.mcpName,
    agentId: args.agentId,
    force: args.force,
  });

  const existingMcpDefinition = await cli.showMcpServer(args.mcpName);
  const normalizedExistingMcp = existingMcpDefinition
    ? normalizeActualMcpConfig(args.mcpName, existingMcpDefinition)
    : undefined;

  const canRemoveMcp =
    manifest !== undefined &&
    normalizedExistingMcp !== undefined &&
    areExpectedMcpConfigsEqual(manifest.expectedMcpConfig, normalizedExistingMcp);

  if (existingMcpDefinition && !canRemoveMcp && !args.force) {
    throw new Error(
      "Uninstall refused because MCP ownership is uncertain. The existing MCP registration does not match installer-owned manifest state."
    );
  }

  const plannedSkillRemovals = planSkillDirectoryRemovals({
    workspacePath,
    manifest,
    force: args.force,
  });
  const plannedWorkspaceDocLifecycleActions = planWorkspaceDocLifecycleActions({
    workspacePath,
    manifest,
    force: args.force,
  });
  const plannedSessionRuntimeRemoval = planSessionRuntimeRemoval({
    workspacePath,
    repoRoot: path.resolve(environment.repoRoot),
    manifest,
    force: args.force,
  });

  const plannedPolicyCleanups = plannedSessionRuntimeRemoval
    ? dedupeStrings([args.agentId, manifest?.sessionRuntime?.agentId]).map(
        (agentId) => {
          const isRequestedAgent = agentId === args.agentId;
          return {
            agentId,
            allowMissingTarget: !isRequestedAgent,
            matchAgentIdOnly: !isRequestedAgent,
          };
        }
      )
    : [];
  for (const cleanup of plannedPolicyCleanups) {
    await assertCanRemoveSessionRuntimeAgentToolPolicy({
      cli,
      agentId: cleanup.agentId,
      workspacePath,
      allowMissingTarget: cleanup.allowMissingTarget,
      matchAgentIdOnly: cleanup.matchAgentIdOnly,
    });
  }

  applyWorkspaceDocLifecycleActions(plannedWorkspaceDocLifecycleActions);

  const removedSkillDirectories: string[] = [];
  for (const removal of plannedSkillRemovals) {
    if (!fs.existsSync(removal.installDir)) {
      continue;
    }

    removeDirectoryRecursive(removal.installDir);
    removedSkillDirectories.push(removal.installDir);
  }

  if (
    plannedSessionRuntimeRemoval &&
    fs.existsSync(plannedSessionRuntimeRemoval.pluginRoot)
  ) {
    removeDirectoryRecursive(plannedSessionRuntimeRemoval.pluginRoot);
  }

  cleanupInstallerSupportDirectory(workspacePath);
  cleanupSessionRuntimeSupportDirectories(workspacePath);

  if (plannedSessionRuntimeRemoval) {
    for (const cleanup of plannedPolicyCleanups) {
      await removeSessionRuntimeAgentToolPolicy({
        cli,
        agentId: cleanup.agentId,
        workspacePath,
        allowMissingTarget: cleanup.allowMissingTarget,
        matchAgentIdOnly: cleanup.matchAgentIdOnly,
      });
    }
    await removeSessionRuntimePluginConfig({
      cli,
      pluginRoot: plannedSessionRuntimeRemoval.pluginRoot,
    });
  }

  let removedMcpRegistration = false;
  if (existingMcpDefinition && canRemoveMcp) {
    await cli.unsetMcpServer(args.mcpName);
    removedMcpRegistration = true;
  }

  let removedManifest = false;
  if (fs.existsSync(manifestPath)) {
    const stat = fs.statSync(manifestPath);
    if (!stat.isFile()) {
      if (!args.force) {
        throw new Error(
          `Uninstall refused because manifest path is not a regular file: ${manifestPath}`
        );
      }
      removeDirectoryRecursive(manifestPath);
      removedManifest = true;
    } else {
      fs.unlinkSync(manifestPath);
      removedManifest = true;
    }
  }

  return {
    workspacePath,
    manifestPath,
    removedMcpRegistration,
    removedManifest,
    removedSkillDirectories: removedSkillDirectories.sort((left, right) =>
      left.localeCompare(right)
    ),
  };
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function planSkillDirectoryRemovals(options: {
  workspacePath: string;
  manifest: ReturnType<typeof readInstallerManifest>;
  force: boolean;
}): PlannedSkillRemoval[] {
  const planned: PlannedSkillRemoval[] = [];
  const bySkillName = new Map<string, NonNullable<ReturnType<typeof readInstallerManifest>>["installedSkills"][number]>();

  if (options.manifest) {
    for (const installedSkill of options.manifest.installedSkills) {
      bySkillName.set(installedSkill.skillName, installedSkill);
    }
  }

  for (const skillName of OPENCLAW_SKILL_NAMES) {
    const installDir = path.resolve(options.workspacePath, "skills", skillName);
    const installFile = path.resolve(installDir, "SKILL.md");
    const manifestSkill = bySkillName.get(skillName);

    if (!fs.existsSync(installDir)) {
      continue;
    }

    if (!manifestSkill) {
      if (!options.force) {
        throw new Error(
          `Uninstall refused because skill directory has no installer ownership metadata: ${installDir}`
        );
      }
      planned.push({ skillName, installDir });
      continue;
    }

    if (
      path.resolve(manifestSkill.installDir) !== installDir ||
      path.resolve(manifestSkill.skillFile) !== installFile
    ) {
      if (!options.force) {
        throw new Error(
          `Uninstall refused because manifest ownership paths drifted for skill ${skillName}.`
        );
      }
      planned.push({ skillName, installDir });
      continue;
    }

    if (!fs.statSync(installDir).isDirectory()) {
      if (!options.force) {
        throw new Error(
          `Uninstall refused because skill directory path is not a directory: ${installDir}`
        );
      }
      planned.push({ skillName, installDir });
      continue;
    }

    const dirEntries = fs.readdirSync(installDir).sort((left, right) =>
      left.localeCompare(right)
    );

    if (fs.existsSync(installFile)) {
      if (!fs.statSync(installFile).isFile()) {
        if (!options.force) {
          throw new Error(
            `Uninstall refused because skill file path is not a regular file: ${installFile}`
          );
        }
        planned.push({ skillName, installDir });
        continue;
      }

      const diskHash = sha256(fs.readFileSync(installFile, "utf8"));
      if (diskHash !== manifestSkill.contentHash && !options.force) {
        throw new Error(
          `Uninstall refused because skill ${skillName} appears user-modified. Re-run with --force to remove it.`
        );
      }

      const hasOnlyInstallerArtifact =
        dirEntries.length === 1 && dirEntries[0] === "SKILL.md";
      if (!hasOnlyInstallerArtifact && !options.force) {
        throw new Error(
          `Uninstall refused because skill ${skillName} directory contains additional user content. Re-run with --force to remove it.`
        );
      }
    } else {
      if (dirEntries.length > 0 && !options.force) {
        throw new Error(
          `Uninstall refused because skill ${skillName} has uncertain on-disk ownership state. Re-run with --force to remove it.`
        );
      }
    }

    planned.push({ skillName, installDir });
  }

  return planned;
}

function planWorkspaceDocLifecycleActions(options: {
  workspacePath: string;
  manifest: ReturnType<typeof readInstallerManifest>;
  force: boolean;
}): PlannedWorkspaceDocLifecycleAction[] {
  const planned: PlannedWorkspaceDocLifecycleAction[] = [];

  if (!options.manifest) {
    return planned;
  }

  const docsByName = new Map<
    InstallerWorkspaceDocName,
    NonNullable<ReturnType<typeof readInstallerManifest>>["installedWorkspaceDocs"][number]
  >();
  for (const installedDoc of options.manifest.installedWorkspaceDocs) {
    if (docsByName.has(installedDoc.docName)) {
      if (!options.force) {
        throw new Error(
          `Uninstall refused because workspace-doc ownership metadata is duplicated for ${installedDoc.docName}.`
        );
      }
      continue;
    }
    docsByName.set(installedDoc.docName, installedDoc);
  }

  for (const expectedDocName of INSTALLER_WORKSPACE_DOC_NAMES) {
    const installedDoc = docsByName.get(expectedDocName);
    if (!installedDoc) {
      if (!options.force) {
        throw new Error(
          `Uninstall refused because workspace-doc ownership metadata is missing for ${expectedDocName}.`
        );
      }
      continue;
    }

    const expectedDocFile = path.resolve(options.workspacePath, installedDoc.docName);
    const manifestDocFile = path.resolve(installedDoc.docFile);

    if (manifestDocFile !== expectedDocFile && !options.force) {
      throw new Error(
        `Uninstall refused because workspace-doc ownership path drifted for ${installedDoc.docName}.`
      );
    }

    const expectedRenderedDoc = renderOpenClawWorkspaceDoc({
      docName: installedDoc.docName,
    });
    if (
      installedDoc.contentHash !== expectedRenderedDoc.contentHash &&
      !options.force
    ) {
      throw new Error(
        `Uninstall refused because workspace-doc ownership metadata drifted for ${installedDoc.docName}.`
      );
    }

    if (!installedDoc.preinstallSnapshot.known) {
      planned.push({
        docName: installedDoc.docName,
        docFile: expectedDocFile,
        action: "keep",
      });
      continue;
    }

    if (!installedDoc.preinstallSnapshot.existed) {
      planned.push({
        docName: installedDoc.docName,
        docFile: expectedDocFile,
        action: "keep",
      });
      continue;
    }

    validateWorkspaceDocRestoreTarget({
      docName: installedDoc.docName,
      docFile: expectedDocFile,
      expectedInstalledContentHash: expectedRenderedDoc.contentHash,
      force: options.force,
    });

    planned.push({
      docName: installedDoc.docName,
      docFile: expectedDocFile,
      action: "restore",
      restoreContent: installedDoc.preinstallSnapshot.content,
    });
  }

  return planned;
}

function validateWorkspaceDocRestoreTarget(options: {
  docName: string;
  docFile: string;
  expectedInstalledContentHash: string;
  force: boolean;
}): void {
  if (!fs.existsSync(options.docFile)) {
    if (!options.force) {
      throw new Error(
        `Uninstall refused because workspace doc ${options.docName} is missing and no longer matches installer-managed state: ${options.docFile}. Re-run with --force to restore preinstall snapshot.`
      );
    }
    return;
  }

  const docLstat = fs.lstatSync(options.docFile);
  if (docLstat.isSymbolicLink() && !options.force) {
    throw new Error(
      `Uninstall refused because workspace doc path must not be a symlink: ${options.docFile}`
    );
  }

  if (!docLstat.isSymbolicLink() && !docLstat.isFile() && !options.force) {
    throw new Error(
      `Uninstall refused because workspace doc restore target is not a regular file: ${options.docFile} (${options.docName})`
    );
  }

  if (!docLstat.isFile()) {
    return;
  }

  const diskHash = sha256(fs.readFileSync(options.docFile, "utf8"));
  if (diskHash !== options.expectedInstalledContentHash && !options.force) {
    throw new Error(
      `Uninstall refused because workspace doc ${options.docName} appears user-modified since install. Re-run with --force to restore preinstall snapshot.`
    );
  }
}

function applyWorkspaceDocLifecycleActions(
  actions: readonly PlannedWorkspaceDocLifecycleAction[]
): void {
  for (const action of actions) {
    if (action.action !== "restore") {
      continue;
    }

    if (fs.existsSync(action.docFile)) {
      const docLstat = fs.lstatSync(action.docFile);
      if (docLstat.isSymbolicLink()) {
        fs.unlinkSync(action.docFile);
      } else if (!docLstat.isFile()) {
        removeDirectoryRecursive(action.docFile);
      }
    }

    fs.mkdirSync(path.dirname(action.docFile), { recursive: true });
    fs.writeFileSync(action.docFile, action.restoreContent ?? "", "utf8");
  }
}

function planSessionRuntimeRemoval(options: {
  workspacePath: string;
  repoRoot: string;
  manifest: ReturnType<typeof readInstallerManifest>;
  force: boolean;
}): PlannedSessionRuntimeRemoval | undefined {
  if (options.manifest?.sessionRuntime) {
    validateManagedSessionRuntimeForUninstall(
      options.manifest.sessionRuntime.pluginRoot,
      options.manifest.sessionRuntime.pluginIndexFile,
      options.manifest.sessionRuntime.pluginManifestFile,
      options.manifest.sessionRuntime.pluginIndexContentHash,
      options.manifest.sessionRuntime.pluginManifestContentHash,
      options.force
    );
    return {
      pluginRoot: path.resolve(options.manifest.sessionRuntime.pluginRoot),
    };
  }

  const expectedPaths = resolveSessionRuntimeArtifactPaths(options.workspacePath);
  const hasRuntimeSignal =
    fs.existsSync(expectedPaths.pluginRoot) ||
    fs.existsSync(expectedPaths.pluginIndexFile) ||
    fs.existsSync(expectedPaths.pluginManifestFile);
  if (!hasRuntimeSignal) {
    return undefined;
  }

  const expectedIndexHash = renderSessionRuntimePluginIndex({
    sourcePluginEntrypoint: path.resolve(options.repoRoot, "dist", "openclaw_plugin.js"),
  }).contentHash;
  const expectedManifestHash = renderSessionRuntimePluginManifest({
    sourcePluginManifestPath: path.resolve(options.repoRoot, "openclaw.plugin.json"),
  }).contentHash;

  validateManagedSessionRuntimeForUninstall(
    expectedPaths.pluginRoot,
    expectedPaths.pluginIndexFile,
    expectedPaths.pluginManifestFile,
    expectedIndexHash,
    expectedManifestHash,
    options.force
  );

  return {
    pluginRoot: expectedPaths.pluginRoot,
  };
}

function validateManagedSessionRuntimeForUninstall(
  pluginRoot: string,
  pluginIndexFile: string,
  pluginManifestFile: string,
  expectedIndexHash: string,
  expectedManifestHash: string,
  force: boolean
): void {
  if (!fs.existsSync(pluginRoot)) {
    return;
  }

  const pluginRootLstat = fs.lstatSync(pluginRoot);
  if (pluginRootLstat.isSymbolicLink() && !force) {
    throw new Error(
      `Uninstall refused because session runtime plugin root is symlinked: ${pluginRoot}`
    );
  }

  if (!pluginRootLstat.isDirectory()) {
    if (!force) {
      throw new Error(
        `Uninstall refused because session runtime plugin root is not a directory: ${pluginRoot}`
      );
    }
    return;
  }

  const entries = fs.readdirSync(pluginRoot).sort((left, right) =>
    left.localeCompare(right)
  );
  const hasOnlyInstallerFiles =
    entries.length === 2 &&
    entries[0] === "index.ts" &&
    entries[1] === "openclaw.plugin.json";
  if (!hasOnlyInstallerFiles && !force) {
    throw new Error(
      `Uninstall refused because session runtime directory contains unexpected content: ${pluginRoot}`
    );
  }

  validateManagedSessionRuntimeFile(
    pluginIndexFile,
    expectedIndexHash,
    "plugin index",
    force
  );
  validateManagedSessionRuntimeFile(
    pluginManifestFile,
    expectedManifestHash,
    "plugin manifest",
    force
  );
}

function validateManagedSessionRuntimeFile(
  filePath: string,
  expectedHash: string,
  label: string,
  force: boolean
): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileLstat = fs.lstatSync(filePath);
  if (fileLstat.isSymbolicLink() && !force) {
    throw new Error(
      `Uninstall refused because session runtime ${label} path is symlinked: ${filePath}`
    );
  }

  if (!fileLstat.isFile()) {
    if (!force) {
      throw new Error(
        `Uninstall refused because session runtime ${label} path is not a regular file: ${filePath}`
      );
    }
    return;
  }

  const diskHash = sha256(fs.readFileSync(filePath, "utf8"));
  if (diskHash !== expectedHash && !force) {
    throw new Error(
      `Uninstall refused because session runtime ${label} appears user-modified: ${filePath}`
    );
  }
}

function validateManifestForUninstall(
  manifest: ReturnType<typeof readInstallerManifest>,
  options: {
    repoRoot: string;
    workspacePath: string;
    mcpName: string;
    agentId: string;
    force: boolean;
  }
): void {
  if (!manifest) {
    if (!options.force) {
      throw new Error(
        "Uninstall refused because installer manifest is missing and ownership is uncertain. Re-run with --force to remove known installer targets."
      );
    }
    return;
  }

  const validation = validateInstallerManifest(manifest, {
    repoRoot: options.repoRoot,
    workspacePath: options.workspacePath,
    mcpName: options.mcpName,
    agentId: options.agentId,
  });

  if (validation.status === "unknown_ownership" && !options.force) {
    throw new Error(
      `Uninstall refused because manifest ownership is uncertain. ${validation.driftItems
        .map((item) => item.message)
        .join(" | ")}`
    );
  }

  const agentMismatch = validation.driftItems.find((item) => {
    return (
      item.kind === "session_runtime_hash_drift" &&
      item.message.includes("agent id")
    );
  });
  if (agentMismatch && !options.force) {
    throw new Error(
      `Uninstall refused because manifest agent ownership differs from --agent-id. ${agentMismatch.message}`
    );
  }
}

function readManifestForUninstall(
  workspacePath: string,
  force: boolean
): ReturnType<typeof readInstallerManifest> {
  try {
    return readInstallerManifest(workspacePath, {
      allowMissing: true,
    });
  } catch (error) {
    if (force) {
      return undefined;
    }

    throw new Error(
      `Uninstall refused because installer manifest is malformed and ownership cannot be verified. Use --force to override. ${stringifyError(
        error
      )}`
    );
  }
}

function cleanupInstallerSupportDirectory(workspacePath: string): void {
  const supportDirectoryPath = path.resolve(workspacePath, ".llm-kb");
  if (!fs.existsSync(supportDirectoryPath)) {
    return;
  }

  if (!fs.statSync(supportDirectoryPath).isDirectory()) {
    return;
  }

  if (fs.readdirSync(supportDirectoryPath).length === 0) {
    fs.rmdirSync(supportDirectoryPath);
  }
}

function cleanupSessionRuntimeSupportDirectories(workspacePath: string): void {
  const extensionDirectoryPath = path.resolve(workspacePath, ".openclaw", "extensions");
  const openclawDirectoryPath = path.resolve(workspacePath, ".openclaw");

  if (
    fs.existsSync(extensionDirectoryPath) &&
    fs.statSync(extensionDirectoryPath).isDirectory() &&
    fs.readdirSync(extensionDirectoryPath).length === 0
  ) {
    fs.rmdirSync(extensionDirectoryPath);
  }

  if (
    fs.existsSync(openclawDirectoryPath) &&
    fs.statSync(openclawDirectoryPath).isDirectory() &&
    fs.readdirSync(openclawDirectoryPath).length === 0
  ) {
    fs.rmdirSync(openclawDirectoryPath);
  }
}

async function ensureOpenClawCliReady(cli: OpenClawCli): Promise<void> {
  try {
    await cli.getConfigFilePath();
  } catch (error) {
    throw new Error(`OpenClaw CLI is missing or invalid: ${stringifyError(error)}`);
  }
}

function removeDirectoryRecursive(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    return;
  }
  fs.rmSync(directoryPath, { recursive: true, force: true });
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
