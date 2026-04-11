// ============================================================
// Shared types for the OpenClaw Knowledge Base system
// ============================================================

// --- Source & Manifest ---

export type SourceKind = "markdown" | "plaintext";

export interface Manifest {
  source_id: string;
  source_locator: string;
  source_kind: SourceKind;
  content_hash: string;
  canonical_path: string;
  ingest_status: "registered" | "ingested" | "failed";
  created_at: string;
}

// --- Plan ---

export interface PlanCreateEntry {
  page_id: string;
  path: string;
  kind: "source_summary";
}

export interface PlanUpdateEntry {
  path: string;
  reason: string;
}

export interface PlanMoveEntry {
  page_id: string;
  from: string;
  to: string;
  rewrite_links: boolean;
}

export interface Plan {
  plan_id: string;
  source_id: string;
  status: "planned";
  create: PlanCreateEntry[];
  update: PlanUpdateEntry[];
  moves: PlanMoveEntry[];
  delete: string[];
  conflicts: string[];
  risk_level: "low" | "medium" | "high";
  notes: string;
}

// --- Draft ---

export interface DraftFileCreate {
  action: "create";
  path: string;
  content: string;
}

export interface DraftFileEnsureEntry {
  action: "ensure_entry";
  path: string;
  entry: string;
  anchor: string | null;
  dedup_key: string;
}

export interface DraftFileOverwrite {
  action: "overwrite";
  path: string;
  content: string;
}

export type DraftFile = DraftFileCreate | DraftFileEnsureEntry | DraftFileOverwrite;

export interface Draft {
  plan_id: string;
  status: "drafted";
  files: DraftFile[];
}

// --- Apply / Run ---

export interface CompletedFileRecord {
  path: string;
  op: "created" | "modified";
}

export interface InProgressRecord {
  run_id: string;
  plan_id: string;
  started_at: string;
  completed_files: CompletedFileRecord[];
}

export type RecoveryAction = "resume" | "rollback" | "force-clear";

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

// --- Wiki Page Frontmatter ---

export interface PageFrontmatter {
  id: string;
  type: "source" | "concept" | "entity" | "analysis" | "index" | "report";
  title: string;
  aliases?: string[];
  source_ids?: string[];
  updated_at: string;
  status: "active" | "stub" | "deprecated";
  tags?: string[];
  schema_migrated_at?: string;
  related?: string[];
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
