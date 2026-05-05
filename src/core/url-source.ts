import * as fs from "node:fs";
import * as path from "node:path";
import type { DefuddleParseResult, ParseHtmlWithDefuddleInput } from "./defuddle-parser";
import { parseHtmlWithDefuddle } from "./defuddle-parser";
import type { FetchedPublicHtml, FetchPublicHtmlOptions } from "./url-fetch";
import { fetchPublicHtml, normalizePublicHttpUrl } from "./url-fetch";
import { listRegisteredManifests } from "./source-registry";
import type { Manifest, WorkspaceConfig } from "../types";
import { resolveKbPath, sha256Buffer } from "../utils";

export interface RegisterUrlSourceInput {
  url: string;
  accept_language?: string;
}

export interface RegisterUrlSourceResult {
  source_id: string;
  content_hash: string;
  canonical_path: string;
  file_name: string;
  title: string | null;
  description: string | null;
  word_count: number | null;
  manifest: Manifest;
}

export interface RegisterUrlSourceDeps {
  fetchHtml?: (
    url: string,
    options: Pick<FetchPublicHtmlOptions, "accept_language">
  ) => Promise<FetchedPublicHtml>;
  parseHtml?: (input: ParseHtmlWithDefuddleInput) => Promise<DefuddleParseResult>;
  now?: () => string;
  writeFile?: WriteUrlSourceFile;
}

const MAX_EXTRACTION_BYTES = 262_144;
const MARKDOWN_TRUNCATION_BUDGET = 64 * 1024;
const DESCRIPTION_TRUNCATION_BUDGET = 2_048;
const TRUNCATED_SUFFIX = "...[TRUNCATED]";
const DEFUDDLE_VERSION = "0.18.1";
const URL_DISABLED_FEATURES = [
  "authenticated",
  "javascript",
  "private-network",
  "async-third-party",
];

interface ExtractionPayload {
  bytes: Buffer;
  content_hash: string;
  warnings: string[];
}

type WriteUrlSourceFile = (
  filePath: string,
  data: string | Buffer,
  encoding?: BufferEncoding
) => boolean;

export async function registerUrlSource(
  input: RegisterUrlSourceInput,
  workspace: WorkspaceConfig,
  deps: RegisterUrlSourceDeps = {}
): Promise<RegisterUrlSourceResult> {
  const kbRoot = workspace.kb_root;
  const fetchHtml = deps.fetchHtml ?? fetchPublicHtml;
  const parseHtml = deps.parseHtml ?? parseHtmlWithDefuddle;
  const capturedAt = deps.now?.() ?? new Date().toISOString();
  normalizePublicHttpUrl(input.url);
  const fetched = await fetchHtml(input.url, {
    accept_language: input.accept_language,
  });
  const fullHash = sha256Buffer(fetched.decoded_entity_bytes);
  const content_hash = `sha256:${fullHash}`;
  const manifestsDir = resolveKbPath("state/manifests", kbRoot);
  fs.mkdirSync(manifestsDir, { recursive: true });

  const existingIds = new Set<string>();
  for (const manifest of listRegisteredManifests(workspace)) {
    existingIds.add(manifest.source_id);
    if (
      manifest.content_hash === content_hash ||
      manifest.original_content_hash === content_hash
    ) {
      throw new Error(
        `Duplicate content: source already registered as ${manifest.source_id} (${manifest.source_locator})`
      );
    }
  }

  const source_id = generateSourceIdFromHash(fullHash, existingIds);
  const parsed = await parseHtml({
    html: fetched.decoded_html,
    final_url: fetched.final_url,
  });
  const base = buildUrlDisplayBase(fetched.normalized_url);
  const canonical_path = `raw/inbox/${source_id}.md`;
  const original_path = `raw/originals/${source_id}.html`;
  const extraction_path = `state/extractions/${source_id}.defuddle.json`;
  const canonicalMarkdown = buildCanonicalMarkdown(fetched, content_hash, parsed);
  const canonicalBytes = Buffer.from(canonicalMarkdown, "utf8");
  const converted_content_hash = `sha256:${sha256Buffer(canonicalBytes)}`;
  const extraction = buildExtractionPayload(fetched, parsed);
  const warnings = [...fetched.warnings, ...extraction.warnings];
  const manifest: Manifest = {
    source_id,
    source_locator: fetched.normalized_url,
    source_origin: "url",
    source_kind: "converted_markdown",
    content_hash,
    canonical_path,
    file_name: `${base}.md`,
    ingest_status: "registered",
    created_at: capturedAt,
    original_path,
    original_file_name: `${base}.html`,
    original_extension: ".html",
    original_content_hash: content_hash,
    converted_path: canonical_path,
    converted_content_hash,
    extraction_path,
    extraction_content_hash: extraction.content_hash,
    conversion: {
      required: true,
      converter: "defuddle",
      converter_version: DEFUDDLE_VERSION,
      disabled_features: URL_DISABLED_FEATURES,
      warnings,
    },
    url_metadata: {
      original_url: fetched.original_url,
      normalized_url: fetched.normalized_url,
      final_url: fetched.final_url,
      captured_at: capturedAt,
      defuddle_version: parsed.defuddle_version,
      fetch_status: fetched.fetch_status,
      content_type: fetched.content_type,
      transport_content_encoding: fetched.transport_content_encoding,
      decoded_content_length: fetched.decoded_content_length,
      title: parsed.title,
      description: parsed.description,
      site: parsed.site,
      author: parsed.author,
      published: parsed.published,
      language: parsed.language,
      image: parsed.image,
      favicon: parsed.favicon,
      word_count: parsed.word_count,
      original_content_length: fetched.original_content_length,
    },
  };

  writeUrlSourceArtifacts({
    kbRoot,
    manifestsDir,
    manifest,
    canonical_path,
    canonicalBytes,
    original_path,
    originalBytes: fetched.decoded_entity_bytes,
    extraction_path,
    extractionBytes: extraction.bytes,
    writeFile: deps.writeFile,
  });

  return {
    source_id,
    content_hash,
    canonical_path,
    file_name: manifest.file_name,
    title: parsed.title,
    description: parsed.description,
    word_count: parsed.word_count,
    manifest,
  };
}

