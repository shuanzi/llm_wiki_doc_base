import * as fs from "fs";
import * as path from "path";

import { sha256 } from "../utils/hash";
import {
  areExpectedMcpConfigsEqual,
  buildExpectedMcpConfig,
  checkOpenClawInstallation,
  normalizeActualMcpConfig,
} from "./check";
import {
  bootstrapExternalKbRoot,
  type BootstrapExternalKbRootResult,
  validateMinimumKbStructure,
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
import { renderAllOpenClawWorkspaceDocs } from "./workspace-docs";
import type {
  InstallerCheckResult,
  InstallerManifest,
  InstallerRepairAction,
  InstallerRepairOutcome,
  RepairCommandArgs,
  ResolvedInstallerEnvironment,
} from "./types";

const REQUIRED_REPO_FILES = [
  "package.json",
  "src/mcp_server.ts",
  "skills/kb_ingest/SKILL.md",
  "skills/kb_query/SKILL.md",
  "skills/kb_lint/SKILL.md",
] as const;

interface RepairSkillState {
  skillName: string;
  installDir: string;
  installFile: string;
  matchesExpected: boolean;
  missing: boolean;
  conflictMessage?: string;
}

interface RepairWorkspaceDocState {
  docName: string;
  docFile: string;
  matchesExpected: boolean;
  missing: boolean;
  conflictMessage?: string;
}

interface RepairOpenClawIntegrationOptions {
  cli?: OpenClawCli;
  nodeCommand?: string;
}

interface RollbackState {
  mutated: boolean;
  mcpName: string;
  previousMcpRegistration?: OpenClawMcpServerDefinition;
  mcpRegistrationUpdated: boolean;
  createdKbRoot: boolean;
  createdKbDirectories: string[];
  createdKbFiles: string[];
  createdSkillDirectories: string[];
  createdSkillFiles: string[];
  overwrittenSkillFiles: Array<{ filePath: string; content: string }>;
  createdWorkspaceDocFiles: string[];
  overwrittenWorkspaceDocFiles: Array<{ filePath: string; content: string }>;
  createdManifestPath?: string;
  overwrittenManifest?: { manifestPath: string; content: string };
}

export async function repairOpenClawIntegration(
  args: RepairCommandArgs,
  environment: ResolvedInstallerEnvironment,
  options: RepairOpenClawIntegrationOptions = {}
): Promise<InstallerRepairOutcome> {
  const cli = options.cli ?? new OpenClawCli();
  const nodeCommand = options.nodeCommand ?? process.execPath;
  const repoRoot = path.resolve(environment.repoRoot);
  const mcpServerEntrypoint = path.resolve(environment.mcpServerEntrypoint);

  validateRepositoryState(repoRoot);
  ensureBuildArtifactExists(mcpServerEntrypoint);
  await ensureOpenClawCliReady(cli);

  const workspacePath = await resolveAndValidateWorkspace(cli, args.workspace);
  ensureWorkspaceDirectory(workspacePath);

  const resolvedEnvironment: ResolvedInstallerEnvironment = {
    ...environment,
    command: "repair",
    repoRoot,
    mcpServerEntrypoint,
    mcpName: args.mcpName,
    workspace: workspacePath,
  };

  const existingManifest = readExistingManifest(workspacePath, args.force);
  const existingMcpDefinition = await cli.showMcpServer(args.mcpName);
  const normalizedExistingMcp = existingMcpDefinition
    ? normalizeActualMcpConfig(args.mcpName, existingMcpDefinition)
    : undefined;

  const kbRoot = resolveKbRootForRepair({
    argsKbRoot: args.kbRoot,
    manifestKbRoot: existingManifest?.kbRoot,
    mcpKbRoot: normalizedExistingMcp?.env.KB_ROOT,
    force: args.force,
  });

  if (!kbRoot) {
    throw new Error(
      "Repair cannot determine KB_ROOT because both installer manifest and MCP registration are missing KB_ROOT metadata. Provide --kb-root explicitly."
    );
  }

  resolvedEnvironment.kbRoot = kbRoot;

  if (existingManifest) {
    validateManifestOwnership(existingManifest, {
      repoRoot,
      workspacePath,
      mcpName: args.mcpName,
      kbRoot,
      force: args.force,
    });
  } else {
    validateManifestReconstructionPreconditions({
      normalizedExistingMcp,
      kbRootFromArgs: args.kbRoot,
      force: args.force,
    });
  }

  const renderedSkills = renderAllOpenClawSkills(repoRoot);
  const renderedWorkspaceDocs = renderAllOpenClawWorkspaceDocs();
  const skillStates = inspectSkillState({
    workspacePath,
    renderedSkills,
    hasExistingManifest: Boolean(existingManifest),
  });
  const workspaceDocStates = inspectWorkspaceDocState({
    workspacePath,
    renderedWorkspaceDocs,
    hasExistingManifest: Boolean(existingManifest),
  });

  const conflicts = [...skillStates, ...workspaceDocStates]
    .map((state) => state.conflictMessage)
    .filter((message): message is string => Boolean(message));
  if (conflicts.length > 0 && !args.force) {
    throw new Error(
      `Repair refused due to installer ownership conflicts. ${conflicts.join(" | ")} Use --force to overwrite conflicting installer-targeted artifacts.`
    );
  }

  const hasInstallerSignals =
    normalizedExistingMcp !== undefined ||
    skillStates.some((state) => state.matchesExpected) ||
    workspaceDocStates.some((state) => state.matchesExpected);
  if (!existingManifest && !hasInstallerSignals && !args.force) {
    throw new Error(
      "Repair refused because state is too ambiguous to reconstruct ownership (missing manifest, no recognizable installer MCP config, and no recognizable installer skill/workspace-doc files). Use --force to proceed."
    );
  }

  const rollback: RollbackState = {
    mutated: false,
    mcpName: args.mcpName,
    previousMcpRegistration: existingMcpDefinition,
    mcpRegistrationUpdated: false,
    createdKbRoot: !fs.existsSync(kbRoot),
    createdKbDirectories: [],
    createdKbFiles: [],
    createdSkillDirectories: [],
    createdSkillFiles: [],
    overwrittenSkillFiles: [],
    createdWorkspaceDocFiles: [],
    overwrittenWorkspaceDocFiles: [],
  };

  const appliedActions: InstallerRepairAction[] = [];

  try {
    const kbValidation = validateMinimumKbStructure(kbRoot);
    if (!kbValidation.ok) {
      const bootstrapResult = bootstrapExternalKbRoot({
        repoRoot,
        kbRoot,
      });
      trackBootstrapRollback(rollback, kbRoot, bootstrapResult);
    }

    const installedAt = new Date().toISOString();
    const skillMaterialization = materializeSkills({
      workspacePath,
      renderedSkills,
      installedAt,
      force: args.force,
      rollback,
    });
    const workspaceDocMaterialization = materializeWorkspaceDocs({
      workspacePath,
      renderedWorkspaceDocs,
      installedAt,
      existingManifest,
      force: args.force,
      rollback,
    });

    if (skillMaterialization.wroteAnySkill) {
      appliedActions.push("rewrite_skill");
    }

    const expectedMcpConfig = buildExpectedMcpConfig({
      mcpName: args.mcpName,
      serverEntrypoint: mcpServerEntrypoint,
      kbRoot,
      nodeCommand,
    });

    if (
      normalizedExistingMcp === undefined ||
      !areExpectedMcpConfigsEqual(expectedMcpConfig, normalizedExistingMcp)
    ) {
      await cli.setMcpServer(args.mcpName, {
        command: expectedMcpConfig.command,
        args: expectedMcpConfig.args,
        env: expectedMcpConfig.env,
      });
      rollback.mutated = true;
      rollback.mcpRegistrationUpdated = true;
      appliedActions.push("update_mcp_config");
    }

    const probeResult = await probeKbMcpServer({
      serverEntrypoint: mcpServerEntrypoint,
      kbRoot,
      nodeCommand,
    });

    if (!probeResult.ok) {
      throw new Error(
        `Repair probe failed: ${probeResult.failureReason ?? "unknown probe failure"}`
      );
    }
    appliedActions.push("reprobe_mcp");

    const manifest = createInstallerManifest({
      installerVersion: readInstallerVersion(repoRoot),
      repoRoot,
      workspacePath,
      kbRoot,
      mcpName: args.mcpName,
      installedAt,
      installedSkills: skillMaterialization.installedSkills,
      installedWorkspaceDocs: workspaceDocMaterialization.installedWorkspaceDocs,
      expectedMcpConfig,
      lastSuccessfulProbe: {
        checkedAt: probeResult.checkedAt,
        ok: true,
        toolNames: probeResult.toolNames,
      },
    });

    trackManifestRollback(rollback, workspacePath);
    writeInstallerManifest(workspacePath, manifest);
    rollback.mutated = true;
    appliedActions.push("create_manifest");

    const postCheck = await checkOpenClawInstallation({
      environment: {
        ...resolvedEnvironment,
        command: "check",
      },
      requestedWorkspace: workspacePath,
      mcpName: args.mcpName,
      cli,
      nodeCommand,
    });

    if (!postCheck.ok) {
      throw new Error(
        `Post-repair check detected drift: ${formatDriftSummary(postCheck)}`
      );
    }

    const uniqueActions = dedupeRepairActions(appliedActions);
    if (uniqueActions.length === 0) {
      uniqueActions.push("none");
    }

    return {
      ok: true,
      environment: resolvedEnvironment,
      appliedActions: uniqueActions,
      remainingDriftItems: [],
      message: "Repair completed successfully.",
    };
  } catch (error) {
    if (rollback.mutated) {
      const rollbackErrors = await rollbackCreatedArtifacts(cli, kbRoot, rollback);
      if (rollbackErrors.length > 0) {
        throw buildRepairRollbackError(error, rollbackErrors);
      }
    }
    throw error;
  }
}

function inspectSkillState(options: {
  workspacePath: string;
  renderedSkills: Array<{
    skillName: string;
    installRelativeDir: string;
    installRelativeFile: string;
    contentHash: string;
  }>;
  hasExistingManifest: boolean;
}): RepairSkillState[] {
  const states: RepairSkillState[] = [];

  for (const renderedSkill of options.renderedSkills) {
    const installDir = path.resolve(options.workspacePath, renderedSkill.installRelativeDir);
    const installFile = path.resolve(options.workspacePath, renderedSkill.installRelativeFile);

    if (fs.existsSync(installDir) && !fs.statSync(installDir).isDirectory()) {
      states.push({
        skillName: renderedSkill.skillName,
        installDir,
        installFile,
        matchesExpected: false,
        missing: false,
        conflictMessage: `Skill path exists but is not a directory: ${installDir}`,
      });
      continue;
    }

    if (!fs.existsSync(installFile)) {
      if (!options.hasExistingManifest && fs.existsSync(installDir)) {
        const entries = fs.readdirSync(installDir);
        if (entries.length > 0) {
          states.push({
            skillName: renderedSkill.skillName,
            installDir,
            installFile,
            matchesExpected: false,
            missing: true,
            conflictMessage: `Skill directory already contains non-installer state for ${renderedSkill.skillName}: ${installDir}`,
          });
          continue;
        }
      }

      states.push({
        skillName: renderedSkill.skillName,
        installDir,
        installFile,
        matchesExpected: false,
        missing: true,
      });
      continue;
    }

    if (!fs.statSync(installFile).isFile()) {
      states.push({
        skillName: renderedSkill.skillName,
        installDir,
        installFile,
        matchesExpected: false,
        missing: false,
        conflictMessage: `Skill file path is not a regular file: ${installFile}`,
      });
      continue;
    }

    const existingHash = sha256(fs.readFileSync(installFile, "utf8"));
    if (existingHash !== renderedSkill.contentHash) {
      states.push({
        skillName: renderedSkill.skillName,
        installDir,
        installFile,
        matchesExpected: false,
        missing: false,
        conflictMessage: `Skill ${renderedSkill.skillName} content drift detected at ${installFile}`,
      });
      continue;
    }

    states.push({
      skillName: renderedSkill.skillName,
      installDir,
      installFile,
      matchesExpected: true,
      missing: false,
    });
  }

  return states;
}

function inspectWorkspaceDocState(options: {
  workspacePath: string;
  renderedWorkspaceDocs: Array<{
    docName: string;
    installRelativeFile: string;
    contentHash: string;
  }>;
  hasExistingManifest: boolean;
}): RepairWorkspaceDocState[] {
  const states: RepairWorkspaceDocState[] = [];
  assertWorkspaceRootSafeForDocs(options.workspacePath);

  for (const renderedDoc of options.renderedWorkspaceDocs) {
    const docFile = path.resolve(options.workspacePath, renderedDoc.installRelativeFile);

    if (!fs.existsSync(docFile)) {
      states.push({
        docName: renderedDoc.docName,
        docFile,
        matchesExpected: false,
        missing: true,
      });
      continue;
    }

    const docLstat = fs.lstatSync(docFile);
    if (docLstat.isSymbolicLink()) {
      states.push({
        docName: renderedDoc.docName,
        docFile,
        matchesExpected: false,
        missing: false,
        conflictMessage: `Workspace doc path must not be a symlink: ${docFile}`,
      });
      continue;
    }

    if (!docLstat.isFile()) {
      states.push({
        docName: renderedDoc.docName,
        docFile,
        matchesExpected: false,
        missing: false,
        conflictMessage: `Workspace doc path is not a regular file: ${docFile}`,
      });
      continue;
    }

    const existingHash = sha256(fs.readFileSync(docFile, "utf8"));
    if (existingHash !== renderedDoc.contentHash) {
      states.push({
        docName: renderedDoc.docName,
        docFile,
        matchesExpected: false,
        missing: false,
        conflictMessage: options.hasExistingManifest
          ? undefined
          : `Workspace doc ${renderedDoc.docName} content drift detected at ${docFile}`,
      });
      continue;
    }

    states.push({
      docName: renderedDoc.docName,
      docFile,
      matchesExpected: true,
      missing: false,
    });
  }

  return states;
}

function materializeSkills(options: {
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
  force: boolean;
  rollback: RollbackState;
}): {
  installedSkills: InstallerManifest["installedSkills"];
  wroteAnySkill: boolean;
} {
  const installedSkills: InstallerManifest["installedSkills"] = [];
  let wroteAnySkill = false;

  for (const renderedSkill of options.renderedSkills) {
    const installDir = path.resolve(options.workspacePath, renderedSkill.installRelativeDir);
    const installFile = path.resolve(options.workspacePath, renderedSkill.installRelativeFile);

    const installDirAlreadyExisted = fs.existsSync(installDir);
    if (installDirAlreadyExisted && !fs.statSync(installDir).isDirectory()) {
      throw new Error(`Skill target path is not a directory: ${installDir}`);
    }

    const installFileAlreadyExisted = fs.existsSync(installFile);
    let shouldWriteSkillFile = true;
    let previousContent: string | undefined;

    if (installFileAlreadyExisted) {
      if (!fs.statSync(installFile).isFile()) {
        throw new Error(`Skill target file path is not a regular file: ${installFile}`);
      }

      previousContent = fs.readFileSync(installFile, "utf8");
      const existingHash = sha256(previousContent);

      if (existingHash === renderedSkill.contentHash) {
        shouldWriteSkillFile = false;
      } else if (!options.force) {
        throw new Error(
          `Repair refused to overwrite user-modified skill ${renderedSkill.skillName} without --force.`
        );
      }
    }

    if (shouldWriteSkillFile) {
      fs.mkdirSync(installDir, { recursive: true });
      fs.writeFileSync(installFile, renderedSkill.content, "utf8");
      wroteAnySkill = true;
      options.rollback.mutated = true;

      if (!installDirAlreadyExisted) {
        options.rollback.createdSkillDirectories.push(installDir);
      }
      if (!installFileAlreadyExisted) {
        options.rollback.createdSkillFiles.push(installFile);
      } else if (previousContent !== undefined) {
        options.rollback.overwrittenSkillFiles.push({
          filePath: installFile,
          content: previousContent,
        });
      }
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
  return {
    installedSkills,
    wroteAnySkill,
  };
}

function materializeWorkspaceDocs(options: {
  workspacePath: string;
  renderedWorkspaceDocs: Array<{
    docName: InstallerManifest["installedWorkspaceDocs"][number]["docName"];
    installRelativeFile: string;
    content: string;
    contentHash: string;
  }>;
  installedAt: string;
  existingManifest: ReturnType<typeof readInstallerManifest>;
  force: boolean;
  rollback: RollbackState;
}): {
  installedWorkspaceDocs: InstallerManifest["installedWorkspaceDocs"];
  wroteAnyWorkspaceDoc: boolean;
} {
  const installedWorkspaceDocs: InstallerManifest["installedWorkspaceDocs"] = [];
  const manifestDocEntries = new Map<
    InstallerManifest["installedWorkspaceDocs"][number]["docName"],
    InstallerManifest["installedWorkspaceDocs"][number]
  >();
  let wroteAnyWorkspaceDoc = false;

  if (options.existingManifest) {
    for (const existingDocEntry of options.existingManifest.installedWorkspaceDocs) {
      manifestDocEntries.set(existingDocEntry.docName, existingDocEntry);
    }
  }

  assertWorkspaceRootSafeForDocs(options.workspacePath);

  for (const renderedDoc of options.renderedWorkspaceDocs) {
    const docFile = path.resolve(options.workspacePath, renderedDoc.installRelativeFile);
    const existingManifestEntry = manifestDocEntries.get(renderedDoc.docName);

    const docFileAlreadyExisted = fs.existsSync(docFile);
    let previousDocContent: string | undefined;
    let shouldWriteDocFile = true;

    if (docFileAlreadyExisted) {
      const existingDocStat = fs.lstatSync(docFile);
      if (existingDocStat.isSymbolicLink()) {
        throw new Error(`Workspace doc path must not be a symlink: ${docFile}`);
      }
      if (!existingDocStat.isFile()) {
        throw new Error(`Workspace doc path is not a regular file: ${docFile}`);
      }
      previousDocContent = fs.readFileSync(docFile, "utf8");
      const existingHash = sha256(previousDocContent);
      if (existingHash === renderedDoc.contentHash) {
        shouldWriteDocFile = false;
      } else if (!options.existingManifest && !options.force) {
        throw new Error(
          `Repair refused to overwrite workspace doc ${renderedDoc.docName} without --force while manifest ownership metadata is missing.`
        );
      }
    }

    if (shouldWriteDocFile) {
      fs.writeFileSync(docFile, renderedDoc.content, "utf8");
      wroteAnyWorkspaceDoc = true;
      options.rollback.mutated = true;

      if (!docFileAlreadyExisted) {
        options.rollback.createdWorkspaceDocFiles.push(docFile);
      } else if (previousDocContent !== undefined) {
        options.rollback.overwrittenWorkspaceDocFiles.push({
          filePath: docFile,
          content: previousDocContent,
        });
      }
    }

    installedWorkspaceDocs.push({
      docName: renderedDoc.docName,
      docFile,
      contentHash: renderedDoc.contentHash,
      installedAt: options.installedAt,
      preinstallSnapshot: existingManifestEntry
        ? existingManifestEntry.preinstallSnapshot
        : {
            known: false,
          },
    });
  }

  installedWorkspaceDocs.sort((left, right) => left.docName.localeCompare(right.docName));

  return {
    installedWorkspaceDocs,
    wroteAnyWorkspaceDoc,
  };
}

function resolveKbRootForRepair(options: {
  argsKbRoot?: string;
  manifestKbRoot?: string;
  mcpKbRoot?: string;
  force: boolean;
}): string | undefined {
  const argKbRoot = options.argsKbRoot ? path.resolve(options.argsKbRoot) : undefined;
  const manifestKbRoot = options.manifestKbRoot
    ? path.resolve(options.manifestKbRoot)
    : undefined;
  const mcpKbRoot = options.mcpKbRoot ? path.resolve(options.mcpKbRoot) : undefined;

  const knownRoots = dedupePaths([manifestKbRoot, mcpKbRoot]);

  if (argKbRoot) {
    const conflictingKnownRoot = knownRoots.find((knownRoot) => knownRoot !== argKbRoot);
    if (conflictingKnownRoot && !options.force) {
      throw new Error(
        [
          "Repair refused to re-home existing installation to a different KB_ROOT without --force.",
          `requested: ${argKbRoot}`,
          `existing: ${conflictingKnownRoot}`,
        ].join(" ")
      );
    }
    return argKbRoot;
  }

  if (knownRoots.length === 0) {
    return undefined;
  }

  if (knownRoots.length === 1) {
    return knownRoots[0];
  }

  if (!options.force) {
    throw new Error(
      `Repair found conflicting KB_ROOT signals between manifest and MCP config (${knownRoots.join(
        ", "
      )}). Provide --kb-root and --force after manual verification.`
    );
  }

  return manifestKbRoot ?? knownRoots[0];
}

function validateManifestReconstructionPreconditions(options: {
  normalizedExistingMcp: ReturnType<typeof normalizeActualMcpConfig>;
  kbRootFromArgs?: string;
  force: boolean;
}): void {
  if (options.normalizedExistingMcp) {
    return;
  }

  if (!options.kbRootFromArgs) {
    throw new Error(
      "Repair cannot reconstruct state because installer manifest and MCP registration are missing. Provide --kb-root explicitly."
    );
  }

  if (!options.force) {
    throw new Error(
      "Repair refused because ownership is uncertain with missing manifest and missing MCP registration. Re-run with --force after verifying --kb-root."
    );
  }
}

function validateManifestOwnership(
  manifest: NonNullable<ReturnType<typeof readInstallerManifest>>,
  options: {
    repoRoot: string;
    workspacePath: string;
    mcpName: string;
    kbRoot: string;
    force: boolean;
  }
): void {
  const validation = validateInstallerManifest(manifest, {
    repoRoot: options.repoRoot,
    workspacePath: options.workspacePath,
    kbRoot: options.kbRoot,
    mcpName: options.mcpName,
  });

  if (validation.status === "unknown_ownership" && !options.force) {
    throw new Error(
      `Repair refused because manifest ownership is uncertain. ${formatDriftMessages(
        validation.driftItems
      )} Use --force to override.`
    );
  }
}

function trackBootstrapRollback(
  rollback: RollbackState,
  kbRoot: string,
  bootstrapResult: BootstrapExternalKbRootResult
): void {
  for (const relativePath of bootstrapResult.createdDirectories) {
    rollback.createdKbDirectories.push(path.resolve(kbRoot, relativePath));
  }

  for (const relativePath of bootstrapResult.createdFiles) {
    rollback.createdKbFiles.push(path.resolve(kbRoot, relativePath));
  }

  if (
    bootstrapResult.createdDirectories.length > 0 ||
    bootstrapResult.createdFiles.length > 0
  ) {
    rollback.mutated = true;
  }
}

function trackManifestRollback(rollback: RollbackState, workspacePath: string): void {
  const manifestPath = resolveInstallerManifestPath(workspacePath);
  const manifestExists = fs.existsSync(manifestPath);

  if (manifestExists) {
    if (!fs.statSync(manifestPath).isFile()) {
      throw new Error(`Repair refused because manifest path is not a regular file: ${manifestPath}`);
    }

    rollback.overwrittenManifest = {
      manifestPath,
      content: fs.readFileSync(manifestPath, "utf8"),
    };
  } else {
    rollback.createdManifestPath = manifestPath;
  }
}

async function rollbackCreatedArtifacts(
  cli: OpenClawCli,
  kbRoot: string,
  rollback: RollbackState
): Promise<string[]> {
  const rollbackErrors: string[] = [];

  for (const overwrittenSkillFile of rollback.overwrittenSkillFiles) {
    fs.mkdirSync(path.dirname(overwrittenSkillFile.filePath), { recursive: true });
    fs.writeFileSync(overwrittenSkillFile.filePath, overwrittenSkillFile.content, "utf8");
  }
  for (const overwrittenWorkspaceDocFile of rollback.overwrittenWorkspaceDocFiles) {
    fs.mkdirSync(path.dirname(overwrittenWorkspaceDocFile.filePath), { recursive: true });
    fs.writeFileSync(overwrittenWorkspaceDocFile.filePath, overwrittenWorkspaceDocFile.content, "utf8");
  }

  for (const filePath of rollback.createdSkillFiles) {
    removeFileIfExists(filePath);
  }
  for (const filePath of rollback.createdWorkspaceDocFiles) {
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

  if (rollback.mcpRegistrationUpdated) {
    if (rollback.previousMcpRegistration) {
      try {
        await cli.setMcpServer(rollback.mcpName, rollback.previousMcpRegistration);
      } catch (error) {
        rollbackErrors.push(
          `failed to restore MCP registration "${rollback.mcpName}": ${stringifyError(error)}`
        );
      }
    } else {
      try {
        await cli.unsetMcpServer(rollback.mcpName);
      } catch (error) {
        rollbackErrors.push(
          `failed to remove MCP registration "${rollback.mcpName}": ${stringifyError(error)}`
        );
      }
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

  if (rollback.createdKbRoot) {
    removeDirectoryIfEmpty(path.resolve(kbRoot));
  }

  return rollbackErrors;
}

function readExistingManifest(
  workspacePath: string,
  force: boolean
): ReturnType<typeof readInstallerManifest> {
  try {
    return readInstallerManifest(workspacePath, { allowMissing: true });
  } catch (error) {
    if (force) {
      return undefined;
    }

    throw new Error(
      `Installer manifest is malformed and ownership cannot be trusted. Use --force to override. ${stringifyError(error)}`
    );
  }
}

function dedupeRepairActions(actions: readonly InstallerRepairAction[]): InstallerRepairAction[] {
  return [...new Set(actions)];
}

function validateRepositoryState(repoRoot: string): void {
  for (const relativePath of REQUIRED_REPO_FILES) {
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`Repository validation failed: missing file ${relativePath}`);
    }
  }
}

function ensureBuildArtifactExists(mcpServerEntrypoint: string): void {
  if (!fs.existsSync(mcpServerEntrypoint) || !fs.statSync(mcpServerEntrypoint).isFile()) {
    throw new Error(
      `Missing build artifact: ${mcpServerEntrypoint}. Run npm run build before repair.`
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

function ensureWorkspaceDirectory(workspacePath: string): void {
  if (fs.existsSync(workspacePath)) {
    if (!fs.statSync(workspacePath).isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${workspacePath}`);
    }
    return;
  }

  fs.mkdirSync(workspacePath, { recursive: true });
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

function readInstallerVersion(repoRoot: string): string {
  const packageJsonPath = path.resolve(repoRoot, "package.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version ? parsed.version : "0.0.0";
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

  if (!fs.statSync(directoryPath).isDirectory()) {
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

function dedupePaths(paths: Array<string | undefined>): string[] {
  const filtered = paths.filter((value): value is string => Boolean(value));
  return [...new Set(filtered.map((value) => path.resolve(value)))];
}

function formatDriftMessages(items: readonly { message: string }[]): string {
  return items.map((item) => item.message).join(" | ");
}

function formatDriftSummary(checkResult: InstallerCheckResult): string {
  return checkResult.driftItems.map((item) => `[${item.kind}] ${item.message}`).join(" | ");
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildRepairRollbackError(
  originalError: unknown,
  rollbackErrors: readonly string[]
): Error {
  const originalMessage = stringifyError(originalError);
  const message = [
    `Repair failed: ${originalMessage}`,
    `Rollback also failed: ${rollbackErrors.join(" | ")}`,
  ].join(" ");

  if (originalError instanceof Error) {
    return new Error(message, { cause: originalError });
  }

  return new Error(message);
}
