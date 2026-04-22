import * as fs from "fs";
import * as path from "path";
import type { Manifest, SourceKind, WorkspaceConfig } from "../types";
import { generateSourceId, resolveKbPath, sha256, validateSafeId } from "../utils";

export interface RegisterSourceFileInput {
  file_path: string;
}

export interface RegisterSourceFileResult {
  source_id: string;
  content_hash: string;
  canonical_path: string;
  file_name: string;
  manifest: Manifest;
}

export interface ReadRegisteredSourceResult {
  source_id: string;
  source_kind: SourceKind;
  file_name: string;
  content: string;
}

export const MAX_SOURCE_CONTENT_BYTES = 200 * 1024;

const ALLOWED_EXTENSIONS = new Set([".md", ".txt"]);

type WorkspaceLike = string | WorkspaceConfig;

function getKbRoot(workspace: WorkspaceLike): string {
  return typeof workspace === "string" ? workspace : workspace.kb_root;
}

function manifestsDir(workspace: WorkspaceLike): string {
  return resolveKbPath("state/manifests", getKbRoot(workspace));
}

function buildSourceLocator(filePath: string): string {
  return path.basename(filePath);
}

export function listRegisteredManifests(workspace: WorkspaceLike): Manifest[] {
  const dir = manifestsDir(workspace);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const manifests: Manifest[] = [];
  for (const fileName of fs.readdirSync(dir)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    try {
      manifests.push(
        JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf8")) as Manifest
      );
    } catch {
      // Malformed manifests are skipped to preserve current registration behavior.
    }
  }

  return manifests;
}

export function loadSourceManifest(sourceId: string, workspace: WorkspaceLike): Manifest {
  validateSafeId(sourceId, "source_id");

  const manifestPath = resolveKbPath(
    `state/manifests/${sourceId}.json`,
    getKbRoot(workspace)
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found for source_id: ${sourceId}`);
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  } catch {
    throw new Error(`Malformed manifest for source_id: ${sourceId}`);
  }
}

export function registerSourceFile(
  input: RegisterSourceFileInput,
  workspace: WorkspaceLike
): RegisterSourceFileResult {
  const kbRoot = getKbRoot(workspace);
  const extension = path.extname(input.file_path).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported file type "${extension}". MVP only supports: ${[...ALLOWED_EXTENSIONS].join(", ")}`
    );
  }

  const absolutePath = path.resolve(input.file_path);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Source file not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  const dir = manifestsDir(kbRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existingIds = new Set<string>();
  const contentHashFull = sha256(content);
  const contentHashPrefixed = `sha256:${contentHashFull}`;

  for (const manifest of listRegisteredManifests(kbRoot)) {
    existingIds.add(manifest.source_id);
    if (manifest.content_hash === contentHashPrefixed) {
      throw new Error(
        `Duplicate content: source already registered as ${manifest.source_id} (${manifest.source_locator})`
      );
    }
  }

  const { source_id, content_hash } = generateSourceId(content, existingIds);
  const source_kind: SourceKind = extension === ".md" ? "markdown" : "plaintext";

  const inboxDir = resolveKbPath("raw/inbox", kbRoot);
  if (!fs.existsSync(inboxDir)) {
    fs.mkdirSync(inboxDir, { recursive: true });
  }

  const canonical_path = `raw/inbox/${source_id}${extension}`;
  const destinationPath = resolveKbPath(canonical_path, kbRoot);
  fs.copyFileSync(absolutePath, destinationPath);

  const file_name = path.basename(input.file_path);
  const manifest: Manifest = {
    source_id,
    source_locator: buildSourceLocator(input.file_path),
    source_kind,
    content_hash,
    canonical_path,
    file_name,
    ingest_status: "registered",
    created_at: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(dir, `${source_id}.json`), JSON.stringify(manifest, null, 2), "utf8");

  return {
    source_id,
    content_hash,
    canonical_path,
    file_name,
    manifest,
  };
}

export function readRegisteredSource(
  sourceId: string,
  workspace: WorkspaceLike,
  maxContentBytes: number = MAX_SOURCE_CONTENT_BYTES
): ReadRegisteredSourceResult {
  const manifest = loadSourceManifest(sourceId, workspace);
  const sourcePath = resolveKbPath(manifest.canonical_path, getKbRoot(workspace));

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found at canonical path: ${manifest.canonical_path}`);
  }

  const rawBuffer = fs.readFileSync(sourcePath);
  let content = rawBuffer.toString("utf8");

  if (rawBuffer.byteLength > maxContentBytes) {
    content = rawBuffer.slice(0, maxContentBytes).toString("utf8");
    content +=
      "\n\n[WARNING: Content truncated. File exceeds 200KB limit. " +
      `Original size: ${rawBuffer.byteLength} bytes.]`;
  }

  return {
    source_id: manifest.source_id,
    source_kind: manifest.source_kind,
    file_name: manifest.file_name,
    content,
  };
}
