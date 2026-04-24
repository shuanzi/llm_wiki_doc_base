import * as fs from "fs";
import * as path from "path";

import { KB_CANONICAL_TOOL_NAMES } from "../runtime/kb_tool_contract";
import { sha256 } from "../utils/hash";
import {
  SESSION_RUNTIME_AGENT_ID,
  SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH,
  SESSION_RUNTIME_PLUGIN_ID,
  resolveSessionRuntimeArtifactPaths,
  renderSessionRuntimePluginIndex,
  renderSessionRuntimePluginManifest,
} from "./session-runtime-artifact";
import {
  OPENCLAW_SKILL_NAMES,
  type OpenClawSkillName,
  renderOpenClawSkill,
} from "./skills";
import type {
  InstallerDriftItem,
  InstallerExpectedMcpConfig,
  InstallerManifest,
  InstallerProbeSnapshot,
  InstallerSessionRuntimeMetadata,
  InstallerSkillInstallationMetadata,
  InstallerWorkspaceDocInstallationMetadata,
  InstallerWorkspaceDocName,
} from "./types";
import {
  INSTALLER_WORKSPACE_DOC_NAMES,
} from "./types";
import { renderOpenClawWorkspaceDoc } from "./workspace-docs";

export const INSTALLER_MANIFEST_RELATIVE_PATH = ".llm-kb/openclaw-install.json" as const;

export type InstallerManifestValidationStatus =
  | "healthy"
  | "repairable_drift"
  | "unknown_ownership";

export interface InstallerManifestReadOptions {
  allowMissing?: boolean;
}

export interface InstallerManifestOwnershipExpectation {
  repoRoot?: string;
  workspacePath?: string;
  kbRoot?: string;
  mcpName?: string;
  agentId?: string;
  expectedMcpConfig?: InstallerExpectedMcpConfig;
}

export interface InstallerManifestValidationResult {
  status: InstallerManifestValidationStatus;
  driftItems: InstallerDriftItem[];
}

export interface CreateInstallerManifestOptions {
  installerVersion: string;
  repoRoot: string;
  workspacePath: string;
  kbRoot: string;
  mcpName: string;
  installedSkills: InstallerSkillInstallationMetadata[];
  installedWorkspaceDocs?: InstallerWorkspaceDocInstallationMetadata[];
  sessionRuntime?: InstallerSessionRuntimeMetadata;
  expectedMcpConfig: InstallerExpectedMcpConfig;
  installedAt?: string;
  lastSuccessfulProbe?: InstallerProbeSnapshot;
  lastSuccessfulSessionProbe?: InstallerProbeSnapshot;
}

const EXPECTED_SOURCE_TEMPLATE_PATHS: Record<string, string> = {
  kb_ingest: "skills/kb_ingest/SKILL.md",
  kb_query: "skills/kb_query/SKILL.md",
  kb_lint: "skills/kb_lint/SKILL.md",
};

export function resolveInstallerManifestPath(workspacePath: string): string {
  return path.resolve(workspacePath, INSTALLER_MANIFEST_RELATIVE_PATH);
}

export function createInstallerManifest(
  options: CreateInstallerManifestOptions
): InstallerManifest {
  return normalizeInstallerManifest({
    schemaVersion: 1,
    installerVersion: options.installerVersion,
    repoRoot: path.resolve(options.repoRoot),
    workspacePath: path.resolve(options.workspacePath),
    kbRoot: path.resolve(options.kbRoot),
    mcpName: options.mcpName,
    installedAt: options.installedAt ?? new Date().toISOString(),
    skillVariantSet: "openclaw-adapted-v1",
    installedSkills: options.installedSkills,
    installedWorkspaceDocs: options.installedWorkspaceDocs ?? [],
    sessionRuntime: options.sessionRuntime,
    expectedMcpConfig: options.expectedMcpConfig,
    lastSuccessfulProbe: options.lastSuccessfulProbe,
    lastSuccessfulSessionProbe: options.lastSuccessfulSessionProbe,
  });
}

export function readInstallerManifest(
  workspacePath: string,
  options: InstallerManifestReadOptions = {}
): InstallerManifest | undefined {
  const manifestPath = resolveInstallerManifestPath(workspacePath);
  if (!fs.existsSync(manifestPath)) {
    if (options.allowMissing) {
      return undefined;
    }
    throw new Error(`Installer manifest not found: ${manifestPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse installer manifest at ${manifestPath}: ${message}`);
  }

  return normalizeInstallerManifest(parseInstallerManifest(parsed));
}

export function writeInstallerManifest(
  workspacePath: string,
  manifest: InstallerManifest
): string {
  const normalizedManifest = normalizeInstallerManifest(manifest);
  const manifestPath = resolveInstallerManifestPath(workspacePath);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, serializeInstallerManifest(normalizedManifest), "utf8");
  return manifestPath;
}

export function validateInstallerManifest(
  manifest: InstallerManifest,
  expectation: InstallerManifestOwnershipExpectation = {}
): InstallerManifestValidationResult {
  const normalizedManifest = normalizeInstallerManifest(manifest);
  const driftItems: InstallerDriftItem[] = [];

  validateOwnershipRoots(normalizedManifest, expectation, driftItems);
  validateMcpExpectation(normalizedManifest, expectation, driftItems);
  validateSkillProvenance(normalizedManifest, driftItems);
  validateWorkspaceDocMetadata(normalizedManifest, driftItems);
  validateSessionRuntimeMetadata(normalizedManifest, expectation, driftItems);

  if (driftItems.some((item) => item.kind === "unknown_ownership")) {
    return { status: "unknown_ownership", driftItems };
  }

  if (driftItems.length > 0) {
    return { status: "repairable_drift", driftItems };
  }

  return { status: "healthy", driftItems: [] };
}

