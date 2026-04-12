import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbEnsureEntryInput {
  path: string;
  entry: string;
  anchor: string | null;
  dedup_key: string;
}

export interface KbEnsureEntryOutput {
  action: "inserted" | "already_exists";
}

/**
 * kb_ensure_entry — Idempotent entry insertion into index.md / log.md.
 * Uses dedup_key with HTML comment markers to prevent duplicates.
 */
export async function kbEnsureEntry(
  input: KbEnsureEntryInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbEnsureEntryOutput>> {
  // TODO: implement
  throw new Error("Not implemented");
}