interface WriteUrlSourceArtifactsInput {
  kbRoot: string;
  manifestsDir: string;
  manifest: Manifest;
  canonical_path: string;
  canonicalBytes: Buffer;
  original_path: string;
  originalBytes: Buffer;
  extraction_path: string;
  extractionBytes: Buffer;
  writeFile?: WriteUrlSourceFile;
}

function writeUrlSourceArtifacts(input: WriteUrlSourceArtifactsInput): void {
  const writeFile = input.writeFile ?? defaultWriteFile;
  const canonicalFullPath = resolveKbPath(input.canonical_path, input.kbRoot);
  const originalFullPath = resolveKbPath(input.original_path, input.kbRoot);
  const extractionFullPath = resolveKbPath(input.extraction_path, input.kbRoot);
  const manifestFullPath = path.join(input.manifestsDir, `${input.manifest.source_id}.json`);
  const candidatePaths = [
    canonicalFullPath,
    originalFullPath,
    extractionFullPath,
    manifestFullPath,
  ];

  fs.mkdirSync(resolveKbPath("raw/inbox", input.kbRoot), { recursive: true });
  fs.mkdirSync(resolveKbPath("raw/originals", input.kbRoot), { recursive: true });
  fs.mkdirSync(resolveKbPath("state/extractions", input.kbRoot), { recursive: true });

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      throw new Error(`URL source artifact already exists: ${candidatePath}`);
    }
  }

  const writtenPaths: string[] = [];
  try {
    if (writeFile(canonicalFullPath, input.canonicalBytes)) {
      writtenPaths.push(canonicalFullPath);
    }
    if (writeFile(originalFullPath, input.originalBytes)) {
      writtenPaths.push(originalFullPath);
    }
    if (writeFile(extractionFullPath, input.extractionBytes)) {
      writtenPaths.push(extractionFullPath);
    }
    if (writeFile(manifestFullPath, JSON.stringify(input.manifest, null, 2), "utf8")) {
      writtenPaths.push(manifestFullPath);
    }
  } catch (error) {
    cleanupWrittenArtifacts(writtenPaths);
    throw error;
  }
}

function defaultWriteFile(
  filePath: string,
  data: string | Buffer,
  encoding?: BufferEncoding
): boolean {
  if (encoding) {
    fs.writeFileSync(filePath, data, { encoding, flag: "wx" });
    return true;
  }
  fs.writeFileSync(filePath, data, { flag: "wx" });
  return true;
}

function cleanupWrittenArtifacts(filePaths: string[]): void {
  for (const filePath of [...filePaths].reverse()) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Best-effort cleanup; preserve the original write failure.
    }
  }
}

