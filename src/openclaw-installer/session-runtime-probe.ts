import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

import { parseFrontmatter } from "../utils/frontmatter";
import { sha256 } from "../utils/hash";
import {
  SESSION_RUNTIME_RELATIVE_PLUGIN_ROOT,
  renderSessionRuntimePluginIndex,
  renderSessionRuntimePluginManifest,
} from "./session-runtime-artifact";
import type {
  InstallerProbeSnapshot,
  InstallerSessionRuntimeMetadata,
} from "./types";

type ResolvePluginToolsFunction = (options: {
  context: {
    config: unknown;
    workspaceDir: string;
  };
  suppressNameConflicts?: boolean;
  env?: NodeJS.ProcessEnv;
}) => Promise<unknown> | unknown;

type SessionRuntimeToolExecutor = (params: unknown) => Promise<unknown>;

interface SessionRuntimeToolBinding {
  name: string;
  execute: SessionRuntimeToolExecutor;
}

export interface ProbeSessionRuntimeSurfaceOptions {
  sessionRuntime: InstallerSessionRuntimeMetadata;
  invocationKbRoot: string;
  invocationPathOrId?: string;
  expectedToolNames?: readonly string[];
  openclawPackageRoot?: string;
  resolvePluginToolsEntrypoint?: string;
  openclawCliExecutablePath?: string;
}

export interface ProbeSessionRuntimeSurfaceResult extends InstallerProbeSnapshot {
  expectedToolNames: string[];
  missingToolNames: string[];
  unexpectedToolNames: string[];
  duplicateToolNames: string[];
  pluginId?: string;
  pluginName?: string;
}

