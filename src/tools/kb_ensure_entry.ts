import type { ToolResult, WorkspaceConfig } from "../types";
import { ensureWikiEntry } from "../core/wiki-log";

export interface KbEnsureEntryInput {
  path: string;
  entry: string;
  anchor: string | null;
  dedup_key: string;
}

export interface KbEnsureEntryOutput {
  action: "inserted" | "already_exists";
}

export async function kbEnsureEntry(
  input: KbEnsureEntryInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbEnsureEntryOutput>> {
  try {
    const data = ensureWikiEntry(input, config);

    return {
      success: true,
      data,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
