// ============================================================
// Shared types for the OpenClaw Knowledge Base system (V2)
// ============================================================

// --- Source & Manifest ---

export type SourceIngestStatus = "registered" | "ingested" | "failed";

export type SourceKind = "markdown" | "plaintext" | "converted_markdown";
export type SourceOrigin = "file" | "url";

export interface UrlSourceMetadata {
  original_url: string;
  normalized_url: string;
  final_url: string;
  captured_at: string;
  defuddle_version: string;
  fetch_status: number;
  content_type: string;
  transport_content_encoding: string | null;
  decoded_content_length: number;
  title: string | null;
  description: string | null;
  site: string | null;
  author: string | null;
  published: string | null;
  language: string | null;
  image: string | null;
  favicon: string | null;
  word_count: number | null;
  original_content_length: number | null;
}

export interface SourceConversionMetadata {
  required: boolean;
  converter: "none" | "plaintext" | "markitdown" | "defuddle";
  converter_version?: string;
  disabled_features: string[];
  warnings?: string[];
}

export interface Manifest {
  source_id: string;
  source_locator: string;
  source_origin: SourceOrigin;
  source_kind: SourceKind;
  /** Hash of the original source bytes; kept as source identity across converter changes. */
  content_hash: string;
  /** Canonical Markdown path consumed by kb_read_source / ingest. */
  canonical_path: string;
  file_name: string;
  ingest_status: SourceIngestStatus;
  created_at: string;

  /** Ingest lifecycle metadata written by kb_ingest_finalize. */
  ingested_at?: string;
  failed_at?: string;
  ingest_summary_page_id?: string;
  ingest_touched_pages?: string[];
  ingest_error?: string;

  /** Original file artifact for non-Markdown sources. Old manifests may omit these fields. */
  original_path?: string;
  original_file_name?: string;
  original_extension?: string;
  original_content_hash?: string;

  /** Canonical conversion artifact metadata. */
  converted_path?: string;
  converted_content_hash?: string;
  conversion?: SourceConversionMetadata;
  url_metadata?: UrlSourceMetadata;
  extraction_path?: string;
  extraction_content_hash?: string;
}

// --- Page Frontmatter ---

export interface PageFrontmatter {
  id: string;
  type: string;
  title: string;
  updated_at: string;
  status: "active" | "stub" | "deprecated";
  tags?: string[];
  aliases?: string[];
  source_ids?: string[];
  related?: string[];
  verification_status?: "verified" | "missing_raw_source";
  schema_migrated_at?: string;
}

// Core page types with directory mapping
export const CORE_PAGE_TYPES = [
  "source",
  "entity",
  "concept",
  "analysis",
  "index",
  "report",
] as const;
export type CorePageType = (typeof CORE_PAGE_TYPES)[number];

export const PAGE_TYPE_DIR_MAP: Record<CorePageType, string> = {
  source: "wiki/sources",
  entity: "wiki/entities",
  concept: "wiki/concepts",
  analysis: "wiki/analyses",
  index: "wiki",
  report: "wiki/reports",
};

// Page ID format: lowercase alphanumeric + underscore + hyphen
export const PAGE_ID_PATTERN = /^[a-z0-9_-]+$/;

// --- Frontmatter Validation ---

export interface FrontmatterValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parsed: Partial<PageFrontmatter>;
}

// --- Page Index ---

export interface PageIndexEntry {
  page_id: string;
  path: string;
  type: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: string[];
  body_excerpt: string;
}

export interface PageIndex {
  pages: PageIndexEntry[];
}

// --- Full-text Search Index ---

export interface SearchIndexChunk {
  chunk_id: string;
  page_id: string;
  path: string;
  type: string;
  title: string;
  heading_path: string[];
  text: string;
  source_ids: string[];
  tags: string[];
  outlinks: string[];
}

export interface SearchIndex {
  version: number;
  chunks: SearchIndexChunk[];
}

// --- Search ---

export interface SearchResult {
  page_id: string;
  path: string;
  title: string;
  type: string;
  score: number;
  excerpt: string;
  heading_path?: string[];
  match_text?: string;
}

export interface SearchQuery {
  query?: string;
  type_filter?: string;
  tags?: string[];
  limit?: number;
  resolve_link?: string;
  mode?: "page" | "chunk";
}

// --- Tool Results ---

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// --- Workspace Config ---

export interface WorkspaceConfig {
  kb_root: string; // absolute path to kb/ directory
}
