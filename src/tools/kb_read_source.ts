import type { SourceKind, ToolResult, WorkspaceConfig } from "../types";
import { readRegisteredSource } from "../core/source-registry";

export interface KbReadSourceInput {
  source_id: string;
}

export interface KbReadSourceOutput {
  source_id: string;
  source_kind: SourceKind;
  file_name: string;
  content: string;
}

export async function kbReadSource(
  input: KbReadSourceInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbReadSourceOutput>> {
  try {
    const data = readRegisteredSource(input.source_id, config);

    return {
      success: true,
      data,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
