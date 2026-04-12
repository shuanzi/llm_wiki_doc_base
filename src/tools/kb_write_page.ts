import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbWritePageInput {
  path: string;
  content: string;
  create_only?: boolean;
}

export interface KbWritePageOutput {
  path: string;
  page_id: string;
  action: "created" | "updated";
  warnings: string[];
}

/**
 * kb_write_page — Create or update a wiki page.
 * Validates frontmatter, enforces path safety, refreshes page-index.json.
 */
export async function kbWritePage(
  input: KbWritePageInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbWritePageOutput>> {
  // TODO: implement
  throw new Error("Not implemented");
}
