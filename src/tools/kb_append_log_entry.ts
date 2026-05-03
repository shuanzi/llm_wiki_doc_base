import type { ToolResult, WorkspaceConfig } from "../types";
import { appendWikiLogEntry, type AppendWikiLogEntryInput } from "../core/wiki-log";

export type KbAppendLogEntryInput = AppendWikiLogEntryInput;

export async function kbAppendLogEntry(
  input: KbAppendLogEntryInput,
  config: WorkspaceConfig
): Promise<ToolResult<ReturnType<typeof appendWikiLogEntry>>> {
  try {
    return { success: true, data: appendWikiLogEntry(input, config) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
