import * as path from "path";

import type { OpenClawCli } from "./openclaw-cli";
import {
  SESSION_RUNTIME_PLUGIN_ALLOW_CONFIG_PATH,
  SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH,
  SESSION_RUNTIME_PLUGIN_ENTRY_CONFIG_PATH,
  SESSION_RUNTIME_PLUGIN_ID,
  SESSION_RUNTIME_PLUGIN_LOAD_PATHS_CONFIG_PATH,
} from "./session-runtime-artifact";

export interface SessionRuntimeConfigSnapshot {
  enabled: unknown;
  allow: unknown;
  loadPaths: unknown;
}

export interface EnsureSessionRuntimePluginConfigResult {
  previous: SessionRuntimeConfigSnapshot;
  changed: boolean;
}

export async function ensureSessionRuntimePluginConfig(options: {
  cli: OpenClawCli;
  pluginRoot: string;
}): Promise<EnsureSessionRuntimePluginConfigResult> {
  const pluginRoot = path.resolve(options.pluginRoot);
  const previous = await readSessionRuntimePluginConfig(options.cli);
  const nextAllow = ensureStringListEntry(previous.allow, SESSION_RUNTIME_PLUGIN_ID);
  const nextLoadPaths = ensureStringListEntry(previous.loadPaths, pluginRoot);

  let changed = false;
  if (!sameJson(previous.loadPaths, nextLoadPaths)) {
    await options.cli.setConfigValueStrictJson(
      SESSION_RUNTIME_PLUGIN_LOAD_PATHS_CONFIG_PATH,
      nextLoadPaths
    );
    changed = true;
  }
  if (!sameJson(previous.allow, nextAllow)) {
    await options.cli.setConfigValueStrictJson(
      SESSION_RUNTIME_PLUGIN_ALLOW_CONFIG_PATH,
      nextAllow
    );
    changed = true;
  }
  if (previous.enabled !== true) {
    await options.cli.setConfigValueStrictJson(
      SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH,
      true
    );
    changed = true;
  }

  return { previous, changed };
}

export async function restoreSessionRuntimePluginConfig(options: {
  cli: OpenClawCli;
  previous: SessionRuntimeConfigSnapshot;
}): Promise<void> {
  await restoreConfigPath(
    options.cli,
    SESSION_RUNTIME_PLUGIN_LOAD_PATHS_CONFIG_PATH,
    options.previous.loadPaths
  );
  await restoreConfigPath(
    options.cli,
    SESSION_RUNTIME_PLUGIN_ALLOW_CONFIG_PATH,
    options.previous.allow
  );
  await restoreConfigPath(
    options.cli,
    SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH,
    options.previous.enabled
  );
}

export async function removeSessionRuntimePluginConfig(options: {
  cli: OpenClawCli;
  pluginRoot: string;
}): Promise<void> {
  const pluginRoot = path.resolve(options.pluginRoot);
  const previous = await readSessionRuntimePluginConfig(options.cli);
  await options.cli.setConfigValueStrictJson(
    SESSION_RUNTIME_PLUGIN_LOAD_PATHS_CONFIG_PATH,
    removeStringListEntry(previous.loadPaths, pluginRoot)
  );
  await options.cli.setConfigValueStrictJson(
    SESSION_RUNTIME_PLUGIN_ALLOW_CONFIG_PATH,
    removeStringListEntry(previous.allow, SESSION_RUNTIME_PLUGIN_ID)
  );
  await options.cli.unsetConfigValue(SESSION_RUNTIME_PLUGIN_ENTRY_CONFIG_PATH);
}

export async function readSessionRuntimePluginConfig(
  cli: OpenClawCli
): Promise<SessionRuntimeConfigSnapshot> {
  const [enabled, allow, loadPaths] = await Promise.all([
    cli.getConfigValue<unknown>(SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH, {
      allowMissing: true,
    }),
    cli.getConfigValue<unknown>(SESSION_RUNTIME_PLUGIN_ALLOW_CONFIG_PATH, {
      allowMissing: true,
    }),
    cli.getConfigValue<unknown>(SESSION_RUNTIME_PLUGIN_LOAD_PATHS_CONFIG_PATH, {
      allowMissing: true,
    }),
  ]);

  return { enabled, allow, loadPaths };
}

export function sessionRuntimePluginConfigDrift(options: {
  snapshot: SessionRuntimeConfigSnapshot;
  pluginRoot: string;
}): string[] {
  const pluginRoot = path.resolve(options.pluginRoot);
  const drift: string[] = [];
  if (options.snapshot.enabled !== true) {
    drift.push(SESSION_RUNTIME_PLUGIN_ENABLED_CONFIG_PATH);
  }
  if (!stringListIncludes(options.snapshot.allow, SESSION_RUNTIME_PLUGIN_ID)) {
    drift.push(SESSION_RUNTIME_PLUGIN_ALLOW_CONFIG_PATH);
  }
  if (!stringListIncludes(options.snapshot.loadPaths, pluginRoot)) {
    drift.push(SESSION_RUNTIME_PLUGIN_LOAD_PATHS_CONFIG_PATH);
  }
  return drift;
}

function ensureStringListEntry(value: unknown, entry: string): string[] {
  const existing = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  return Array.from(new Set([...existing, entry]));
}

function removeStringListEntry(value: unknown, entry: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalizedEntry = path.resolve(entry);
  return value.filter((item): item is string => {
    if (typeof item !== "string") {
      return false;
    }
    if (item === entry) {
      return false;
    }
    return path.resolve(item) !== normalizedEntry;
  });
}

function stringListIncludes(value: unknown, entry: string): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.includes(entry)) {
    return true;
  }
  const normalizedEntry = path.resolve(entry);
  return value.some(
    (item) => typeof item === "string" && path.resolve(item) === normalizedEntry
  );
}

async function restoreConfigPath(
  cli: OpenClawCli,
  configPath: string,
  previousValue: unknown
): Promise<void> {
  if (previousValue === undefined) {
    await cli.unsetConfigValue(configPath);
    return;
  }
  await cli.setConfigValueStrictJson(configPath, previousValue);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
