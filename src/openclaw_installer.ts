#!/usr/bin/env node

import * as path from "path";

import {
  InstallerCliUsageError,
  formatInstallerUsage,
  isParsedCheckJsonInvocation,
  parseInstallerArgs,
} from "./openclaw-installer/args";
import { checkOpenClawInstallation } from "./openclaw-installer/check";
import { installOpenClawIntegration } from "./openclaw-installer/install";
import { repairOpenClawIntegration } from "./openclaw-installer/repair";
import { uninstallOpenClawIntegration } from "./openclaw-installer/uninstall";
import type {
  CheckCommandArgs,
  InstallCommandArgs,
  InstallerCheckResult,
  RepairCommandArgs,
  ResolvedInstallerEnvironment,
  UninstallCommandArgs,
} from "./openclaw-installer/types";

async function main(): Promise<void> {
  const args = parseInstallerArgs(process.argv.slice(2));
  const environment = resolveInstallerEnvironment(args);

  switch (args.command) {
    case "install":
      await runInstall(args, environment);
      return;
    case "check":
      {
        const result = await runCheck(args, environment);
        if (!result.ok) {
          process.exitCode = 1;
        }
      }
      return;
    case "repair":
      await runRepair(args, environment);
      return;
    case "uninstall":
      await runUninstall(args, environment);
      return;
  }
}

type InstallerEnvironmentSeed = Pick<
  ResolvedInstallerEnvironment,
  "command" | "workspace" | "kbRoot" | "mcpName" | "agentId"
>;

function resolveInstallerEnvironment(
  args: InstallerEnvironmentSeed
): ResolvedInstallerEnvironment {
  const repoRoot = path.resolve(__dirname, "..");

  return {
    repoRoot,
    installerEntrypoint: path.resolve(__dirname, "openclaw_installer.js"),
    mcpServerEntrypoint: path.resolve(__dirname, "mcp_server.js"),
    openclawPluginEntrypoint: path.resolve(__dirname, "openclaw_plugin.js"),
    openclawPluginManifestPath: path.resolve(repoRoot, "openclaw.plugin.json"),
    command: args.command,
    workspace: args.workspace,
    kbRoot: args.kbRoot,
    mcpName: args.mcpName,
    agentId: args.agentId,
  };
}

async function runInstall(
  args: InstallCommandArgs,
  environment: ResolvedInstallerEnvironment
): Promise<void> {
  const result = await installOpenClawIntegration(args, environment, {
    openclawPackageRoot: readOptionalEnv("OPENCLAW_PACKAGE_ROOT"),
    resolvePluginToolsEntrypoint: readOptionalEnv(
      "OPENCLAW_RESOLVE_PLUGIN_TOOLS_ENTRYPOINT"
    ),
  });
  process.stdout.write(
    [
      "OpenClaw installer completed successfully.",
      `workspace: ${result.checkResult.environment.workspace}`,
      `agent_id: ${result.checkResult.environment.agentId}`,
      `kb_root: ${result.checkResult.environment.kbRoot}`,
      "configured_agent_session_kb_tools: ready",
      `manifest: ${result.manifestPath}`,
    ].join("\n") + "\n"
  );
}

async function runCheck(
  args: CheckCommandArgs,
  environment: ResolvedInstallerEnvironment
): Promise<InstallerCheckResult> {
  const result = await checkOpenClawInstallation({
    environment,
    requestedWorkspace: args.workspace,
    mcpName: args.mcpName,
    openclawPackageRoot: readOptionalEnv("OPENCLAW_PACKAGE_ROOT"),
    resolvePluginToolsEntrypoint: readOptionalEnv(
      "OPENCLAW_RESOLVE_PLUGIN_TOOLS_ENTRYPOINT"
    ),
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  if (result.ok) {
    process.stdout.write(
      [
        "OpenClaw installer check passed.",
        `workspace: ${result.environment.workspace}`,
        `agent_id: ${result.environment.agentId}`,
        `kb_root: ${result.environment.kbRoot ?? "(unknown)"}`,
        "configured_agent_session_kb_tools: ready",
      ].join("\n") + "\n"
    );
    return result;
  }

  process.stdout.write(
    [
      "OpenClaw installer check detected drift:",
      ...result.driftItems.map(
        (item) => `- [${item.kind}] ${item.message}${item.repairable ? " (repairable)" : ""}`
      ),
    ].join("\n") + "\n"
  );
  return result;
}

async function runRepair(
  args: RepairCommandArgs,
  environment: ResolvedInstallerEnvironment
): Promise<void> {
  const result = await repairOpenClawIntegration(args, environment, {
    openclawPackageRoot: readOptionalEnv("OPENCLAW_PACKAGE_ROOT"),
    resolvePluginToolsEntrypoint: readOptionalEnv(
      "OPENCLAW_RESOLVE_PLUGIN_TOOLS_ENTRYPOINT"
    ),
  });
  process.stdout.write(
    [
      result.message,
      `workspace: ${result.environment.workspace}`,
      `agent_id: ${result.environment.agentId}`,
      `kb_root: ${result.environment.kbRoot ?? "(unknown)"}`,
      `actions: ${result.appliedActions.join(", ")}`,
    ].join("\n") + "\n"
  );

  if (!result.ok) {
    process.stdout.write(
      [
        "Remaining drift:",
        ...result.remainingDriftItems.map(
          (item) => `- [${item.kind}] ${item.message}${item.repairable ? " (repairable)" : ""}`
        ),
      ].join("\n") + "\n"
    );
    process.exitCode = 1;
  }
}

async function runUninstall(
  args: UninstallCommandArgs,
  environment: ResolvedInstallerEnvironment
): Promise<void> {
  const result = await uninstallOpenClawIntegration(args, environment);
  process.stdout.write(
    [
      "OpenClaw uninstall completed.",
      `workspace: ${result.workspacePath}`,
      `manifest_removed: ${result.removedManifest}`,
      `mcp_removed: ${result.removedMcpRegistration}`,
      `removed_skill_directories: ${
        result.removedSkillDirectories.length > 0
          ? result.removedSkillDirectories.join(", ")
          : "(none)"
      }`,
    ].join("\n") + "\n"
  );
}

main().catch((error: unknown) => {
  const rawArgv = process.argv.slice(2);
  if (isParsedCheckJsonInvocation(rawArgv)) {
    const result = buildCheckJsonFailureResult(rawArgv, error);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(error instanceof InstallerCliUsageError ? error.exitCode : 1);
  }

  if (error instanceof InstallerCliUsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n\n${formatInstallerUsage()}\n`);
  process.exit(1);
});

function buildCheckJsonFailureResult(
  argv: readonly string[],
  error: unknown
): InstallerCheckResult {
  return {
    ok: false,
    environment: resolveInstallerEnvironment({
      command: "check",
      workspace: readOptionValue(argv, "workspace"),
      mcpName: readOptionValue(argv, "mcp-name") ?? "llm-kb",
      agentId: readOptionValue(argv, "agent-id") ?? "llmwiki",
    }),
    driftItems: [
      {
        kind: "other",
        message: error instanceof Error ? error.message : String(error),
        repairable: false,
      },
    ],
  };
}

function readOptionValue(argv: readonly string[], name: string): string | undefined {
  const longForm = `--${name}`;
  const prefix = `${longForm}=`;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token.startsWith(prefix)) {
      return token.slice(prefix.length);
    }

    if (token === longForm) {
      const next = argv[index + 1];
      if (
        next !== undefined &&
        next !== "-h" &&
        next !== "--help" &&
        !next.startsWith("--")
      ) {
        return next;
      }
      return undefined;
    }
  }

  return undefined;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
