import type { Manifest, ToolResult, WorkspaceConfig } from "../types";
import { finalizeSourceIngest, type FinalizeSourceIngestInput } from "../core/source-registry";

export type KbIngestFinalizeInput = FinalizeSourceIngestInput;

export interface KbIngestFinalizeOutput {
  source_id: string;
  ingest_status: Manifest["ingest_status"];
  manifest: Manifest;
}

export async function kbIngestFinalize(
  input: KbIngestFinalizeInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbIngestFinalizeOutput>> {
  try {
    const manifest = finalizeSourceIngest(input, config);
    return {
      success: true,
      data: { source_id: manifest.source_id, ingest_status: manifest.ingest_status, manifest },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