export function buildUrlDisplayBase(normalizedUrl: string): string {
  const parsed = new URL(normalizedUrl);
  const hostPart = parsed.hostname.toLowerCase();
  const rawLeaf = parsed.pathname.endsWith("/")
    ? "index"
    : parsed.pathname.split("/").pop() || "index";
  let leaf: string;
  try {
    leaf = decodeURIComponent(rawLeaf);
  } catch {
    leaf = rawLeaf;
  }
  leaf = leaf.replace(/\.x?html?$/iu, "");
  let base = `${hostPart}-${leaf}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (!base) {
    base = "url-source";
  }
  if (base.length > 96) {
    const digest = sha256Buffer(Buffer.from(normalizedUrl, "utf8")).slice(0, 12);
    base = `${base.slice(0, 80)}-${digest}`;
  }
  return base;
}

export function escapeProvenanceValue(value: string): string {
  let out = "";
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint !== undefined &&
      codePoint >= 0x20 &&
      codePoint <= 0x7e &&
      char !== "%" &&
      char !== "-"
    ) {
      out += char;
      continue;
    }
    for (const byte of Buffer.from(char, "utf8")) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function normalizeMarkdownBody(markdown: string): string {
  return `${markdown.replace(/\r\n?/gu, "\n").trimEnd()}\n`;
}

function buildCanonicalMarkdown(
  fetched: FetchedPublicHtml,
  contentHash: string,
  parsed: DefuddleParseResult
): string {
  return [
    "<!-- kb-source-provenance:v1",
    "source_origin: url",
    `content_hash: ${contentHash}`,
    `original_url: ${escapeProvenanceUrl(fetched.original_url)}`,
    `normalized_url: ${escapeProvenanceValue(fetched.normalized_url)}`,
    `final_url: ${escapeProvenanceValue(fetched.final_url)}`,
    "-->",
    "",
    normalizeMarkdownBody(parsed.content_markdown),
  ].join("\n");
}

function escapeProvenanceUrl(value: string): string {
  return escapeProvenanceValue(value).replace(/#/gu, "%23");
}

function buildExtractionPayload(
  fetched: FetchedPublicHtml,
  parsed: DefuddleParseResult
): ExtractionPayload {
  const warnings: string[] = [];
  let contentHtml = parsed.content_html;
  let contentMarkdown = normalizeMarkdownBody(parsed.content_markdown);
  let description = parsed.description;
  let payload = buildExtractionObject(fetched, parsed, contentHtml, contentMarkdown, description, warnings);
  let bytes = stableJsonBytes(payload);

  if (bytes.byteLength > MAX_EXTRACTION_BYTES) {
    contentHtml = null;
    warnings.push("extraction_content_html_omitted_for_size");
    payload = buildExtractionObject(fetched, parsed, contentHtml, contentMarkdown, description, warnings);
    bytes = stableJsonBytes(payload);
  }
  if (bytes.byteLength > MAX_EXTRACTION_BYTES) {
    contentMarkdown = truncateString(contentMarkdown, MARKDOWN_TRUNCATION_BUDGET);
    warnings.push("extraction_content_markdown_truncated_for_size");
    payload = buildExtractionObject(fetched, parsed, contentHtml, contentMarkdown, description, warnings);
    bytes = stableJsonBytes(payload);
  }
  if (bytes.byteLength > MAX_EXTRACTION_BYTES && description !== null) {
    description = truncateString(description, DESCRIPTION_TRUNCATION_BUDGET);
    warnings.push("extraction_metadata_description_truncated_for_size");
    payload = buildExtractionObject(fetched, parsed, contentHtml, contentMarkdown, description, warnings);
    bytes = stableJsonBytes(payload);
  }
  if (bytes.byteLength > MAX_EXTRACTION_BYTES) {
    throw new Error("Defuddle extraction JSON exceeded 262144 byte limit.");
  }

  return {
    bytes,
    content_hash: `sha256:${sha256Buffer(bytes)}`,
    warnings,
  };
}

function buildExtractionObject(
  fetched: FetchedPublicHtml,
  parsed: DefuddleParseResult,
  contentHtml: string | null,
  contentMarkdown: string,
  description: string | null,
  warnings: string[]
): Record<string, unknown> {
  return {
    schema_version: 1,
    source_origin: "url",
    normalized_url: fetched.normalized_url,
    final_url: fetched.final_url,
    defuddle_version: parsed.defuddle_version,
    metadata: {
      title: parsed.title,
      description,
      site: parsed.site,
      author: parsed.author,
      published: parsed.published,
      language: parsed.language,
      image: parsed.image,
      favicon: parsed.favicon,
      word_count: parsed.word_count,
      parse_time_ms: parsed.parse_time_ms,
    },
    content_html: contentHtml,
    content_markdown: contentMarkdown,
    truncation: {
      warnings,
    },
  };
}

function stableJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function truncateString(value: string, budget: number): string {
  return `${value.slice(0, budget)}${TRUNCATED_SUFFIX}`;
}

function generateSourceIdFromHash(fullHash: string, existingIds: Set<string>): string {
  for (const prefixLength of [8, 12, 16, 24, 32, fullHash.length]) {
    const sourceId = `src_sha256_${fullHash.substring(0, prefixLength)}`;
    if (!existingIds.has(sourceId)) {
      return sourceId;
    }
  }

  throw new Error("Unable to generate unique source_id for URL source hash.");
}
