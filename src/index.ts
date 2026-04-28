/**
 * OpenClaw KB Plugin — Entry Point (V2)
 *
 * Registers all knowledge base tools with the OpenClaw runtime.
 * Each tool is implemented in src/tools/ as a standalone module.
 */

export { kbSourceAdd } from "./tools/kb_source_add";
export { kbReadSource } from "./tools/kb_read_source";
export { kbWritePage } from "./tools/kb_write_page";
export { kbUpdateSection } from "./tools/kb_update_section";
export { kbEnsureEntry } from "./tools/kb_ensure_entry";
export { kbSearchWiki } from "./tools/kb_search_wiki";
export { kbReadPage } from "./tools/kb_read_page";
export { kbCommit } from "./tools/kb_commit";
export { kbRebuildIndex } from "./tools/kb_rebuild_index";
export { kbRunLint } from "./tools/kb_run_lint";
export { kbRepair } from "./tools/kb_repair";

export { rebuildPageIndex, runKbLint, repairKb } from "./core/wiki-maintenance";

export type * from "./types";
