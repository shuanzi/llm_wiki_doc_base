import type { Draft, InProgressRecord, RecoveryAction, ToolResult, WorkspaceConfig } from "../types";

export interface KbApplyPatchInput {
  draft: Draft;
  dry_run?: boolean;
}

export interface KbApplyPatchOutput {
  applied_files: string[];
  index_updated: boolean;
}

/**
 * kb_apply_patch — Pure executor. Writes draft files to disk deterministically.
 *
 * Pre-checks:
 * - git status --porcelain -- kb/ (excluding kb/state/runs/) must be clean
 * - Writes in_progress.json marker before starting
 *
 * Executes:
 * - create: creates new file, errors if exists
 * - ensure_entry: idempotent insert by dedup_key
 * - overwrite: replaces entire file
 *
 * Post:
 * - Syncs kb/state/cache/page-index.json
 * - Moves draft from drafts/ to applied/
 * - Removes in_progress marker
 *
 * Failure recovery:
 * - On failure: moves draft to failed/, preserves in_progress.json
 * - On next run with residual in_progress: offers resume/rollback/force-clear
 *   - rollback: git checkout for modified files, delete for created files
 */
export async function kbApplyPatch(
  input: KbApplyPatchInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbApplyPatchOutput>> {
  // TODO: implement
  throw new Error("Not implemented");
}
