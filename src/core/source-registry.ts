import * as fs from "fs";
import * as path from "path";
import type { Manifest, SourceKind, WorkspaceConfig } from "../types";
import { resolveKbPath, sha256Buffer, validateSafeId } from "../utils";
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
