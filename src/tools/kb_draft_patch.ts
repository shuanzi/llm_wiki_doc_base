import type { Plan, Draft, ToolResult, WorkspaceConfig } from "../types";

export interface KbDraftPatchInput {
  plan: Plan;
}

/**
 * kb_draft_patch — Render a plan into a complete, replayable file changeset.
 *
 * This is the audit chain's last human-reviewable stable artifact.
 * The draft IS the final executable changeset — kb_apply_patch generates
 * no content of its own.
 *
 * Uses ensure_entry (not append) for index.md / log.md to guarantee
 * retry safety (idempotent by dedup_key).
 *
 * Archives draft to kb/state/drafts/<plan_id>.json.
 */
export async function kbDraftPatch(
  input: KbDraftPatchInput,
  config: WorkspaceConfig
): Promise<ToolResult<Draft>> {
  // TODO: implement
  throw new Error("Not implemented");
}
