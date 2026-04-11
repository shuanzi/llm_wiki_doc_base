/**
 * OpenClaw KB Plugin — Entry Point
 *
 * Registers all knowledge base tools with the OpenClaw runtime.
 * Each tool is implemented in src/tools/ as a standalone module.
 */

export { kbSourceAdd } from "./tools/kb_source_add";
export { kbPlanIngest } from "./tools/kb_plan_ingest";
export { kbDraftPatch } from "./tools/kb_draft_patch";
export { kbApplyPatch } from "./tools/kb_apply_patch";
export { kbSearchWiki } from "./tools/kb_search_wiki";
export { kbReadPage } from "./tools/kb_read_page";
export { kbCommit } from "./tools/kb_commit";

export type * from "./types";
