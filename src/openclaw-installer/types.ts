export const INSTALLER_COMMANDS = [
  "install",
  "check",
  "repair",
  "uninstall",
] as const;

export type InstallerCommandName = (typeof INSTALLER_COMMANDS)[number];

export const INSTALLER_DRIFT_ITEM_KINDS = [
  "missing_manifest",
  "workspace_mismatch",
  "missing_build_artifact",
  "missing_skill",
  "skill_hash_drift",
  "missing_workspace_doc",
  "workspace_doc_hash_drift",
  "missing_session_runtime",
  "session_runtime_hash_drift",
  "session_runtime_binding_failure",
  "session_runtime_probe_failure",
  "mcp_config_drift",
  "mcp_probe_failure",
  "unknown_ownership",
  "invalid_openclaw_cli",
  "manual_config_required",
  "other",
] as const;

export type InstallerDriftItemKind = (typeof INSTALLER_DRIFT_ITEM_KINDS)[number];

export const INSTALLER_REPAIR_ACTIONS = [
  "create_manifest",
  "rewrite_skill",
  "materialize_session_runtime",
  "enable_session_runtime",
  "backfill_session_runtime_metadata",
  "update_mcp_config",
  "rebuild_artifact",
  "reprobe_mcp",
  "manual_follow_up",
  "none",
] as const;

export type InstallerRepairAction = (typeof INSTALLER_REPAIR_ACTIONS)[number];

export interface InstallerCliCommonArgs {
  command: InstallerCommandName;
  mcpName: string;
  agentId: string;
}

export interface InstallCommandArgs extends InstallerCliCommonArgs {
  command: "install";
  workspace: string;
  kbRoot: string;
  force: boolean;
}

export interface CheckCommandArgs extends InstallerCliCommonArgs {
  command: "check";
  workspace: string;
  json: boolean;
}

export interface RepairCommandArgs extends InstallerCliCommonArgs {
  command: "repair";
  workspace: string;
  kbRoot?: string;
  force: boolean;
}

export interface UninstallCommandArgs extends InstallerCliCommonArgs {
  command: "uninstall";
  workspace: string;
  force: boolean;
}

export type ParsedInstallerArgs =
  | InstallCommandArgs
  | CheckCommandArgs
  | RepairCommandArgs
  | UninstallCommandArgs;

export interface ResolvedInstallerEnvironment {
  repoRoot: string;
  installerEntrypoint: string;
  mcpServerEntrypoint: string;
  openclawPluginEntrypoint: string;
  openclawPluginManifestPath: string;
  command: InstallerCommandName;
  workspace?: string;
  kbRoot?: string;
  mcpName: string;
  agentId: string;
}

export interface InstallerExpectedMcpConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const INSTALLER_WORKSPACE_DOC_NAMES = [
  "AGENTS.md",
  "HEARTBEAT.md",
  "TOOLS.md",
  "SOUL.md",
] as const;

export type InstallerWorkspaceDocName =
  (typeof INSTALLER_WORKSPACE_DOC_NAMES)[number];

export type InstallerSkillVariantSet = "openclaw-adapted-v1";

export interface InstallerSkillSourceProvenance {
  sourceKind: "repo-skill-template";
  sourceSkillName: string;
  sourceRelativePath: string;
  sourceContentHash?: string;
}

export interface InstallerProbeSnapshot {
  checkedAt: string;
  ok: boolean;
  toolNames: string[];
  failureReason?: string;
}

export interface InstallerSkillInstallationMetadata {
  skillName: string;
  installDir: string;
  skillFile: string;
  contentHash: string;
  installedAt: string;
  variantSet: InstallerSkillVariantSet;
  sourceProvenance: InstallerSkillSourceProvenance;
}

export interface InstallerSessionRuntimeMetadata {
  runtimeKind: "workspace-openclaw-native-plugin-shim-v1";
  agentId: string;
  pluginId: "llmwiki-kb-tools";
  pluginRoot: string;
  pluginIndexFile: string;
  pluginIndexContentHash: string;
  pluginManifestFile: string;
  pluginManifestContentHash: string;
  pluginEnabledConfigPath: string;
  pluginEnabled: true;
  kbRoot: string;
  sourcePluginEntrypoint: string;
  sourcePluginEntrypointHash: string;
  sourcePluginManifestPath: string;
  sourcePluginManifestHash: string;
  canonicalToolNames: string[];
  installedAt: string;
}

export type InstallerWorkspaceDocPreinstallSnapshot =
  | {
      known: false;
    }
  | {
      known: true;
      existed: false;
    }
  | {
      known: true;
      existed: true;
      content: string;
      contentHash: string;
    };

export interface InstallerWorkspaceDocInstallationMetadata {
  docName: InstallerWorkspaceDocName;
  docFile: string;
  contentHash: string;
  installedAt: string;
  preinstallSnapshot: InstallerWorkspaceDocPreinstallSnapshot;
}

export interface InstallerManifest {
  schemaVersion: 1;
  installerVersion: string;
  repoRoot: string;
  workspacePath: string;
  kbRoot: string;
  mcpName: string;
  installedAt: string;
  skillVariantSet: InstallerSkillVariantSet;
  installedSkills: InstallerSkillInstallationMetadata[];
  installedWorkspaceDocs: InstallerWorkspaceDocInstallationMetadata[];
  sessionRuntime?: InstallerSessionRuntimeMetadata;
  expectedMcpConfig: InstallerExpectedMcpConfig;
  lastSuccessfulProbe?: InstallerProbeSnapshot;
  lastSuccessfulSessionProbe?: InstallerProbeSnapshot;
}

export interface InstallerDriftItem {
  kind: InstallerDriftItemKind;
  message: string;
  repairable: boolean;
  expected?: string;
  actual?: string;
}

export interface InstallerCheckResult {
  ok: boolean;
  environment: ResolvedInstallerEnvironment;
  driftItems: InstallerDriftItem[];
  manifest?: InstallerManifest;
  lastProbe?: InstallerProbeSnapshot;
  lastSessionProbe?: InstallerProbeSnapshot;
}

export interface InstallerRepairOutcome {
  ok: boolean;
  environment: ResolvedInstallerEnvironment;
  appliedActions: InstallerRepairAction[];
  remainingDriftItems: InstallerDriftItem[];
  message: string;
}