function validateSessionRuntimeMetadata(
  manifest: InstallerManifest,
  expectation: InstallerManifestOwnershipExpectation,
  driftItems: InstallerDriftItem[]
): void {
  const runtime = manifest.sessionRuntime;
  if (!runtime) {
    return;
  }

  const expectedPaths = resolveSessionRuntimeArtifactPaths(manifest.workspacePath);
  const expectedCanonicalTools = [...KB_CANONICAL_TOOL_NAMES].sort((a, b) =>
    a.localeCompare(b)
  );

  if (runtime.runtimeKind !== "workspace-openclaw-native-plugin-shim-v1") {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: "Session runtime kind drifted from installer-owned value.",
      repairable: true,
      expected: "workspace-openclaw-native-plugin-shim-v1",
      actual: runtime.runtimeKind,
    });
  }

  if (runtime.agentId.length === 0) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: "Session runtime agent id must not be empty.",
      repairable: true,
      expected: "non-empty agent id",
      actual: runtime.agentId,
    });
  }

  if (expectation.agentId && runtime.agentId !== expectation.agentId) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: "Session runtime agent id drifted from requested installer target.",
      repairable: false,
      expected: expectation.agentId,
      actual: runtime.agentId,
    });
  }

  if (runtime.pluginId !== SESSION_RUNTIME_PLUGIN_ID) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: "Session runtime plugin id drifted from installer-owned value.",
      repairable: true,
      expected: SESSION_RUNTIME_PLUGIN_ID,
      actual: runtime.pluginId,
    });
  }

  if (
    runtime.pluginEnabledConfigPath !== SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH
  ) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message:
        "Session runtime plugin enablement config path drifted from installer-owned value.",
      repairable: true,
      expected: SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH,
      actual: runtime.pluginEnabledConfigPath,
    });
  }

  if (!runtime.pluginEnabled) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: "Session runtime pluginEnabled must remain true in manifest ownership metadata.",
      repairable: true,
      expected: "true",
      actual: String(runtime.pluginEnabled),
    });
  }

  if (!areStringArraysEqual(runtime.canonicalToolNames, expectedCanonicalTools)) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: "Session runtime canonical tool names drifted from installer contract.",
      repairable: true,
      expected: JSON.stringify(expectedCanonicalTools),
      actual: JSON.stringify(runtime.canonicalToolNames),
    });
  }

  const pathExpectations: Array<{
    label: string;
    expected: string;
    actual: string;
    scopeRoot: string;
  }> = [
    {
      label: "pluginRoot",
      expected: expectedPaths.pluginRoot,
      actual: runtime.pluginRoot,
      scopeRoot: manifest.workspacePath,
    },
    {
      label: "pluginIndexFile",
      expected: expectedPaths.pluginIndexFile,
      actual: runtime.pluginIndexFile,
      scopeRoot: manifest.workspacePath,
    },
    {
      label: "pluginManifestFile",
      expected: expectedPaths.pluginManifestFile,
      actual: runtime.pluginManifestFile,
      scopeRoot: manifest.workspacePath,
    },
  ];

  for (const expectation of pathExpectations) {
    if (!arePathsEquivalent(expectation.expected, expectation.actual)) {
      driftItems.push({
        kind: "session_runtime_hash_drift",
        message: `Session runtime ${expectation.label} drifted from deterministic installer path.`,
        repairable: true,
        expected: expectation.expected,
        actual: expectation.actual,
      });
    }

    if (!isPathInside(expectation.scopeRoot, expectation.actual)) {
      driftItems.push({
        kind: "unknown_ownership",
        message:
          `Session runtime ${expectation.label} points outside workspace ownership scope: ${expectation.actual}`,
        repairable: false,
      });
    }
  }

  if (
    !isPathInside(manifest.repoRoot, runtime.sourcePluginEntrypoint) ||
    !isPathInside(manifest.repoRoot, runtime.sourcePluginManifestPath)
  ) {
    driftItems.push({
      kind: "unknown_ownership",
      message: "Session runtime source plugin paths point outside repo ownership scope.",
      repairable: false,
    });
  }

  validateSessionRuntimeRootPath(runtime, driftItems);
  validateSessionRuntimeFile(
    runtime.pluginIndexFile,
    runtime.pluginIndexContentHash,
    "plugin index",
    driftItems
  );
  validateSessionRuntimeFile(
    runtime.pluginManifestFile,
    runtime.pluginManifestContentHash,
    "plugin manifest",
    driftItems
  );
  validateSessionRuntimeFile(
    runtime.sourcePluginEntrypoint,
    runtime.sourcePluginEntrypointHash,
    "source plugin entrypoint",
    driftItems
  );
  validateSessionRuntimeFile(
    runtime.sourcePluginManifestPath,
    runtime.sourcePluginManifestHash,
    "source plugin manifest",
    driftItems
  );

  const expectedRenderedIndexHash = renderSessionRuntimePluginIndex({
    sourcePluginEntrypoint: runtime.sourcePluginEntrypoint,
    kbRoot: runtime.kbRoot,
  }).contentHash;
  if (runtime.pluginIndexContentHash !== expectedRenderedIndexHash) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: "Session runtime plugin index hash drifted from deterministic renderer output.",
      repairable: true,
      expected: expectedRenderedIndexHash,
      actual: runtime.pluginIndexContentHash,
    });
  }

  const expectedRenderedManifestHash = renderSessionRuntimePluginManifest({
    sourcePluginManifestPath: runtime.sourcePluginManifestPath,
    canonicalToolNames: runtime.canonicalToolNames,
  }).contentHash;
  if (runtime.pluginManifestContentHash !== expectedRenderedManifestHash) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: "Session runtime plugin manifest hash drifted from deterministic renderer output.",
      repairable: true,
      expected: expectedRenderedManifestHash,
      actual: runtime.pluginManifestContentHash,
    });
  }
}

