import * as fs from "fs";
import * as path from "path";
import type { Manifest, SourceIngestStatus, SourceKind, WorkspaceConfig } from "../types";
import {
  parseFrontmatter,
  resolveKbPath,
  sha256Buffer,
  validateFrontmatter,
  validateSafeId,
} from "../utils";
import {
  convertSourceToMarkdown,
  isMarkdownExtension,
  validateSourceFile,
} from "./source-conversion";

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

export interface FinalizeSourceIngestInput {
  source_id: string;
  status: Exclude<SourceIngestStatus, "registered">;
  summary_page_id?: string;
  touched_pages?: string[];
  error?: string;
}

export interface ReadRegisteredSourceOptions {
  offset_bytes?: number;
  max_bytes?: number;
}

export interface ReadRegisteredSourceResult {
  source_id: string;
  source_kind: SourceKind;
  file_name: string;
  content: string;
  offset_bytes: number;
  returned_bytes: number;
  total_bytes: number;
  truncated: boolean;
  next_offset_bytes?: number;
  warning?: string;
}

export const MAX_SOURCE_CONTENT_BYTES = 200 * 1024;

const CANONICAL_SOURCE_EXTENSION = ".md";

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

function generateSourceIdFromHash(
  fullHash: string,
  existingIds: Set<string>
): { source_id: string; content_hash: string } {
  for (const prefixLength of [8, 12, 16, 24, 32, fullHash.length]) {
    const sourceId = `src_sha256_${fullHash.substring(0, prefixLength)}`;
    if (!existingIds.has(sourceId)) {
      return {
        source_id: sourceId,
        content_hash: `sha256:${fullHash}`,
      };
    }
  }

  throw new Error("Unable to generate unique source_id for source file hash.");
}

function toOptionalManifestString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function canonicalFileName(sourceId: string): string {
  return `${sourceId}${CANONICAL_SOURCE_EXTENSION}`;
}

function originalFileName(sourceId: string, extension: string): string {
  return `${sourceId}${extension || ".bin"}`;
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


function manifestPath(sourceId: string, workspace: WorkspaceLike): string {
  validateSafeId(sourceId, "source_id");
  return resolveKbPath(`state/manifests/${sourceId}.json`, getKbRoot(workspace));
}

function assertFinalizeStatus(status: string): asserts status is Exclude<SourceIngestStatus, "registered"> {
  if (status !== "ingested" && status !== "failed") {
    throw new Error("status must be ingested or failed.");
  }
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep);
}

function assertNoSymlinkedWikiAncestors(
  pagePath: string,
  resolvedPath: string,
  wikiRoot: string
): void {
  let currentPath = path.dirname(resolvedPath);
  while (isWithinRoot(currentPath, wikiRoot)) {
    if (fs.existsSync(currentPath) && fs.lstatSync(currentPath).isSymbolicLink()) {
      throw new Error(`touched_pages entry must not traverse a symlinked directory: ${pagePath}`);
    }

    if (currentPath === wikiRoot) {
      break;
    }

    currentPath = path.dirname(currentPath);
  }
}

function assertTouchedPages(touchedPages: string[] | undefined, workspace: WorkspaceLike): void {
  if (!touchedPages || touchedPages.length === 0) {
    return;
  }

  const kbRoot = getKbRoot(workspace);
  const wikiRoot = resolveKbPath("wiki", kbRoot);
  const realWikiRoot = fs.realpathSync(wikiRoot);
  for (const pagePath of touchedPages) {
    if (typeof pagePath !== "string" || pagePath.trim().length === 0) {
      throw new Error("touched_pages entries must be non-empty strings.");
    }

    const resolvedPath = resolveKbPath(pagePath, kbRoot);
    if (resolvedPath !== wikiRoot && !resolvedPath.startsWith(wikiRoot + path.sep)) {
      throw new Error(`touched_pages entry must resolve within kb/wiki/: ${pagePath}`);
    }

    if (!resolvedPath.endsWith(".md")) {
      throw new Error(`touched_pages entry must be a markdown file within kb/wiki/: ${pagePath}`);
    }
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`touched_pages entry must reference an existing file: ${pagePath}`);
    }
    assertNoSymlinkedWikiAncestors(pagePath, resolvedPath, wikiRoot);
    const linkStats = fs.lstatSync(resolvedPath);
    if (linkStats.isSymbolicLink()) {
      throw new Error(`touched_pages entry must not reference a symlink: ${pagePath}`);
    }
    const realPath = fs.realpathSync(resolvedPath);
    if (realPath !== realWikiRoot && !realPath.startsWith(realWikiRoot + path.sep)) {
      throw new Error(`touched_pages entry must resolve within kb/wiki/: ${pagePath}`);
    }
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`touched_pages entry must reference a markdown file: ${pagePath}`);
    }
  }
}

