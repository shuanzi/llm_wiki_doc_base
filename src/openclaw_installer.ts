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
import type {
  CheckCommandArgs,
  InstallCommandArgs,
  InstallerCheckResult,
  InstallerRepairOutcome,
  ParsedInstallerArgs,
  RepairCommandArgs,
  ResolvedInstallerEnvironment,
  UninstallCommandArgs,
} from "./openclaw-installer/types";

class InstallerNotImplementedError extends Error {
  readonly exitCode = 1;

  constructor(command: ParsedInstallerArgs["command"]) {
    super(`OpenClaw installer command "${command}" is not implemented yet.`);
    this.name = "InstallerNotImplementedError";
  }
}

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

function resolveInstallerEnvironment(args: ParsedInstallerArgs): ResolvedInstallerEnvironment {
  const repoRoot = path.resolve(__dirname, "..");

  return {
    repoRoot,
    installerEntrypoint: path.resolve(__dirname, "openclaw_installer.js"),
    mcpServerEntrypoint: path.resolve(__dirname, "mcp_server.js"),
    command: args.command,
    workspace: "workspace" in args ? args.workspace : undefined,
    kbRoot: "kbRoot" in args ? args.kbRoot : undefined,
    mcpName: args.mcpName,
  };
}

async function runInstall(
  args: InstallCommandArgs,
  environment: ResolvedInstallerEnvironment
): Promise<void> {
  const result = await installOpenClawIntegration(args, environment);
  process.stdout.write(
    [
      "OpenClaw installer completed successfully.",
      `workspace: ${result.checkResult.environment.workspace}`,
      `kb_root: ${result.checkResult.environment.kbRoot}`,
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
        `kb_root: ${result.environment.kbRoot ?? "(unknown)"}`,
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
  _args: RepairCommandArgs,
  _environment: ResolvedInstallerEnvironment
): Promise<InstallerRepairOutcome> {
  throw new InstallerNotImplementedError("repair");
}

async function runUninstall(
  _args: UninstallCommandArgs,
  _environment: ResolvedInstallerEnvironment
): Promise<never> {
  throw new InstallerNotImplementedError("uninstall");
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

  if (error instanceof InstallerNotImplementedError) {
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
      json: true,
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
