import type { Plan, ToolResult, WorkspaceConfig } from "../types";

export interface KbPlanIngestInput {
  source_id: string;
}

/**
 * kb_plan_ingest — Generate a structural patch plan from a registered source.
 *
 * Reads the source manifest + raw content + current wiki state,
 * then outputs a Plan JSON describing which files to create/update.
 * MVP: only creates source summary page + updates index.md / log.md.
 * Does NOT generate actual content — that is kb_draft_patch's job.
 */
export async function kbPlanIngest(
  input: KbPlanIngestInput,
  config: WorkspaceConfig
): Promise<ToolResult<Plan>> {
  // TODO: implement
  throw new Error("Not implemented");
}
