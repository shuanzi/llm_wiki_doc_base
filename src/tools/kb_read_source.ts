import type { SourceKind, ToolResult, WorkspaceConfig } from "../types";
import { readRegisteredSource } from "../core/source-registry";

export interface KbReadSourceInput {
  source_id: string;
  offset_bytes?: number;
  max_bytes?: number;
}

export interface KbReadSourceOutput {
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

export async function kbReadSource(
  input: KbReadSourceInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbReadSourceOutput>> {
  try {
    const data = readRegisteredSource(input.source_id, config, {
      offset_bytes: input.offset_bytes,
      max_bytes: input.max_bytes,
    });

    return {
      success: true,
      data,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
