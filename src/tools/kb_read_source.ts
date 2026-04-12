import type { Manifest, SourceKind, ToolResult, WorkspaceConfig } from "../types";

export interface KbReadSourceInput {
  source_id: string;
}

export interface KbReadSourceOutput {
  source_id: string;
  source_kind: SourceKind;
  file_name: string;
  content: string;
}

/**
 * kb_read_source — Read raw source content by source_id.
 * Large file truncation at 200KB.
 */
export async function kbReadSource(
  input: KbReadSourceInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbReadSourceOutput>> {
  // TODO: implement
  throw new Error("Not implemented");
}
