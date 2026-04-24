import * as fs from "fs";
import * as path from "path";

import type { WorkspaceConfig } from "../types";

export interface ResolvedKbWorkspaceConfig {
  config: WorkspaceConfig;
  kbRootSource: string;
}

export function resolveKbWorkspaceConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): ResolvedKbWorkspaceConfig {
  let kbRoot: string;
  let kbRootSource: string;

  if (env.KB_ROOT) {
    kbRoot = path.resolve(cwd, env.KB_ROOT);
    kbRootSource = "KB_ROOT";
  } else if (env.WORKSPACE_ROOT) {
    kbRoot = path.resolve(cwd, env.WORKSPACE_ROOT, "kb");
    kbRootSource = "WORKSPACE_ROOT";
  } else {
    kbRoot = path.resolve(cwd, "kb");
    kbRootSource = "default (cwd/kb)";
  }

  return {
    config: {
      kb_root: kbRoot,
    },
    kbRootSource,
  };
}

export function isExistingDirectory(targetPath: string): boolean {
  return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
}

export function buildKbRootMissingMessage(options: {
  kbRoot: string;
  kbRootSource: string;
  prefix?: string;
}): string {
  const prefix = options.prefix ?? "[kb-mcp]";
  return (
    `${prefix} FATAL: kb_root does not exist or is not a directory.\n` +
    `  resolved path : ${options.kbRoot}\n` +
    `  driven by     : ${options.kbRootSource}\n` +
    "Set KB_ROOT (absolute path to the kb directory) or WORKSPACE_ROOT (repo root) correctly.\n"
  );
}

export function assertKbRootDirectory(
  resolved: ResolvedKbWorkspaceConfig,
  prefix?: string
): void {
  if (!isExistingDirectory(resolved.config.kb_root)) {
    throw new Error(
      buildKbRootMissingMessage({
        kbRoot: resolved.config.kb_root,
        kbRootSource: resolved.kbRootSource,
        prefix,
      }).trim()
    );
  }
}