export async function probeSessionRuntimeSurface(
  options: ProbeSessionRuntimeSurfaceOptions
): Promise<ProbeSessionRuntimeSurfaceResult> {
  const checkedAt = new Date().toISOString();
  const invocationKbRoot = path.resolve(options.invocationKbRoot);
  const invocationPathOrId = options.invocationPathOrId ?? "wiki/index.md";
  const expectedToolNames = normalizeExpectedToolNames(
    options.expectedToolNames ?? options.sessionRuntime.canonicalToolNames
  );
  const pluginIdentity = readPluginIdentity(options.sessionRuntime.pluginManifestFile);

  let toolNames: string[] = [];
  try {
    const metadataErrors = validateSessionRuntimeMetadataFiles(options.sessionRuntime);
    if (metadataErrors.length > 0) {
      return {
        checkedAt,
        ok: false,
        toolNames,
        expectedToolNames,
        missingToolNames: expectedToolNames,
        unexpectedToolNames: [],
        duplicateToolNames: [],
        pluginId: pluginIdentity.pluginId ?? options.sessionRuntime.pluginId,
        pluginName: pluginIdentity.pluginName,
        failureReason: metadataErrors.join(" | "),
      };
    }

    const workspaceDir = resolveWorkspaceDirFromSessionRuntime(options.sessionRuntime);
    const toolSurface = await withInvocationKbRoot(invocationKbRoot, () =>
      resolveOfficialToolSurface({
        sessionRuntime: options.sessionRuntime,
        workspaceDir,
        openclawPackageRoot: options.openclawPackageRoot,
        resolvePluginToolsEntrypoint: options.resolvePluginToolsEntrypoint,
        openclawCliExecutablePath: options.openclawCliExecutablePath,
      })
    );

    toolNames = toolSurface.toolNames;
    const missingToolNames = expectedToolNames.filter(
      (name) => !toolSurface.toolNameSet.has(name)
    );
    const unexpectedToolNames = toolSurface.toolNames.filter(
      (name) => !expectedToolNames.includes(name)
    );
    const duplicateToolNames = [...toolSurface.duplicateToolNames].sort((a, b) =>
      a.localeCompare(b)
    );

    const surfaceOk =
      missingToolNames.length === 0 &&
      unexpectedToolNames.length === 0 &&
      duplicateToolNames.length === 0;

    let invocationFailureReason: string | undefined;
    if (surfaceOk) {
      invocationFailureReason = await probeLiveKbReadPageInvocation({
        toolsByName: toolSurface.toolsByName,
        invocationKbRoot,
        invocationPathOrId,
      });
    }

    const finalOk = surfaceOk && invocationFailureReason === undefined;

    return {
      checkedAt,
      ok: finalOk,
      toolNames,
      expectedToolNames,
      missingToolNames,
      unexpectedToolNames,
      duplicateToolNames,
      pluginId: pluginIdentity.pluginId ?? options.sessionRuntime.pluginId,
      pluginName: pluginIdentity.pluginName,
      failureReason: finalOk
        ? undefined
        : buildFailureReason({
            missingToolNames,
            unexpectedToolNames,
            duplicateToolNames,
            invocationFailureReason,
          }),
    };
  } catch (error) {
    return {
      checkedAt,
      ok: false,
      toolNames,
      expectedToolNames,
      missingToolNames: expectedToolNames.filter((name) => !toolNames.includes(name)),
      unexpectedToolNames: toolNames.filter((name) => !expectedToolNames.includes(name)),
      duplicateToolNames: [],
      pluginId: pluginIdentity.pluginId ?? options.sessionRuntime.pluginId,
      pluginName: pluginIdentity.pluginName,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function toSessionRuntimeProbeSnapshot(
  result: ProbeSessionRuntimeSurfaceResult
): InstallerProbeSnapshot {
  return {
    checkedAt: result.checkedAt,
    ok: result.ok,
    toolNames: result.toolNames,
    failureReason: result.failureReason,
  };
}

function validateSessionRuntimeMetadataFiles(
  metadata: InstallerSessionRuntimeMetadata
): string[] {
  const errors: string[] = [];

  if (!isRegularFile(metadata.pluginIndexFile)) {
    errors.push(`Missing session runtime plugin index file: ${metadata.pluginIndexFile}`);
  } else {
    const diskHash = sha256(fs.readFileSync(metadata.pluginIndexFile, "utf8"));
    if (diskHash !== metadata.pluginIndexContentHash) {
      errors.push(
        `Session runtime plugin index hash drift: expected=${metadata.pluginIndexContentHash} actual=${diskHash}`
      );
    }

    const expectedDeterministicHash = renderSessionRuntimePluginIndex({
      sourcePluginEntrypoint: metadata.sourcePluginEntrypoint,
      kbRoot: metadata.kbRoot,
    }).contentHash;
    if (diskHash !== expectedDeterministicHash) {
      errors.push(
        `Session runtime plugin index hash no longer matches deterministic shim renderer output: expected=${expectedDeterministicHash} actual=${diskHash}`
      );
    }
  }

  if (!isRegularFile(metadata.pluginManifestFile)) {
    errors.push(
      `Missing session runtime plugin manifest file: ${metadata.pluginManifestFile}`
    );
  } else {
    const diskHash = sha256(fs.readFileSync(metadata.pluginManifestFile, "utf8"));
    if (diskHash !== metadata.pluginManifestContentHash) {
      errors.push(
        `Session runtime plugin manifest hash drift: expected=${metadata.pluginManifestContentHash} actual=${diskHash}`
      );
    }

    const expectedDeterministicHash = renderSessionRuntimePluginManifest({
      sourcePluginManifestPath: metadata.sourcePluginManifestPath,
      canonicalToolNames: metadata.canonicalToolNames,
    }).contentHash;
    if (diskHash !== expectedDeterministicHash) {
      errors.push(
        `Session runtime plugin manifest hash no longer matches deterministic shim renderer output: expected=${expectedDeterministicHash} actual=${diskHash}`
      );
    }
  }

  if (!isRegularFile(metadata.sourcePluginEntrypoint)) {
    errors.push(`Missing source plugin entrypoint: ${metadata.sourcePluginEntrypoint}`);
  } else {
    const diskHash = sha256(fs.readFileSync(metadata.sourcePluginEntrypoint, "utf8"));
    if (diskHash !== metadata.sourcePluginEntrypointHash) {
      errors.push(
        `Source plugin entrypoint hash drift: expected=${metadata.sourcePluginEntrypointHash} actual=${diskHash}`
      );
    }
  }

  if (!isRegularFile(metadata.sourcePluginManifestPath)) {
    errors.push(`Missing source plugin manifest: ${metadata.sourcePluginManifestPath}`);
  } else {
    const diskHash = sha256(fs.readFileSync(metadata.sourcePluginManifestPath, "utf8"));
    if (diskHash !== metadata.sourcePluginManifestHash) {
      errors.push(
        `Source plugin manifest hash drift: expected=${metadata.sourcePluginManifestHash} actual=${diskHash}`
      );
    }
  }

  return errors;
}

async function resolveOfficialToolSurface(options: {
  sessionRuntime: InstallerSessionRuntimeMetadata;
  workspaceDir: string;
  openclawPackageRoot?: string;
  resolvePluginToolsEntrypoint?: string;
  openclawCliExecutablePath?: string;
}): Promise<{
  toolNames: string[];
  toolNameSet: Set<string>;
  duplicateToolNames: Set<string>;
  toolsByName: Map<string, SessionRuntimeToolExecutor>;
}> {
  const loader = await loadResolvePluginTools({
    openclawPackageRoot: options.openclawPackageRoot,
    resolvePluginToolsEntrypoint: options.resolvePluginToolsEntrypoint,
    openclawCliExecutablePath: options.openclawCliExecutablePath,
  });
  const config = buildOfficialProbeConfig({
    agentId: options.sessionRuntime.agentId,
    pluginId: options.sessionRuntime.pluginId,
    workspaceDir: options.workspaceDir,
  });

  const resolvedTools = await Promise.resolve(
    loader.resolvePluginTools({
      context: {
        config,
        workspaceDir: options.workspaceDir,
      },
      suppressNameConflicts: true,
      env: {
        ...process.env,
        OPENCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE: "1",
        OPENCLAW_PLUGIN_DISCOVERY_CACHE_MS: "0",
      },
    })
  );

  const toolEntries = extractResolvedToolEntries(resolvedTools);
  const seenToolNames = new Set<string>();
  const duplicateToolNames = new Set<string>();
  const toolsByName = new Map<string, SessionRuntimeToolExecutor>();

  for (const entry of toolEntries) {
    const binding = normalizeResolvedToolBinding(entry);
    if (seenToolNames.has(binding.name)) {
      duplicateToolNames.add(binding.name);
      continue;
    }
    seenToolNames.add(binding.name);
    toolsByName.set(binding.name, binding.execute);
  }

  const toolNames = [...seenToolNames].sort((left, right) => left.localeCompare(right));
  return {
    toolNames,
    toolNameSet: new Set(toolNames),
    duplicateToolNames,
    toolsByName,
  };
}

function buildOfficialProbeConfig(options: {
  agentId: string;
  pluginId: string;
  workspaceDir: string;
}): Record<string, unknown> {
  return {
    plugins: {
      enabled: true,
      allow: [options.pluginId],
      slots: {
        memory: "none",
      },
      entries: {
        [options.pluginId]: {
          enabled: true,
        },
      },
    },
    agents: {
      list: [
        {
          id: options.agentId,
          default: true,
          workspace: options.workspaceDir,
        },
      ],
    },
  };
}

function resolveWorkspaceDirFromSessionRuntime(
  metadata: InstallerSessionRuntimeMetadata
): string {
  const workspaceDir = path.resolve(metadata.pluginRoot, "..", "..", "..");
  const expectedPluginRoot = path.resolve(
    workspaceDir,
    SESSION_RUNTIME_RELATIVE_PLUGIN_ROOT
  );

  if (path.resolve(metadata.pluginRoot) !== expectedPluginRoot) {
    throw new Error(
      `Session runtime plugin root does not match deterministic workspace path. expected=${expectedPluginRoot} actual=${metadata.pluginRoot}`
    );
  }

  if (!isRegularDirectory(workspaceDir)) {
    throw new Error(
      `Session runtime workspace directory is missing or invalid: ${workspaceDir}`
    );
  }

  return workspaceDir;
}

async function loadResolvePluginTools(options: {
  openclawPackageRoot?: string;
  resolvePluginToolsEntrypoint?: string;
  openclawCliExecutablePath?: string;
}): Promise<{
  openclawPackageRoot: string;
  entrypoint: string;
  resolvePluginTools: ResolvePluginToolsFunction;
}> {
  const openclawPackageRoot = resolveOpenClawPackageRoot({
    explicitPackageRoot: options.openclawPackageRoot,
    cliExecutablePath: options.openclawCliExecutablePath,
  });
  const candidates = resolveResolvePluginToolsEntrypointCandidates({
    openclawPackageRoot,
    explicitEntrypoint: options.resolvePluginToolsEntrypoint,
  });

  const entryErrors: string[] = [];
  for (const entrypoint of candidates) {
    if (!isRegularFile(entrypoint)) {
      continue;
    }

    try {
      const loaded = await loadModuleFromEntrypoint(entrypoint);
      const exported = extractResolvePluginToolsExport(loaded);
      if (!exported) {
        entryErrors.push(
          `Entrypoint does not export resolvePluginTools: ${entrypoint}`
        );
        continue;
      }
      return {
        openclawPackageRoot,
        entrypoint,
        resolvePluginTools: exported,
      };
    } catch (error) {
      entryErrors.push(
        `Failed to load ${entrypoint}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  throw new Error(
    [
      `Unable to load official OpenClaw resolvePluginTools entrypoint under ${openclawPackageRoot}.`,
      `Checked candidates: ${candidates.join(", ")}`,
      entryErrors.length > 0 ? `Errors: ${entryErrors.join(" | ")}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ")
  );
}

function resolveOpenClawPackageRoot(options: {
  explicitPackageRoot?: string;
  cliExecutablePath?: string;
}): string {
  const explicitSources = [options.explicitPackageRoot, process.env.OPENCLAW_PACKAGE_ROOT].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  for (const candidate of explicitSources) {
    const resolved = path.resolve(candidate);
    if (isOpenClawPackageRoot(resolved)) {
      return resolved;
    }
  }

  const cliDerivedRoot = resolveOpenClawPackageRootFromCliExecutablePath(
    options.cliExecutablePath
  );
  if (cliDerivedRoot) {
    return cliDerivedRoot;
  }

  try {
    const packageJsonPath = require.resolve("openclaw/package.json");
    return path.dirname(packageJsonPath);
  } catch {
    throw new Error(
      [
        "OpenClaw package root is required for official session runtime probe loading.",
        "Ensure OpenClaw CLI is installed and discoverable, or set OPENCLAW_PACKAGE_ROOT as an explicit override.",
      ].join(" ")
    );
  }
}

function resolveResolvePluginToolsEntrypointCandidates(options: {
  openclawPackageRoot: string;
  explicitEntrypoint?: string;
}): string[] {
  const explicitFromEnv = process.env.OPENCLAW_RESOLVE_PLUGIN_TOOLS_ENTRYPOINT;
  const explicit = options.explicitEntrypoint ?? explicitFromEnv;
  if (explicit && explicit.trim().length > 0) {
    return [
      path.isAbsolute(explicit)
        ? path.resolve(explicit)
        : path.resolve(options.openclawPackageRoot, explicit),
    ];
  }

  const distDir = path.resolve(options.openclawPackageRoot, "dist");
  const pluginToolsServeEntrypoint = path.resolve(distDir, "mcp", "plugin-tools-serve.js");
  const parsedToolsEntrypoint = resolveToolsEntrypointFromPluginToolsServe(
    pluginToolsServeEntrypoint
  );
  const fallbackToolsEntrypoints = fs.existsSync(distDir)
    ? fs
        .readdirSync(distDir)
        .filter((fileName) => /^(?:tools|channel-tools)-.*\.js$/u.test(fileName))
        .map((fileName) => path.resolve(distDir, fileName))
        .filter((filePath) => fileContains(filePath, "resolvePluginTools"))
        .sort((left, right) => left.localeCompare(right))
    : [];

  return dedupeResolvedPaths([
    parsedToolsEntrypoint,
    ...fallbackToolsEntrypoints,
    pluginToolsServeEntrypoint,
  ]);
}

async function loadModuleFromEntrypoint(entrypoint: string): Promise<unknown> {
  try {
    return require(entrypoint) as unknown;
  } catch (error) {
    if (!shouldRetryViaDynamicImport(error)) {
      throw error;
    }
  }

  const dynamicImport = new Function(
    "moduleUrl",
    "return import(moduleUrl);"
  ) as (moduleUrl: string) => Promise<unknown>;
  return await dynamicImport(pathToFileURL(entrypoint).href);
}

function shouldRetryViaDynamicImport(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const errorCode = typeof error.code === "string" ? error.code : "";
  if (errorCode === "ERR_REQUIRE_ESM") {
    return true;
  }
  const message = typeof error.message === "string" ? error.message : "";
  return (
    message.includes("Cannot use import statement outside a module") ||
    message.includes("Unexpected token 'export'")
  );
}

function fileContains(filePath: string, needle: string): boolean {
  if (!isRegularFile(filePath)) {
    return false;
  }
  try {
    return fs.readFileSync(filePath, "utf8").includes(needle);
  } catch {
    return false;
  }
}

function resolveOpenClawPackageRootFromCliExecutablePath(
  cliExecutablePath: string | undefined
): string | undefined {
  if (!cliExecutablePath) {
    return undefined;
  }

  const candidatePaths = [path.resolve(cliExecutablePath)];
  try {
    candidatePaths.push(path.resolve(fs.realpathSync(cliExecutablePath)));
  } catch {
    // Ignore realpath failures and continue with the original path.
  }

  for (const candidatePath of dedupeResolvedPaths(candidatePaths)) {
    const packageRoot = findOpenClawPackageRootAscending(path.dirname(candidatePath));
    if (packageRoot) {
      return packageRoot;
    }
  }

  return undefined;
}

function findOpenClawPackageRootAscending(startDir: string): string | undefined {
  let current = path.resolve(startDir);

  while (true) {
    if (isOpenClawPackageRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function isOpenClawPackageRoot(candidateRoot: string): boolean {
  const packageJsonPath = path.resolve(candidateRoot, "package.json");
  if (!isRegularFile(packageJsonPath)) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return false;
  }

  return isRecord(parsed) && parsed.name === "openclaw";
}

function resolveToolsEntrypointFromPluginToolsServe(
  pluginToolsServeEntrypoint: string
): string | undefined {
  if (!isRegularFile(pluginToolsServeEntrypoint)) {
    return undefined;
  }

  let content: string;
  try {
    content = fs.readFileSync(pluginToolsServeEntrypoint, "utf8");
  } catch {
    return undefined;
  }

  const match = content.match(
    /from\s+["']\.\.\/((?:tools|channel-tools)-[^"']+\.js)["']/u
  );
  if (!match) {
    return undefined;
  }

  return path.resolve(path.dirname(pluginToolsServeEntrypoint), "..", match[1]);
}

function dedupeResolvedPaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((value): value is string => typeof value === "string"))].map(
    (value) => path.resolve(value)
  );
}

function extractResolvePluginToolsExport(
  loaded: unknown
): ResolvePluginToolsFunction | undefined {
  if (typeof loaded === "function") {
    return loaded as ResolvePluginToolsFunction;
  }

  if (!isRecord(loaded)) {
    return undefined;
  }

  if (typeof loaded.resolvePluginTools === "function") {
    return loaded.resolvePluginTools as ResolvePluginToolsFunction;
  }
  for (const value of Object.values(loaded)) {
    if (typeof value === "function" && value.name === "resolvePluginTools") {
      return value as ResolvePluginToolsFunction;
    }
  }
  if (typeof loaded.d === "function") {
    return loaded.d as ResolvePluginToolsFunction;
  }
  if (typeof loaded.r === "function") {
    return loaded.r as ResolvePluginToolsFunction;
  }

  if (isRecord(loaded.default) && typeof loaded.default.resolvePluginTools === "function") {
    return loaded.default.resolvePluginTools as ResolvePluginToolsFunction;
  }
  if (isRecord(loaded.default)) {
    for (const value of Object.values(loaded.default)) {
      if (typeof value === "function" && value.name === "resolvePluginTools") {
        return value as ResolvePluginToolsFunction;
      }
    }
  }
  if (isRecord(loaded.default) && typeof loaded.default.d === "function") {
    return loaded.default.d as ResolvePluginToolsFunction;
  }
  if (isRecord(loaded.default) && typeof loaded.default.r === "function") {
    return loaded.default.r as ResolvePluginToolsFunction;
  }

  return undefined;
}

function extractResolvedToolEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value instanceof Map) {
    return [...value.values()];
  }

  if (!isRecord(value)) {
    throw new Error("resolvePluginTools returned unsupported payload shape.");
  }

  const directTools = value.tools;
  if (Array.isArray(directTools)) {
    return directTools;
  }
  if (directTools instanceof Map) {
    return [...directTools.values()];
  }

  const toolsByName = value.toolsByName;
  if (toolsByName instanceof Map) {
    return [...toolsByName.values()];
  }
  if (isRecord(toolsByName)) {
    return Object.entries(toolsByName).map(([name, tool]) =>
      isRecord(tool) && typeof tool.name !== "string"
        ? { ...tool, name }
        : tool
    );
  }

  throw new Error("resolvePluginTools did not expose tools in known fields.");
}

function normalizeResolvedToolBinding(value: unknown): SessionRuntimeToolBinding {
  if (!isRecord(value)) {
    throw new Error("Resolved tool entry is not an object.");
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("Resolved tool entry is missing non-empty string name.");
  }

  const executor =
    resolveExecuteHandler(value) ??
    resolveCallHandler(value) ??
    resolveNestedExecuteHandler(value);

  if (!executor) {
    throw new Error(`Resolved tool ${value.name} does not expose an executable handler.`);
  }

  return {
    name: value.name,
    execute: executor,
  };
}

function resolveExecuteHandler(value: Record<string, unknown>): SessionRuntimeToolExecutor | undefined {
  if (typeof value.execute !== "function") {
    return undefined;
  }

  return async (params: unknown) => {
    const executeFn = value.execute as (...args: unknown[]) => unknown;
    if (executeFn.length <= 1) {
      return await Promise.resolve(executeFn(params));
    }
    return await Promise.resolve(
      executeFn("session-runtime-probe-kb_read_page", params)
    );
  };
}

function resolveCallHandler(value: Record<string, unknown>): SessionRuntimeToolExecutor | undefined {
  const callLike =
    typeof value.call === "function"
      ? (value.call as (params: unknown) => unknown)
      : typeof value.invoke === "function"
        ? (value.invoke as (params: unknown) => unknown)
        : typeof value.run === "function"
          ? (value.run as (params: unknown) => unknown)
          : undefined;

  if (!callLike) {
    return undefined;
  }

  return async (params: unknown) => await Promise.resolve(callLike(params));
}

function resolveNestedExecuteHandler(
  value: Record<string, unknown>
): SessionRuntimeToolExecutor | undefined {
  const nestedCandidates = [value.tool, value.handler];
  for (const candidate of nestedCandidates) {
    if (!isRecord(candidate) || typeof candidate.execute !== "function") {
      continue;
    }
    return async (params: unknown) => {
      const executeFn = candidate.execute as (...args: unknown[]) => unknown;
      if (executeFn.length <= 1) {
        return await Promise.resolve(executeFn(params));
      }
      return await Promise.resolve(
        executeFn("session-runtime-probe-kb_read_page", params)
      );
    };
  }
  return undefined;
}

function readPluginIdentity(pluginManifestFile: string): {
  pluginId?: string;
  pluginName?: string;
} {
  if (!isRegularFile(pluginManifestFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(pluginManifestFile, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return {
      pluginId: typeof parsed.id === "string" ? parsed.id : undefined,
      pluginName: typeof parsed.name === "string" ? parsed.name : undefined,
    };
  } catch {
    return {};
  }
}

function buildFailureReason(options: {
  missingToolNames: string[];
  unexpectedToolNames: string[];
  duplicateToolNames: string[];
  invocationFailureReason?: string;
}): string {
  return [
    options.missingToolNames.length > 0
      ? `missing tools: ${options.missingToolNames.join(", ")}`
      : undefined,
    options.unexpectedToolNames.length > 0
      ? `unexpected tools: ${options.unexpectedToolNames.join(", ")}`
      : undefined,
    options.duplicateToolNames.length > 0
      ? `duplicate tools: ${options.duplicateToolNames.join(", ")}`
      : undefined,
    options.invocationFailureReason,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" | ");
}

async function probeLiveKbReadPageInvocation(options: {
  toolsByName: Map<string, SessionRuntimeToolExecutor>;
  invocationKbRoot: string;
  invocationPathOrId: string;
}): Promise<string | undefined> {
  const readTool = options.toolsByName.get("kb_read_page");
  if (!readTool) {
    return "missing executable tool handler for kb_read_page";
  }

  if (!isRegularDirectory(options.invocationKbRoot)) {
    return `session runtime invocation KB_ROOT is missing or not a directory: ${options.invocationKbRoot}`;
  }

  const probePagePath = path.resolve(options.invocationKbRoot, options.invocationPathOrId);
  if (!isRegularFile(probePagePath)) {
    return `session runtime invocation fixture is missing or not a regular file: ${probePagePath}`;
  }

  let rawResult: unknown;
  try {
    rawResult = await withInvocationKbRoot(options.invocationKbRoot, () =>
      readTool({
        path_or_id: options.invocationPathOrId,
      })
    );
  } catch (error) {
    return `kb_read_page invocation failed for ${options.invocationPathOrId}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  let pagePayload: {
    path: string;
    frontmatter: Record<string, unknown>;
    body: string;
  };
  try {
    pagePayload = parseKbReadPagePayload(rawResult);
  } catch (error) {
    return `kb_read_page returned malformed payload: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  if (pagePayload.path !== options.invocationPathOrId) {
    return (
      `kb_read_page returned unexpected path for ${options.invocationPathOrId}. ` +
      `actual=${pagePayload.path}`
    );
  }

  const expectedRawPage = fs.readFileSync(probePagePath, "utf8");
  const expectedParsedPage = parseFrontmatter(expectedRawPage);

  if (pagePayload.body !== expectedParsedPage.body) {
    return (
      `kb_read_page payload body mismatch for ${options.invocationPathOrId} under ` +
      `KB_ROOT=${options.invocationKbRoot}`
    );
  }

  if (
    JSON.stringify(pagePayload.frontmatter) !==
    JSON.stringify(expectedParsedPage.frontmatter)
  ) {
    return (
      `kb_read_page payload frontmatter mismatch for ${options.invocationPathOrId} ` +
      `under KB_ROOT=${options.invocationKbRoot}`
    );
  }

  return undefined;
}

async function withInvocationKbRoot<T>(
  invocationKbRoot: string,
  callback: () => Promise<T>
): Promise<T> {
  const previousKbRoot = process.env.KB_ROOT;
  const previousWorkspaceRoot = process.env.WORKSPACE_ROOT;
  process.env.KB_ROOT = invocationKbRoot;
  delete process.env.WORKSPACE_ROOT;

  try {
    return await callback();
  } finally {
    if (previousKbRoot === undefined) {
      delete process.env.KB_ROOT;
    } else {
      process.env.KB_ROOT = previousKbRoot;
    }

    if (previousWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = previousWorkspaceRoot;
    }
  }
}

function parseKbReadPagePayload(value: unknown): {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!isRecord(value)) {
    throw new Error("tool execution result must be an object");
  }

  const content = value.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error("tool execution result must include non-empty content array");
  }

  const firstTextChunk = content.find(
    (item) => isRecord(item) && item.type === "text" && typeof item.text === "string"
  ) as { text: string } | undefined;
  if (!firstTextChunk) {
    throw new Error("tool execution content must include a text payload");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(firstTextChunk.text);
  } catch (error) {
    throw new Error(
      `tool execution content is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("tool payload must be an object");
  }

  if (typeof parsed.path !== "string" || parsed.path.length === 0) {
    throw new Error("tool payload.path must be a non-empty string");
  }

  if (typeof parsed.body !== "string") {
    throw new Error("tool payload.body must be a string");
  }

  if (!isRecord(parsed.frontmatter)) {
    throw new Error("tool payload.frontmatter must be an object");
  }

  return {
    path: parsed.path,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}

function normalizeExpectedToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames)].sort((left, right) => left.localeCompare(right));
}

function isRegularFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const lstat = fs.lstatSync(filePath);
  if (lstat.isSymbolicLink()) {
    return false;
  }
  return lstat.isFile();
}

function isRegularDirectory(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const lstat = fs.lstatSync(filePath);
  if (lstat.isSymbolicLink()) {
    return false;
  }
  return lstat.isDirectory();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