function listWikiMarkdownFiles(workspace: WorkspaceLike): string[] {
  const wikiRoot = resolveKbPath("wiki", getKbRoot(workspace));
  if (!fs.existsSync(wikiRoot) || !fs.statSync(wikiRoot).isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const stack = [wikiRoot];

  while (stack.length > 0) {
    const currentPath = stack.pop() as string;
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function assertSummaryPageExists(summaryPageId: string, workspace: WorkspaceLike): void {
  const markdownFiles = listWikiMarkdownFiles(workspace);
  const matches: string[] = [];
  for (const absolutePath of markdownFiles) {
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(fs.readFileSync(absolutePath, "utf8"));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `summary_page_id uniqueness cannot be verified because ${absolutePath} has invalid frontmatter: ${message}`
      );
    }

    const pageId = parsed.frontmatter.id;
    if (pageId !== summaryPageId) {
      continue;
    }

    const validation = validateFrontmatter(parsed.frontmatter);
    if (!validation.valid) {
      throw new Error(
        `summary_page_id uniqueness cannot be verified because ${absolutePath} has invalid frontmatter: ${validation.errors.join("; ")}`
      );
    }
    matches.push(absolutePath);
  }

  if (matches.length === 0) {
    throw new Error(`summary_page_id must reference an existing wiki page id: ${summaryPageId}`);
  }
  if (matches.length > 1) {
    throw new Error(`summary_page_id must reference a unique wiki page id: ${summaryPageId}`);
  }
}

export function finalizeSourceIngest(
  input: FinalizeSourceIngestInput,
  workspace: WorkspaceLike
): Manifest {
  validateSafeId(input.source_id, "source_id");
  assertFinalizeStatus(input.status);
  if (input.status === "ingested" && !input.summary_page_id) {
    throw new Error("summary_page_id is required when status is ingested.");
  }
  if (input.status === "failed" && (!input.error || input.error.trim().length === 0)) {
    throw new Error("error is required when status is failed.");
  }
  if (input.summary_page_id) {
    validateSafeId(input.summary_page_id, "summary_page_id");
  }
  const manifest = loadSourceManifest(input.source_id, workspace);
  if (manifest.ingest_status !== "registered") {
    throw new Error(
      `Cannot finalize source_id ${input.source_id}: ingest_status is ${manifest.ingest_status}; only registered can be finalized.`
    );
  }
  if (input.summary_page_id) {
    assertSummaryPageExists(input.summary_page_id, workspace);
  }
  assertTouchedPages(input.touched_pages, workspace);

  const now = new Date().toISOString();
  const updatedManifest: Manifest = {
    ...manifest,
    ingest_status: input.status,
    ingest_summary_page_id: input.summary_page_id,
    ingest_touched_pages: input.touched_pages,
    ingest_error: input.status === "failed" ? input.error : undefined,
    ingested_at: input.status === "ingested" ? now : undefined,
    failed_at: input.status === "failed" ? now : undefined,
  };

  fs.writeFileSync(manifestPath(input.source_id, workspace), JSON.stringify(updatedManifest, null, 2), "utf8");
  return updatedManifest;
}

export function registerSourceFile(
  input: RegisterSourceFileInput,
  workspace: WorkspaceLike
): RegisterSourceFileResult {
  const kbRoot = getKbRoot(workspace);
  const sourceFile = validateSourceFile(input.file_path);
  const originalContentHashFull = sha256Buffer(sourceFile.originalBuffer);
  const originalContentHashPrefixed = `sha256:${originalContentHashFull}`;
  const dir = manifestsDir(kbRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existingIds = new Set<string>();
  for (const manifest of listRegisteredManifests(kbRoot)) {
    existingIds.add(manifest.source_id);
    const manifestOriginalHash = toOptionalManifestString(manifest.original_content_hash);
    if (
      manifest.content_hash === originalContentHashPrefixed ||
      manifestOriginalHash === originalContentHashPrefixed
    ) {
      throw new Error(
        `Duplicate content: source already registered as ${manifest.source_id} (${manifest.source_locator})`
      );
    }
  }

  const { source_id, content_hash } = generateSourceIdFromHash(
    originalContentHashFull,
    existingIds
  );
  const conversion = convertSourceToMarkdown(sourceFile);

  const inboxDir = resolveKbPath("raw/inbox", kbRoot);
  if (!fs.existsSync(inboxDir)) {
    fs.mkdirSync(inboxDir, { recursive: true });
  }

  const canonical_path = `raw/inbox/${canonicalFileName(source_id)}`;
  const destinationPath = resolveKbPath(canonical_path, kbRoot);
  fs.writeFileSync(destinationPath, conversion.canonical_markdown, "utf8");

  let original_path: string | undefined;
  if (!isMarkdownExtension(sourceFile.extension)) {
    const originalsDir = resolveKbPath("raw/originals", kbRoot);
    if (!fs.existsSync(originalsDir)) {
      fs.mkdirSync(originalsDir, { recursive: true });
    }

    original_path = `raw/originals/${originalFileName(source_id, sourceFile.extension)}`;
    fs.writeFileSync(resolveKbPath(original_path, kbRoot), sourceFile.originalBuffer);
  }

  const file_name = path.basename(input.file_path);
  const manifest: Manifest = {
    source_id,
    source_locator: buildSourceLocator(input.file_path),
    source_kind: conversion.source_kind,
    content_hash,
    canonical_path,
    file_name,
    ingest_status: "registered",
    created_at: new Date().toISOString(),
    original_path,
    original_file_name: file_name,
    original_extension: sourceFile.extension,
    original_content_hash: content_hash,
    converted_path: canonical_path,
    converted_content_hash: conversion.converted_content_hash,
    conversion: conversion.conversion,
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

function normalizeReadOptions(
  optionsOrMaxBytes?: ReadRegisteredSourceOptions | number
): Required<ReadRegisteredSourceOptions> {
  if (typeof optionsOrMaxBytes === "number") {
    return {
      offset_bytes: 0,
      max_bytes: optionsOrMaxBytes,
    };
  }

  return {
    offset_bytes: optionsOrMaxBytes?.offset_bytes ?? 0,
    max_bytes: optionsOrMaxBytes?.max_bytes ?? MAX_SOURCE_CONTENT_BYTES,
  };
}

function assertValidReadWindow(offsetBytes: number, maxBytes: number): void {
  if (!Number.isInteger(offsetBytes) || offsetBytes < 0) {
    throw new Error("offset_bytes must be a non-negative integer.");
  }

  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("max_bytes must be a positive integer.");
  }
}

function isUtf8Boundary(buffer: Buffer, index: number): boolean {
  return index <= 0 || index >= buffer.byteLength || (buffer[index] & 0xc0) !== 0x80;
}

function alignEndToUtf8Boundary(
  buffer: Buffer,
  startBytes: number,
  requestedEndBytes: number
): number {
  if (requestedEndBytes >= buffer.byteLength) {
    return buffer.byteLength;
  }

  let endBytes = requestedEndBytes;
  while (endBytes > startBytes && !isUtf8Boundary(buffer, endBytes)) {
    endBytes--;
  }

  if (endBytes > startBytes) {
    return endBytes;
  }

  endBytes = requestedEndBytes;
  while (endBytes < buffer.byteLength && !isUtf8Boundary(buffer, endBytes)) {
    endBytes++;
  }

  return endBytes;
}

export function readRegisteredSource(
  sourceId: string,
  workspace: WorkspaceLike,
  optionsOrMaxBytes?: ReadRegisteredSourceOptions | number
): ReadRegisteredSourceResult {
  const manifest = loadSourceManifest(sourceId, workspace);
  const sourcePath = resolveKbPath(manifest.canonical_path, getKbRoot(workspace));

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found at canonical path: ${manifest.canonical_path}`);
  }

  const options = normalizeReadOptions(optionsOrMaxBytes);
  assertValidReadWindow(options.offset_bytes, options.max_bytes);

  const rawBuffer = fs.readFileSync(sourcePath);
  const totalBytes = rawBuffer.byteLength;
  const offsetBytes = Math.min(options.offset_bytes, totalBytes);
  if (!isUtf8Boundary(rawBuffer, offsetBytes)) {
    throw new Error("offset_bytes must point to a UTF-8 character boundary.");
  }

  const requestedEndBytes = Math.min(offsetBytes + options.max_bytes, totalBytes);
  const endBytes = alignEndToUtf8Boundary(rawBuffer, offsetBytes, requestedEndBytes);
  const returnedBytes = endBytes - offsetBytes;
  const truncated = endBytes < totalBytes;
  const nextOffsetBytes = truncated ? endBytes : undefined;
  const content = rawBuffer.slice(offsetBytes, endBytes).toString("utf8");
  let warning: string | undefined;

  if (truncated) {
    warning =
      `Content truncated at ${endBytes} of ${totalBytes} bytes. ` +
      `Call kb_read_source with offset_bytes=${endBytes} to continue.`;
  }

  return {
    source_id: manifest.source_id,
    source_kind: manifest.source_kind,
    file_name: manifest.file_name,
    content,
    offset_bytes: offsetBytes,
    returned_bytes: returnedBytes,
    total_bytes: totalBytes,
    truncated,
    next_offset_bytes: nextOffsetBytes,
    warning,
  };
}
