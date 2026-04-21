import * as fs from "fs";
import * as path from "path";

import { sha256 } from "../utils/hash";
import {
  areExpectedMcpConfigsEqual,
  normalizeActualMcpConfig,
} from "./check";
import {
  readInstallerManifest,
  resolveInstallerManifestPath,
  validateInstallerManifest,
} from "./manifest";
import { OpenClawCli } from "./openclaw-cli";
import { OPENCLAW_SKILL_NAMES } from "./skills";
import { renderOpenClawWorkspaceDoc } from "./workspace-docs";
import {
  INSTALLER_WORKSPACE_DOC_NAMES,
  type InstallerWorkspaceDocName,
  type ResolvedInstallerEnvironment,
  type UninstallCommandArgs,
} from "./types";
import {
  OpenClawWorkspaceResolutionError,
  resolveOpenClawWorkspace,
} from "./workspace";

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

export async function uninstallOpenClawIntegration(
  args: UninstallCommandArgs,
  environment: ResolvedInstallerEnvironment,
  options: UninstallOpenClawIntegrationOptions = {}
): Promise<UninstallOpenClawIntegrationResult> {
  const cli = options.cli ?? new OpenClawCli();
  await ensureOpenClawCliReady(cli);

  const workspacePath = await resolveAndValidateWorkspace(cli, args.workspace);
  const manifestPath = resolveInstallerManifestPath(workspacePath);

  const manifest = readManifestForUninstall(workspacePath, args.force);
  validateManifestForUninstall(manifest, {
    repoRoot: path.resolve(environment.repoRoot),
    workspacePath,
    mcpName: args.mcpName,
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

  let removedMcpRegistration = false;
  if (existingMcpDefinition && canRemoveMcp) {
    await cli.unsetMcpServer(args.mcpName);
    removedMcpRegistration = true;
  }

  applyWorkspaceDocLifecycleActions(plannedWorkspaceDocLifecycleActions);

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

  const removedSkillDirectories: string[] = [];
  for (const removal of plannedSkillRemovals) {
    if (!fs.existsSync(removal.installDir)) {
      continue;
    }

    removeDirectoryRecursive(removal.installDir);
    removedSkillDirectories.push(removal.installDir);
  }

  cleanupInstallerSupportDirectory(workspacePath);

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

function validateManifestForUninstall(
  manifest: ReturnType<typeof readInstallerManifest>,
  options: {
    repoRoot: string;
    workspacePath: string;
    mcpName: string;
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
  });

  if (validation.status === "unknown_ownership" && !options.force) {
    throw new Error(
      `Uninstall refused because manifest ownership is uncertain. ${validation.driftItems
        .map((item) => item.message)
        .join(" | ")}`
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

function removeDirectoryRecursive(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    return;
  }
  fs.rmSync(directoryPath, { recursive: true, force: true });
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
