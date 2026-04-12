// ============================================================
// Shared types for the OpenClaw Knowledge Base system (V2)
// ============================================================

// --- Source & Manifest ---

export type SourceKind = "markdown" | "plaintext";

export interface Manifest {
  source_id: string;
  source_locator: string;
  source_kind: SourceKind;
  content_hash: string;
  canonical_path: string;
  file_name: string;
  ingest_status: "registered" | "ingested" | "failed";
  created_at: string;
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

// --- Search ---

export interface SearchResult {
  page_id: string;
  path: string;
  title: string;
  type: string;
  score: number;
  excerpt: string;
}

export interface SearchQuery {
  query: string;
  type_filter?: string;
  tags?: string[];
  limit?: number;
  resolve_link?: string;
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
