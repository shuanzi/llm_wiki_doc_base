#!/usr/bin/env node

import * as path from "path";

import {
  InstallerCliUsageError,
  formatInstallerUsage,
  isParsedCheckJsonInvocation,
  parseInstallerArgs,
} from "./openclaw-installer/args";
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

class InstallerCheckJsonError extends Error {
  readonly exitCode = 1;
  readonly result: InstallerCheckResult;

  constructor(result: InstallerCheckResult) {
    super('OpenClaw installer command "check" is not implemented yet.');
    this.name = "InstallerCheckJsonError";
    this.result = result;
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
      await runCheck(args, environment);
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
  _args: InstallCommandArgs,
  _environment: ResolvedInstallerEnvironment
): Promise<never> {
  throw new InstallerNotImplementedError("install");
}

async function runCheck(
  args: CheckCommandArgs,
  environment: ResolvedInstallerEnvironment
): Promise<never> {
  if (args.json) {
    throw new InstallerCheckJsonError({
      ok: false,
      environment,
      driftItems: [
        {
          kind: "other",
          message: 'OpenClaw installer command "check" is not implemented yet.',
          repairable: false,
        },
      ],
    });
  }

  throw new InstallerNotImplementedError("check");
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
    const result =
      error instanceof InstallerCheckJsonError
        ? error.result
        : buildCheckJsonFailureResult(rawArgv, error);
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
      if (next !== undefined && next !== "-h" && next !== "--help") {
        return next;
      }
      return undefined;
    }
  }

  return undefined;
}