function validateSessionRuntimeRootPath(
  runtime: InstallerSessionRuntimeMetadata,
  driftItems: InstallerDriftItem[]
): void {
  if (!fs.existsSync(runtime.pluginRoot)) {
    driftItems.push({
      kind: "missing_session_runtime",
      message: `Session runtime plugin root is missing: ${runtime.pluginRoot}`,
      repairable: true,
    });
    return;
  }

  const pluginRootLstat = fs.lstatSync(runtime.pluginRoot);
  if (pluginRootLstat.isSymbolicLink()) {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Session runtime plugin root must not be symlinked: ${runtime.pluginRoot}`,
      repairable: false,
    });
    return;
  }

  if (!pluginRootLstat.isDirectory()) {
    driftItems.push({
      kind: "missing_session_runtime",
      message: `Session runtime plugin root is not a directory: ${runtime.pluginRoot}`,
      repairable: true,
    });
  }
}

function validateSessionRuntimeFile(
  filePath: string,
  expectedHash: string,
  label: string,
  driftItems: InstallerDriftItem[]
): void {
  if (!isHexSha256(expectedHash)) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: `Session runtime ${label} hash metadata is not a valid sha256 digest.`,
      repairable: true,
      actual: expectedHash,
    });
  }

  if (!fs.existsSync(filePath)) {
    driftItems.push({
      kind: "missing_session_runtime",
      message: `Session runtime ${label} file is missing: ${filePath}`,
      repairable: true,
    });
    return;
  }

  const fileLstat = fs.lstatSync(filePath);
  if (fileLstat.isSymbolicLink()) {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Session runtime ${label} file must not be symlinked: ${filePath}`,
      repairable: false,
    });
    return;
  }

  if (!fileLstat.isFile()) {
    driftItems.push({
      kind: "missing_session_runtime",
      message: `Session runtime ${label} path is not a regular file: ${filePath}`,
      repairable: true,
    });
    return;
  }

  const diskHash = sha256(fs.readFileSync(filePath, "utf8"));
  if (diskHash !== expectedHash) {
    driftItems.push({
      kind: "session_runtime_hash_drift",
      message: `Session runtime ${label} hash drift detected on disk.`,
      repairable: true,
      expected: expectedHash,
      actual: diskHash,
    });
  }
}

function validateOwnershipRoots(
  manifest: InstallerManifest,
  expectation: InstallerManifestOwnershipExpectation,
  driftItems: InstallerDriftItem[]
): void {
  if (
    expectation.repoRoot &&
    !arePathsEquivalent(expectation.repoRoot, manifest.repoRoot)
  ) {
    driftItems.push({
      kind: "unknown_ownership",
      message: "Manifest repo root does not match the expected repo root.",
      repairable: false,
      expected: path.resolve(expectation.repoRoot),
      actual: manifest.repoRoot,
    });
  }

  if (
    expectation.workspacePath &&
    !arePathsEquivalent(expectation.workspacePath, manifest.workspacePath)
  ) {
    driftItems.push({
      kind: "unknown_ownership",
      message: "Manifest workspace path does not match the expected workspace path.",
      repairable: false,
      expected: path.resolve(expectation.workspacePath),
      actual: manifest.workspacePath,
    });
  }

  if (expectation.kbRoot && !arePathsEquivalent(expectation.kbRoot, manifest.kbRoot)) {
    driftItems.push({
      kind: "unknown_ownership",
      message: "Manifest KB root does not match the expected KB root.",
      repairable: false,
      expected: path.resolve(expectation.kbRoot),
      actual: manifest.kbRoot,
    });
  }

  if (expectation.mcpName && expectation.mcpName !== manifest.mcpName) {
    driftItems.push({
      kind: "mcp_config_drift",
      message: "Manifest MCP name differs from the expected MCP name.",
      repairable: true,
      expected: expectation.mcpName,
      actual: manifest.mcpName,
    });
  }
}

function validateMcpExpectation(
  manifest: InstallerManifest,
  expectation: InstallerManifestOwnershipExpectation,
  driftItems: InstallerDriftItem[]
): void {
  if (!expectation.expectedMcpConfig) {
    return;
  }

  const expected = normalizeExpectedMcpConfig(expectation.expectedMcpConfig);
  const actual = normalizeExpectedMcpConfig(manifest.expectedMcpConfig);

  if (
    expected.name !== actual.name ||
    expected.command !== actual.command ||
    !areStringArraysEqual(expected.args, actual.args) ||
    !areStringMapEqual(expected.env, actual.env)
  ) {
    driftItems.push({
      kind: "mcp_config_drift",
      message: "Manifest expected MCP config does not match the caller expectation.",
      repairable: true,
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual),
    });
  }
}

function validateSkillProvenance(
  manifest: InstallerManifest,
  driftItems: InstallerDriftItem[]
): void {
  if (manifest.installedSkills.length === 0) {
    driftItems.push({
      kind: "missing_skill",
      message: "Manifest contains no installed skill entries.",
      repairable: true,
    });
  }

  const entriesBySkill = new Map<string, InstallerSkillInstallationMetadata>();
  const seen = new Set<string>();

  for (const skill of manifest.installedSkills) {
    if (seen.has(skill.skillName)) {
      driftItems.push({
        kind: "other",
        message: `Duplicate installed skill entry in manifest: ${skill.skillName}`,
        repairable: true,
      });
      continue;
    }
    seen.add(skill.skillName);
    entriesBySkill.set(skill.skillName, skill);

    const expectedSourcePath = EXPECTED_SOURCE_TEMPLATE_PATHS[skill.skillName];
    if (!expectedSourcePath) {
      driftItems.push({
        kind: "unknown_ownership",
        message: `Manifest includes an unknown skill entry not owned by this installer: ${skill.skillName}`,
        repairable: false,
      });
      continue;
    }
  }

  const expectedSkillSet = new Set<string>(OPENCLAW_SKILL_NAMES);
  for (const expectedSkillName of OPENCLAW_SKILL_NAMES) {
    if (!entriesBySkill.has(expectedSkillName)) {
      driftItems.push({
        kind: "missing_skill",
        message: `Manifest is missing installer-owned skill entry: ${expectedSkillName}`,
        repairable: true,
      });
    }
  }

  for (const entryName of entriesBySkill.keys()) {
    if (!expectedSkillSet.has(entryName)) {
      driftItems.push({
        kind: "unknown_ownership",
        message: `Manifest includes non-installer-owned skill entry: ${entryName}`,
        repairable: false,
      });
    }
  }

  for (const expectedSkillName of OPENCLAW_SKILL_NAMES) {
    const skill = entriesBySkill.get(expectedSkillName);
    if (!skill) {
      continue;
    }
    validateSingleSkillEntry(manifest, skill, driftItems);
  }
}

