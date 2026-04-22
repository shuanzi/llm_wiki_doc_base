import * as fs from "fs";
import * as path from "path";

export const MINIMUM_KB_DIRECTORIES = [
  "raw/inbox",
  "wiki",
  "wiki/sources",
  "wiki/entities",
  "wiki/concepts",
  "wiki/analyses",
  "wiki/reports",
  "schema",
  "state/manifests",
  "state/cache",
] as const;

export const MINIMUM_KB_FILES = [
  "wiki/index.md",
  "wiki/log.md",
  "schema/wiki-conventions.md",
  "state/cache/page-index.json",
] as const;

export type KbBootstrapRequiredDirectory = (typeof MINIMUM_KB_DIRECTORIES)[number];
export type KbBootstrapRequiredFile = (typeof MINIMUM_KB_FILES)[number];

export interface KbStructureValidationResult {
  ok: boolean;
  kbRoot: string;
  missingDirectories: string[];
  missingFiles: string[];
  invalidPaths: string[];
}

export interface BootstrapExternalKbRootOptions {
  repoRoot: string;
  kbRoot: string;
  now?: Date;
}

export interface BootstrapExternalKbRootResult {
  kbRoot: string;
  createdDirectories: string[];
  createdFiles: string[];
  validation: KbStructureValidationResult;
}

export function validateMinimumKbStructure(kbRoot: string): KbStructureValidationResult {
  const resolvedKbRoot = path.resolve(kbRoot);
  const missingDirectories: string[] = [];
  const missingFiles: string[] = [];
  const invalidPaths: string[] = [];

  if (!fs.existsSync(resolvedKbRoot)) {
    return {
      ok: false,
      kbRoot: resolvedKbRoot,
      missingDirectories: [...MINIMUM_KB_DIRECTORIES],
      missingFiles: [...MINIMUM_KB_FILES],
      invalidPaths,
    };
  }

  const kbRootStat = fs.statSync(resolvedKbRoot);
  if (!kbRootStat.isDirectory()) {
    return {
      ok: false,
      kbRoot: resolvedKbRoot,
      missingDirectories: [],
      missingFiles: [],
      invalidPaths: ["."],
    };
  }

  for (const relativeDir of MINIMUM_KB_DIRECTORIES) {
    const absoluteDir = path.resolve(resolvedKbRoot, relativeDir);
    if (!fs.existsSync(absoluteDir)) {
      missingDirectories.push(relativeDir);
      continue;
    }

    if (!fs.statSync(absoluteDir).isDirectory()) {
      invalidPaths.push(relativeDir);
    }
  }

  for (const relativeFile of MINIMUM_KB_FILES) {
    const absoluteFile = path.resolve(resolvedKbRoot, relativeFile);
    if (!fs.existsSync(absoluteFile)) {
      missingFiles.push(relativeFile);
      continue;
    }

    if (!fs.statSync(absoluteFile).isFile()) {
      invalidPaths.push(relativeFile);
    }
  }

  return {
    ok:
      missingDirectories.length === 0 &&
      missingFiles.length === 0 &&
      invalidPaths.length === 0,
    kbRoot: resolvedKbRoot,
    missingDirectories,
    missingFiles,
    invalidPaths,
  };
}

export function bootstrapExternalKbRoot(
  options: BootstrapExternalKbRootOptions
): BootstrapExternalKbRootResult {
  const repoRoot = path.resolve(options.repoRoot);
  const kbRoot = path.resolve(options.kbRoot);
  const now = options.now ?? new Date();

  assertKbRootWritableDirectory(kbRoot);

  const createdDirectories: string[] = [];
  for (const relativeDir of MINIMUM_KB_DIRECTORIES) {
    const absoluteDir = path.resolve(kbRoot, relativeDir);
    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
      createdDirectories.push(relativeDir);
      continue;
    }

    const stat = fs.statSync(absoluteDir);
    if (!stat.isDirectory()) {
      throw new Error(
        `KB bootstrap requires a directory at "${relativeDir}", but found a non-directory path.`
      );
    }
  }

  const filesToCreate = new Map<string, string>([
    ["wiki/index.md", buildBootstrapIndexPage(now)],
    ["wiki/log.md", buildBootstrapLogPage(now)],
    ["schema/wiki-conventions.md", readMainlineWikiConventions(repoRoot)],
    ["state/cache/page-index.json", buildBootstrapPageIndexJson()],
  ]);

  const createdFiles: string[] = [];
  for (const [relativeFile, content] of filesToCreate) {
    const absoluteFile = path.resolve(kbRoot, relativeFile);
    if (!fs.existsSync(absoluteFile)) {
      fs.writeFileSync(absoluteFile, content, "utf8");
      createdFiles.push(relativeFile);
      continue;
    }

    const stat = fs.statSync(absoluteFile);
    if (!stat.isFile()) {
      throw new Error(
        `KB bootstrap requires a file at "${relativeFile}", but found a non-file path.`
      );
    }
  }

  const validation = validateMinimumKbStructure(kbRoot);

  return {
    kbRoot,
    createdDirectories,
    createdFiles,
    validation,
  };
}

function assertKbRootWritableDirectory(kbRoot: string): void {
  if (fs.existsSync(kbRoot)) {
    const stat = fs.statSync(kbRoot);
    if (!stat.isDirectory()) {
      throw new Error(`KB root exists but is not a directory: ${kbRoot}`);
    }
    return;
  }

  fs.mkdirSync(kbRoot, { recursive: true });
}

function readMainlineWikiConventions(repoRoot: string): string {
  const conventionsPath = path.resolve(repoRoot, "kb", "schema", "wiki-conventions.md");
  if (!fs.existsSync(conventionsPath)) {
    throw new Error(
      `Missing mainline wiki conventions file at ${conventionsPath}.`
    );
  }

  return normalizeTextFile(fs.readFileSync(conventionsPath, "utf8"));
}

function buildBootstrapPageIndexJson(): string {
  return `${JSON.stringify({ pages: [] }, null, 2)}\n`;
}

function buildBootstrapIndexPage(now: Date): string {
  const day = formatDate(now);

  return normalizeTextFile(
    [
      "---",
      "id: wiki_index",
      "type: index",
      "title: Knowledge Base Index",
      `updated_at: ${day}`,
      "status: active",
      "---",
      "",
      "# Knowledge Base Index",
      "",
      "## Navigation",
      "- [[wiki_log|Change Log]] — ingest and edit history <!-- dedup:index_nav_wiki_log -->",
      "",
      "## Sources",
      "",
      "## Concepts",
      "",
      "## Entities",
      "",
      "## Analyses",
      "",
    ].join("\n")
  );
}

function buildBootstrapLogPage(now: Date): string {
  const day = formatDate(now);

  return normalizeTextFile(
    [
      "---",
      "id: wiki_log",
      "type: index",
      "title: Change Log",
      `updated_at: ${day}`,
      "status: active",
      "---",
      "",
      "# Change Log",
      "",
      "## Recent",
      "",
    ].join("\n")
  );
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeTextFile(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}
