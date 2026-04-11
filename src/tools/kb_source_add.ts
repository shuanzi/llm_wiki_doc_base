import type { Manifest, SourceKind, ToolResult, WorkspaceConfig } from "../types";

export interface KbSourceAddInput {
  file_path: string; // path to the .md or .txt file to ingest
}

export interface KbSourceAddOutput {
  source_id: string;
  content_hash: string;
  canonical_path: string;
  manifest: Manifest;
}

/**
 * kb_source_add — Register a source file and write it to kb/raw/.
 *
 * MVP: only accepts .md and .txt files.
 * Generates a stable source_id from content hash (src_sha256_<prefix>).
 * Creates manifest in kb/state/manifests/.
 * Deduplicates by content hash + canonical locator.
 */
export async function kbSourceAdd(
  input: KbSourceAddInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbSourceAddOutput>> {
  // TODO: implement
  throw new Error("Not implemented");
}
