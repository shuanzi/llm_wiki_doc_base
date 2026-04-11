import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbCommitInput {
  message: string;
}

export interface KbCommitOutput {
  commit_hash: string;
  message: string;
}

/**
 * kb_commit — Commit current kb/ changes to Git.
 *
 * Stages all changes under kb/ and commits with the provided message.
 * Message should follow: "kb: <action> <source_id> and <description>"
 */
export async function kbCommit(
  input: KbCommitInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbCommitOutput>> {
  // TODO: implement
  throw new Error("Not implemented");
}