function validateWorkspaceDocMetadata(
  manifest: InstallerManifest,
  driftItems: InstallerDriftItem[]
): void {
  validateWorkspaceDocWorkspaceRootPath(manifest, driftItems);

  const entriesByDocName = new Map<
    InstallerWorkspaceDocName,
    InstallerWorkspaceDocInstallationMetadata
  >();
  const seen = new Set<InstallerWorkspaceDocName>();

  for (const doc of manifest.installedWorkspaceDocs) {
    if (seen.has(doc.docName)) {
      driftItems.push({
        kind: "workspace_doc_hash_drift",
        message: `Duplicate installed workspace-doc entry in manifest: ${doc.docName}`,
        repairable: true,
      });
      continue;
    }
    seen.add(doc.docName);
    entriesByDocName.set(doc.docName, doc);
  }

  for (const expectedDocName of INSTALLER_WORKSPACE_DOC_NAMES) {
    const doc = entriesByDocName.get(expectedDocName);
    if (!doc) {
      driftItems.push({
        kind: "workspace_doc_hash_drift",
        message: `Manifest is missing installer-owned workspace doc entry: ${expectedDocName}`,
        repairable: true,
      });
      continue;
    }

    validateSingleWorkspaceDocEntry(manifest, doc, driftItems);
  }
}

function validateWorkspaceDocWorkspaceRootPath(
  manifest: InstallerManifest,
  driftItems: InstallerDriftItem[]
): void {
  if (!fs.existsSync(manifest.workspacePath)) {
    return;
  }

  const workspaceLstat = fs.lstatSync(manifest.workspacePath);
  if (workspaceLstat.isSymbolicLink()) {
    driftItems.push({
      kind: "unknown_ownership",
      message:
        `Workspace root must not be a symlink for installer-managed workspace docs: ${manifest.workspacePath}`,
      repairable: false,
    });
  }
}

function validateSingleWorkspaceDocEntry(
  manifest: InstallerManifest,
  doc: InstallerWorkspaceDocInstallationMetadata,
  driftItems: InstallerDriftItem[]
): void {
  const expectedDocFile = path.resolve(manifest.workspacePath, doc.docName);

  if (!arePathsEquivalent(doc.docFile, expectedDocFile)) {
    driftItems.push({
      kind: "workspace_doc_hash_drift",
      message: `Workspace doc ${doc.docName} docFile differs from expected installer location.`,
      repairable: true,
      expected: expectedDocFile,
      actual: doc.docFile,
    });
  }

  if (!isPathInside(manifest.workspacePath, doc.docFile)) {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Workspace doc ${doc.docName} path metadata points outside workspace ownership scope.`,
      repairable: false,
    });
  }

  if (!isHexSha256(doc.contentHash)) {
    driftItems.push({
      kind: "workspace_doc_hash_drift",
      message: `Workspace doc ${doc.docName} contentHash is not a valid sha256 hex digest.`,
      repairable: true,
      actual: doc.contentHash,
    });
  }

  validateWorkspaceDocPreinstallSnapshot(doc, driftItems);

  if (!fs.existsSync(doc.docFile)) {
    driftItems.push({
      kind: "missing_workspace_doc",
      message: `Workspace doc missing on disk for ${doc.docName}: ${doc.docFile}`,
      repairable: true,
    });
    return;
  }

  const docLstat = fs.lstatSync(doc.docFile);
  if (docLstat.isSymbolicLink()) {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Workspace doc ${doc.docName} must not be symlinked: ${doc.docFile}`,
      repairable: false,
    });
    return;
  }

  if (!docLstat.isFile()) {
    driftItems.push({
      kind: "missing_workspace_doc",
      message: `Workspace doc path is not a regular file for ${doc.docName}: ${doc.docFile}`,
      repairable: true,
    });
    return;
  }

  try {
    const expectedRenderedDoc = renderOpenClawWorkspaceDoc({
      docName: doc.docName,
    });

    if (doc.contentHash !== expectedRenderedDoc.contentHash) {
      driftItems.push({
        kind: "workspace_doc_hash_drift",
        message: `Workspace doc ${doc.docName} contentHash does not match deterministic renderer output.`,
        repairable: true,
        expected: expectedRenderedDoc.contentHash,
        actual: doc.contentHash,
      });
    }
  } catch (error) {
    driftItems.push({
      kind: "other",
      message: `Unable to render expected workspace doc ${doc.docName}: ${stringifyError(error)}`,
      repairable: true,
    });
  }
}

function validateWorkspaceDocPreinstallSnapshot(
  doc: InstallerWorkspaceDocInstallationMetadata,
  driftItems: InstallerDriftItem[]
): void {
  if (!doc.preinstallSnapshot.known) {
    return;
  }

  if (!doc.preinstallSnapshot.existed) {
    return;
  }

  if (!isHexSha256(doc.preinstallSnapshot.contentHash)) {
    driftItems.push({
      kind: "workspace_doc_hash_drift",
      message: `Workspace doc ${doc.docName} preinstall snapshot hash is invalid.`,
      repairable: true,
      actual: doc.preinstallSnapshot.contentHash,
    });
    return;
  }

  const calculatedSnapshotHash = sha256(doc.preinstallSnapshot.content);
  if (calculatedSnapshotHash !== doc.preinstallSnapshot.contentHash) {
    driftItems.push({
      kind: "workspace_doc_hash_drift",
      message: `Workspace doc ${doc.docName} preinstall snapshot content/hash mismatch.`,
      repairable: true,
      expected: calculatedSnapshotHash,
      actual: doc.preinstallSnapshot.contentHash,
    });
  }
}

