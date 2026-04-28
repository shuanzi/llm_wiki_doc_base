import type { WorkspaceConfig } from "../types";

import { kbCommit } from "../tools/kb_commit";
import { kbEnsureEntry } from "../tools/kb_ensure_entry";
import { kbReadPage } from "../tools/kb_read_page";
import { kbReadSource } from "../tools/kb_read_source";
import { kbRebuildIndex } from "../tools/kb_rebuild_index";
import { kbRepair } from "../tools/kb_repair";
import { kbRunLint } from "../tools/kb_run_lint";
import { kbSearchWiki } from "../tools/kb_search_wiki";
import { kbSourceAdd } from "../tools/kb_source_add";
import { kbUpdateSection } from "../tools/kb_update_section";
import { kbWritePage } from "../tools/kb_write_page";
import {
  KB_TOOL_DEFINITIONS,
  type KbCanonicalToolName,
} from "./kb_tool_contract";
import { validateKbToolArgs } from "./kb_tool_args";

export type KbToolArgs = Record<string, unknown>;

export interface KbToolRuntimeResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

type KbToolHandler = (
  args: KbToolArgs,
  config: WorkspaceConfig
) => Promise<KbToolRuntimeResult>;

const KB_TOOL_HANDLERS: Record<KbCanonicalToolName, KbToolHandler> = {
  kb_source_add: (args, workspace) =>
    kbSourceAdd(args as unknown as Parameters<typeof kbSourceAdd>[0], workspace),
  kb_read_source: (args, workspace) =>
    kbReadSource(args as unknown as Parameters<typeof kbReadSource>[0], workspace),
  kb_write_page: (args, workspace) =>
    kbWritePage(args as unknown as Parameters<typeof kbWritePage>[0], workspace),
  kb_update_section: (args, workspace) =>
    kbUpdateSection(args as unknown as Parameters<typeof kbUpdateSection>[0], workspace),
  kb_ensure_entry: (args, workspace) =>
    kbEnsureEntry(args as unknown as Parameters<typeof kbEnsureEntry>[0], workspace),
  kb_search_wiki: (args, workspace) =>
    kbSearchWiki(args as unknown as Parameters<typeof kbSearchWiki>[0], workspace),
  kb_read_page: (args, workspace) =>
    kbReadPage(args as unknown as Parameters<typeof kbReadPage>[0], workspace),
  kb_commit: (args, workspace) =>
    kbCommit(args as unknown as Parameters<typeof kbCommit>[0], workspace),
  kb_rebuild_index: (args, workspace) =>
    kbRebuildIndex(args as unknown as Parameters<typeof kbRebuildIndex>[0], workspace),
  kb_run_lint: (args, workspace) =>
    kbRunLint(args as unknown as Parameters<typeof kbRunLint>[0], workspace),
  kb_repair: (args, workspace) =>
    kbRepair(args as unknown as Parameters<typeof kbRepair>[0], workspace),
};

export async function dispatchKbTool(
  name: string,
  args: KbToolArgs,
  config: WorkspaceConfig
): Promise<KbToolRuntimeResult> {
  const handler = getKbToolHandler(name);
  if (!handler) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  const validation = validateKbToolArgs(name as KbCanonicalToolName, args);
  if (!validation.ok) {
    return { success: false, error: validation.error };
  }

  return handler(validation.args, config);
}

export function listKbToolsResponse(): { tools: typeof KB_TOOL_DEFINITIONS } {
  return { tools: KB_TOOL_DEFINITIONS };
}

function getKbToolHandler(name: string): KbToolHandler | undefined {
  if (!Object.prototype.hasOwnProperty.call(KB_TOOL_HANDLERS, name)) {
    return undefined;
  }
  return KB_TOOL_HANDLERS[name as KbCanonicalToolName];
}
