import type { Manifest, ToolResult, WorkspaceConfig } from "../types";
import { registerSourceFile } from "../core/source-registry";

export interface KbSourceAddInput {
  file_path: string; // path to the .md or .txt file to ingest
}

export interface KbSourceAddOutput {
  source_id: string;
  content_hash: string;
  canonical_path: string;
  file_name: string;
  manifest: Manifest;
}

export async function kbSourceAdd(
  input: KbSourceAddInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbSourceAddOutput>> {
  try {
    const {
      source_id,
      content_hash,
      canonical_path,
      file_name,
      manifest,
    } = registerSourceFile(input, config);

    return {
      success: true,
      data: { source_id, content_hash, canonical_path, file_name, manifest },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