function validateSingleSkillEntry(
  manifest: InstallerManifest,
  skill: InstallerSkillInstallationMetadata,
  driftItems: InstallerDriftItem[]
): void {
  const expectedSourcePath = EXPECTED_SOURCE_TEMPLATE_PATHS[skill.skillName];
  if (!expectedSourcePath) {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Skill ${skill.skillName} has no known source template mapping.`,
      repairable: false,
    });
    return;
  }

  const expectedInstallDir = path.resolve(manifest.workspacePath, "skills", skill.skillName);
  const expectedSkillFile = path.resolve(expectedInstallDir, "SKILL.md");

  if (!arePathsEquivalent(skill.installDir, expectedInstallDir)) {
    driftItems.push({
      kind: "skill_hash_drift",
      message: `Skill ${skill.skillName} installDir differs from expected installer location.`,
      repairable: true,
      expected: expectedInstallDir,
      actual: skill.installDir,
    });
  }

  if (!arePathsEquivalent(skill.skillFile, expectedSkillFile)) {
    driftItems.push({
      kind: "skill_hash_drift",
      message: `Skill ${skill.skillName} skillFile differs from expected installer location.`,
      repairable: true,
      expected: expectedSkillFile,
      actual: skill.skillFile,
    });
  }

  if (
    !isPathInside(manifest.workspacePath, skill.installDir) ||
    !isPathInside(manifest.workspacePath, skill.skillFile)
  ) {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Skill ${skill.skillName} path metadata points outside workspace ownership scope.`,
      repairable: false,
    });
  }

  if (!isHexSha256(skill.contentHash)) {
    driftItems.push({
      kind: "skill_hash_drift",
      message: `Skill ${skill.skillName} contentHash is not a valid sha256 hex digest.`,
      repairable: true,
      actual: skill.contentHash,
    });
  }

  if (skill.variantSet !== "openclaw-adapted-v1") {
    driftItems.push({
      kind: "skill_hash_drift",
      message: `Skill ${skill.skillName} variantSet drifted from expected installer variant.`,
      repairable: true,
      expected: "openclaw-adapted-v1",
      actual: String(skill.variantSet),
    });
  }

  if (skill.sourceProvenance.sourceKind !== "repo-skill-template") {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Skill ${skill.skillName} has unsupported source provenance kind: ${skill.sourceProvenance.sourceKind}`,
      repairable: false,
    });
  }

  if (skill.sourceProvenance.sourceSkillName !== skill.skillName) {
    driftItems.push({
      kind: "unknown_ownership",
      message: `Skill ${skill.skillName} source provenance does not match ownership metadata.`,
      repairable: false,
      expected: skill.skillName,
      actual: skill.sourceProvenance.sourceSkillName,
    });
  }

  if (skill.sourceProvenance.sourceRelativePath !== expectedSourcePath) {
    driftItems.push({
      kind: "skill_hash_drift",
      message: `Skill ${skill.skillName} source template path drifted from expected value.`,
      repairable: true,
      expected: expectedSourcePath,
      actual: skill.sourceProvenance.sourceRelativePath,
    });
  }

  const sourceContentHash = skill.sourceProvenance.sourceContentHash;
  if (!sourceContentHash || !isHexSha256(sourceContentHash)) {
    driftItems.push({
      kind: "skill_hash_drift",
      message: `Skill ${skill.skillName} has missing or invalid sourceContentHash provenance metadata.`,
      repairable: true,
      actual: sourceContentHash,
    });
  } else {
    const templatePath = path.resolve(manifest.repoRoot, expectedSourcePath);
    if (!fs.existsSync(templatePath) || !fs.statSync(templatePath).isFile()) {
      driftItems.push({
        kind: "other",
        message: `Cannot validate sourceContentHash for ${skill.skillName}; source template is missing: ${templatePath}`,
        repairable: true,
      });
    } else {
      const templateHash = sha256(normalizeTextFile(fs.readFileSync(templatePath, "utf8")));
      if (sourceContentHash !== templateHash) {
        driftItems.push({
          kind: "skill_hash_drift",
          message: `Skill ${skill.skillName} sourceContentHash does not match current source template content.`,
          repairable: true,
          expected: templateHash,
          actual: sourceContentHash,
        });
      }
    }
  }

  try {
    const expectedRenderedSkill = renderOpenClawSkill({
      repoRoot: manifest.repoRoot,
      skillName: skill.skillName as OpenClawSkillName,
    });

    if (skill.contentHash !== expectedRenderedSkill.contentHash) {
      driftItems.push({
        kind: "skill_hash_drift",
        message: `Skill ${skill.skillName} contentHash does not match expected adapted renderer output.`,
        repairable: true,
        expected: expectedRenderedSkill.contentHash,
        actual: skill.contentHash,
      });
    }
  } catch (error) {
    driftItems.push({
      kind: "other",
      message: `Unable to render expected adapted skill for ${skill.skillName}: ${stringifyError(error)}`,
      repairable: true,
    });
  }

  if (!fs.existsSync(skill.skillFile)) {
    driftItems.push({
      kind: "missing_skill",
      message: `Skill file missing on disk for ${skill.skillName}: ${skill.skillFile}`,
      repairable: true,
    });
    return;
  }

  const skillFileStat = fs.statSync(skill.skillFile);
  if (!skillFileStat.isFile()) {
    driftItems.push({
      kind: "missing_skill",
      message: `Skill path is not a regular file for ${skill.skillName}: ${skill.skillFile}`,
      repairable: true,
    });
    return;
  }

  const diskContentHash = sha256(fs.readFileSync(skill.skillFile, "utf8"));
  if (skill.contentHash !== diskContentHash) {
    driftItems.push({
      kind: "skill_hash_drift",
      message: `Skill ${skill.skillName} contentHash does not match on-disk SKILL.md content.`,
      repairable: true,
      expected: diskContentHash,
      actual: skill.contentHash,
    });
  }
}

function parseInstallerManifest(value: unknown): InstallerManifest {
  if (!isRecord(value)) {
    throw new Error("Installer manifest must be a JSON object.");
  }

  const schemaVersion = readLiteralNumber(value.schemaVersion, "schemaVersion");
  if (schemaVersion !== 1) {
    throw new Error(`Unsupported installer manifest schemaVersion: ${schemaVersion}`);
  }

  const installedSkillsRaw = readArray(value.installedSkills, "installedSkills");
  const installedSkills = installedSkillsRaw.map((entry, index) =>
    parseInstallerSkillEntry(entry, `installedSkills[${index}]`)
  );
  const installedWorkspaceDocs = parseWorkspaceDocsArray(
    value.installedWorkspaceDocs
  );
  const repoRoot = readString(value.repoRoot, "repoRoot");
  const workspacePath = readString(value.workspacePath, "workspacePath");
  const installedAt = readString(value.installedAt, "installedAt");
  const kbRoot = readString(value.kbRoot, "kbRoot");

  const parsed: InstallerManifest = {
    schemaVersion: 1,
    installerVersion: readString(value.installerVersion, "installerVersion"),
    repoRoot,
    workspacePath,
    kbRoot,
    mcpName: readString(value.mcpName, "mcpName"),
    installedAt,
    skillVariantSet: "openclaw-adapted-v1",
    installedSkills,
    installedWorkspaceDocs,
    sessionRuntime:
      value.sessionRuntime === undefined
        ? undefined
        : parseSessionRuntimeMetadata(value.sessionRuntime, "sessionRuntime", {
            repoRoot,
            workspacePath,
            kbRoot,
            installedAt,
          }),
    expectedMcpConfig: parseExpectedMcpConfig(value.expectedMcpConfig, "expectedMcpConfig"),
    lastSuccessfulProbe:
      value.lastSuccessfulProbe === undefined
        ? undefined
        : parseProbeSnapshot(value.lastSuccessfulProbe, "lastSuccessfulProbe"),
    lastSuccessfulSessionProbe:
      value.lastSuccessfulSessionProbe === undefined
        ? undefined
        : parseProbeSnapshot(
            value.lastSuccessfulSessionProbe,
            "lastSuccessfulSessionProbe"
          ),
  };

  if (value.skillVariantSet !== undefined && value.skillVariantSet !== "openclaw-adapted-v1") {
    throw new Error(
      `Unsupported skillVariantSet: ${String(value.skillVariantSet)}`
    );
  }

  return parsed;
}

function parseInstallerSkillEntry(
  value: unknown,
  label: string
): InstallerSkillInstallationMetadata {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const sourceProvenance = parseSourceProvenance(
    value.sourceProvenance,
    `${label}.sourceProvenance`
  );

  return {
    skillName: readString(value.skillName, `${label}.skillName`),
    installDir: readString(value.installDir, `${label}.installDir`),
    skillFile: readString(value.skillFile, `${label}.skillFile`),
    contentHash: readString(value.contentHash, `${label}.contentHash`),
    installedAt: readString(value.installedAt, `${label}.installedAt`),
    variantSet: readString(
      value.variantSet,
      `${label}.variantSet`
    ) as InstallerSkillInstallationMetadata["variantSet"],
    sourceProvenance,
  };
}

function parseWorkspaceDocsArray(
  value: unknown
): InstallerWorkspaceDocInstallationMetadata[] {
  if (value === undefined) {
    // Backward-compatible parsing for older manifests that predate
    // installedWorkspaceDocs. Validation will report this as repairable drift.
    return [];
  }

  const installedWorkspaceDocsRaw = readArray(
    value,
    "installedWorkspaceDocs"
  );

  return installedWorkspaceDocsRaw.map((entry, index) =>
    parseWorkspaceDocEntry(entry, `installedWorkspaceDocs[${index}]`)
  );
}

function parseWorkspaceDocEntry(
  value: unknown,
  label: string
): InstallerWorkspaceDocInstallationMetadata {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return {
    docName: readWorkspaceDocName(value.docName, `${label}.docName`),
    docFile: readString(value.docFile, `${label}.docFile`),
    contentHash: readString(value.contentHash, `${label}.contentHash`),
    installedAt: readString(value.installedAt, `${label}.installedAt`),
    preinstallSnapshot: parseWorkspaceDocPreinstallSnapshot(
      value.preinstallSnapshot,
      `${label}.preinstallSnapshot`
    ),
  };
}

function parseWorkspaceDocPreinstallSnapshot(
  value: unknown,
  label: string
): InstallerWorkspaceDocInstallationMetadata["preinstallSnapshot"] {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  if (value.known !== undefined) {
    const known = readBoolean(value.known, `${label}.known`);
    if (!known) {
      return { known: false };
    }

    const existed = readBoolean(value.existed, `${label}.existed`);
    if (!existed) {
      return {
        known: true,
        existed: false,
      };
    }

    return {
      known: true,
      existed: true,
      content: readStringAllowEmpty(value.content, `${label}.content`),
      contentHash: readString(value.contentHash, `${label}.contentHash`),
    };
  }

  // Backward-compatible parsing for manifests written before explicit snapshot-known state.
  const existed = readBoolean(value.existed, `${label}.existed`);
  if (!existed) {
    return {
      known: true,
      existed: false,
    };
  }

  return {
    known: true,
    existed: true,
    content: readStringAllowEmpty(value.content, `${label}.content`),
    contentHash: readString(value.contentHash, `${label}.contentHash`),
  };
}

function readWorkspaceDocName(value: unknown, label: string): InstallerWorkspaceDocName {
  const docName = readString(value, label);
  if (!isInstallerWorkspaceDocName(docName)) {
    throw new Error(`${label} must be one of: ${INSTALLER_WORKSPACE_DOC_NAMES.join(", ")}`);
  }
  return docName;
}

function parseSessionRuntimeMetadata(
  value: unknown,
  label: string,
  context: {
    repoRoot: string;
    workspacePath: string;
    kbRoot: string;
    installedAt: string;
  }
): InstallerSessionRuntimeMetadata {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const fallbackPaths = resolveSessionRuntimeArtifactPaths(context.workspacePath);
  const fallbackSourcePluginEntrypoint = path.resolve(
    context.repoRoot,
    "dist",
    "openclaw_plugin.js"
  );
  const fallbackSourcePluginManifestPath = path.resolve(
    context.repoRoot,
    "openclaw.plugin.json"
  );

  const runtimeKind = readStringWithDefault(
    value.runtimeKind,
    `${label}.runtimeKind`,
    "workspace-openclaw-native-plugin-shim-v1"
  );
  if (runtimeKind !== "workspace-openclaw-native-plugin-shim-v1") {
    throw new Error(`${label}.runtimeKind must be "workspace-openclaw-native-plugin-shim-v1".`);
  }

  const agentId = readStringWithDefault(
    value.agentId,
    `${label}.agentId`,
    SESSION_RUNTIME_AGENT_ID
  );
  if (agentId.length === 0) {
    throw new Error(`${label}.agentId must not be empty.`);
  }

  const pluginId = readStringWithDefault(
    value.pluginId,
    `${label}.pluginId`,
    SESSION_RUNTIME_PLUGIN_ID
  );
  if (pluginId !== SESSION_RUNTIME_PLUGIN_ID) {
    throw new Error(`${label}.pluginId must be "${SESSION_RUNTIME_PLUGIN_ID}".`);
  }

  const pluginEnabledConfigPath = readStringWithDefault(
    value.pluginEnabledConfigPath,
    `${label}.pluginEnabledConfigPath`,
    SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH
  );
  if (pluginEnabledConfigPath !== SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH) {
    throw new Error(
      `${label}.pluginEnabledConfigPath must be "${SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH}".`
    );
  }

  const pluginEnabled = readBooleanWithDefault(
    value.pluginEnabled,
    `${label}.pluginEnabled`,
    true
  );
  if (!pluginEnabled) {
    throw new Error(`${label}.pluginEnabled must be true.`);
  }

  const pluginRoot = readStringWithDefault(
    value.pluginRoot,
    `${label}.pluginRoot`,
    fallbackPaths.pluginRoot
  );
  const pluginIndexFile = readStringWithDefault(
    value.pluginIndexFile,
    `${label}.pluginIndexFile`,
    fallbackPaths.pluginIndexFile
  );
  const pluginManifestFile = readStringWithDefault(
    value.pluginManifestFile,
    `${label}.pluginManifestFile`,
    fallbackPaths.pluginManifestFile
  );
  const sourcePluginEntrypoint = readStringWithDefault(
    value.sourcePluginEntrypoint,
    `${label}.sourcePluginEntrypoint`,
    fallbackSourcePluginEntrypoint
  );
  const sourcePluginManifestPath = readStringWithDefault(
    value.sourcePluginManifestPath,
    `${label}.sourcePluginManifestPath`,
    fallbackSourcePluginManifestPath
  );
  const kbRoot = path.resolve(
    readStringWithDefault(value.kbRoot, `${label}.kbRoot`, context.kbRoot)
  );

  const canonicalToolNames =
    value.canonicalToolNames === undefined
      ? [...KB_CANONICAL_TOOL_NAMES]
      : readStringArray(value.canonicalToolNames, `${label}.canonicalToolNames`);
  const normalizedToolNames = [...new Set(canonicalToolNames)].sort((a, b) =>
    a.localeCompare(b)
  );

  const pluginIndexContentHash = readOptionalSha256String(
    value.pluginIndexContentHash,
    `${label}.pluginIndexContentHash`
  ) ?? deriveFallbackPluginIndexHash(sourcePluginEntrypoint, kbRoot);
  const pluginManifestContentHash = readOptionalSha256String(
    value.pluginManifestContentHash,
    `${label}.pluginManifestContentHash`
  ) ?? deriveFallbackPluginManifestHash(sourcePluginManifestPath, normalizedToolNames);
  const sourcePluginEntrypointHash = readOptionalSha256String(
    value.sourcePluginEntrypointHash,
    `${label}.sourcePluginEntrypointHash`
  ) ?? hashFileIfPossible(sourcePluginEntrypoint);
  const sourcePluginManifestHash = readOptionalSha256String(
    value.sourcePluginManifestHash,
    `${label}.sourcePluginManifestHash`
  ) ?? hashFileIfPossible(sourcePluginManifestPath);

  return {
    runtimeKind: "workspace-openclaw-native-plugin-shim-v1",
    agentId,
    pluginId: SESSION_RUNTIME_PLUGIN_ID,
    pluginRoot,
    pluginIndexFile,
    pluginIndexContentHash,
    pluginManifestFile,
    pluginManifestContentHash,
    pluginEnabledConfigPath: SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH,
    pluginEnabled: true,
    kbRoot,
    sourcePluginEntrypoint,
    sourcePluginEntrypointHash,
    sourcePluginManifestPath,
    sourcePluginManifestHash,
    canonicalToolNames: normalizedToolNames,
    installedAt: readStringWithDefault(value.installedAt, `${label}.installedAt`, context.installedAt),
  };
}

function parseSourceProvenance(
  value: unknown,
  label: string
): InstallerSkillInstallationMetadata["sourceProvenance"] {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const sourceKind = readString(value.sourceKind, `${label}.sourceKind`);
  if (sourceKind !== "repo-skill-template") {
    throw new Error(`${label}.sourceKind must be "repo-skill-template".`);
  }

  const sourceContentHashRaw = value.sourceContentHash;
  return {
    sourceKind: "repo-skill-template",
    sourceSkillName: readString(value.sourceSkillName, `${label}.sourceSkillName`),
    sourceRelativePath: readString(value.sourceRelativePath, `${label}.sourceRelativePath`),
    sourceContentHash:
      sourceContentHashRaw === undefined
        ? undefined
        : readString(sourceContentHashRaw, `${label}.sourceContentHash`),
  };
}

function parseExpectedMcpConfig(
  value: unknown,
  label: string
): InstallerExpectedMcpConfig {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const envRaw = value.env;
  const env = parsePlainStringMap(envRaw, `${label}.env`);

  return {
    name: readString(value.name, `${label}.name`),
    command: readString(value.command, `${label}.command`),
    args: readStringArray(value.args, `${label}.args`),
    env,
  };
}

function parseProbeSnapshot(value: unknown, label: string): InstallerProbeSnapshot {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const snapshot: InstallerProbeSnapshot = {
    checkedAt: readString(value.checkedAt, `${label}.checkedAt`),
    ok: readBoolean(value.ok, `${label}.ok`),
    toolNames: readStringArray(value.toolNames, `${label}.toolNames`),
  };

  if (value.failureReason !== undefined) {
    snapshot.failureReason = readString(value.failureReason, `${label}.failureReason`);
  }

  return snapshot;
}

function normalizeInstallerManifest(manifest: InstallerManifest): InstallerManifest {
  const installedSkills = [...manifest.installedSkills]
    .map((entry) => ({
      skillName: entry.skillName,
      installDir: path.resolve(entry.installDir),
      skillFile: path.resolve(entry.skillFile),
      contentHash: entry.contentHash,
      installedAt: entry.installedAt,
      variantSet: entry.variantSet,
      sourceProvenance: {
        sourceKind: "repo-skill-template" as const,
        sourceSkillName: entry.sourceProvenance.sourceSkillName,
        sourceRelativePath: entry.sourceProvenance.sourceRelativePath,
        sourceContentHash: entry.sourceProvenance.sourceContentHash,
      },
    }))
    .sort((left, right) => left.skillName.localeCompare(right.skillName));

  const installedWorkspaceDocs = [...manifest.installedWorkspaceDocs]
    .map((entry) => ({
      docName: entry.docName,
      docFile: path.resolve(entry.docFile),
      contentHash: entry.contentHash,
      installedAt: entry.installedAt,
      preinstallSnapshot: !entry.preinstallSnapshot.known
        ? { known: false as const }
        : entry.preinstallSnapshot.existed
        ? {
            known: true as const,
            existed: true as const,
            content: entry.preinstallSnapshot.content,
            contentHash: entry.preinstallSnapshot.contentHash,
          }
        : {
            known: true as const,
            existed: false as const,
          },
    }))
    .sort((left, right) => left.docName.localeCompare(right.docName));

  const sessionRuntime = manifest.sessionRuntime
    ? normalizeSessionRuntimeMetadata(manifest.sessionRuntime)
    : undefined;

  return {
    schemaVersion: 1,
    installerVersion: manifest.installerVersion,
    repoRoot: path.resolve(manifest.repoRoot),
    workspacePath: path.resolve(manifest.workspacePath),
    kbRoot: path.resolve(manifest.kbRoot),
    mcpName: manifest.mcpName,
    installedAt: manifest.installedAt,
    skillVariantSet: "openclaw-adapted-v1",
    installedSkills,
    installedWorkspaceDocs,
    sessionRuntime,
    expectedMcpConfig: normalizeExpectedMcpConfig(manifest.expectedMcpConfig),
    lastSuccessfulProbe: manifest.lastSuccessfulProbe
      ? {
          checkedAt: manifest.lastSuccessfulProbe.checkedAt,
          ok: manifest.lastSuccessfulProbe.ok,
          toolNames: [...manifest.lastSuccessfulProbe.toolNames].sort((a, b) =>
            a.localeCompare(b)
          ),
          failureReason: manifest.lastSuccessfulProbe.failureReason,
        }
      : undefined,
    lastSuccessfulSessionProbe: manifest.lastSuccessfulSessionProbe
      ? {
          checkedAt: manifest.lastSuccessfulSessionProbe.checkedAt,
          ok: manifest.lastSuccessfulSessionProbe.ok,
          toolNames: [...manifest.lastSuccessfulSessionProbe.toolNames].sort((a, b) =>
            a.localeCompare(b)
          ),
          failureReason: manifest.lastSuccessfulSessionProbe.failureReason,
        }
      : undefined,
  };
}

function normalizeSessionRuntimeMetadata(
  metadata: InstallerSessionRuntimeMetadata
): InstallerSessionRuntimeMetadata {
  return {
    runtimeKind: "workspace-openclaw-native-plugin-shim-v1",
    agentId: metadata.agentId,
    pluginId: "llmwiki-kb-tools",
    pluginRoot: path.resolve(metadata.pluginRoot),
    pluginIndexFile: path.resolve(metadata.pluginIndexFile),
    pluginIndexContentHash: metadata.pluginIndexContentHash,
    pluginManifestFile: path.resolve(metadata.pluginManifestFile),
    pluginManifestContentHash: metadata.pluginManifestContentHash,
    pluginEnabledConfigPath: "plugins.entries.llmwiki-kb-tools.enabled",
    pluginEnabled: true,
    kbRoot: path.resolve(metadata.kbRoot),
    sourcePluginEntrypoint: path.resolve(metadata.sourcePluginEntrypoint),
    sourcePluginEntrypointHash: metadata.sourcePluginEntrypointHash,
    sourcePluginManifestPath: path.resolve(metadata.sourcePluginManifestPath),
    sourcePluginManifestHash: metadata.sourcePluginManifestHash,
    canonicalToolNames: [...metadata.canonicalToolNames].sort((a, b) =>
      a.localeCompare(b)
    ),
    installedAt: metadata.installedAt,
  };
}

function normalizeExpectedMcpConfig(
  config: InstallerExpectedMcpConfig
): InstallerExpectedMcpConfig {
  const env = normalizePlainStringMap(config.env, "expectedMcpConfig.env");

  return {
    name: config.name,
    command: config.command,
    args: [...config.args],
    env,
  };
}

function serializeInstallerManifest(manifest: InstallerManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function arePathsEquivalent(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function areStringMapEqual(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (let index = 0; index < leftEntries.length; index += 1) {
    const [leftKey, leftValue] = leftEntries[index];
    const [rightKey, rightValue] = rightEntries[index];
    if (leftKey !== rightKey || leftValue !== rightValue) {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    result.push(readString(item, `${label}[${index}]`));
  }

  return result;
}

function readStringWithDefault(
  value: unknown,
  label: string,
  fallbackValue: string
): string {
  if (value === undefined) {
    return fallbackValue;
  }
  return readString(value, label);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function readStringAllowEmpty(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function readLiteralNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} must be a number.`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function readBooleanWithDefault(
  value: unknown,
  label: string,
  fallbackValue: boolean
): boolean {
  if (value === undefined) {
    return fallbackValue;
  }
  return readBoolean(value, label);
}

function readOptionalSha256String(
  value: unknown,
  label: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const digest = readString(value, label);
  if (!isHexSha256(digest)) {
    throw new Error(`${label} must be a sha256 hex digest.`);
  }
  return digest;
}

function deriveFallbackPluginIndexHash(sourcePluginEntrypoint: string, kbRoot?: string): string {
  return renderSessionRuntimePluginIndex({
    sourcePluginEntrypoint,
    kbRoot,
  }).contentHash;
}

function deriveFallbackPluginManifestHash(
  sourcePluginManifestPath: string,
  canonicalToolNames: readonly string[]
): string {
  return renderSessionRuntimePluginManifest({
    sourcePluginManifestPath,
    canonicalToolNames,
  }).contentHash;
}

function hashFileIfPossible(filePath: string): string {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sha256(fs.readFileSync(filePath, "utf8"));
  }

  return "0".repeat(64);
}

function parsePlainStringMap(value: unknown, label: string): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error(
      `${label} must be a plain object with string values.`
    );
  }

  const normalized = normalizePlainStringMap(value, label);
  return normalized;
}

function normalizePlainStringMap(value: unknown, label: string): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a plain object with string values.`);
  }

  const sortedEntries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of sortedEntries) {
    normalized[key] = readString(entryValue, `${label}.${key}`);
  }

  return normalized;
}

function isHexSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function isInstallerWorkspaceDocName(value: string): value is InstallerWorkspaceDocName {
  return INSTALLER_WORKSPACE_DOC_NAMES.includes(value as InstallerWorkspaceDocName);
}

function normalizeTextFile(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
