import type { PageFrontmatter, ToolResult, WorkspaceConfig } from "../types";

export interface KbReadPageInput {
  /** page path relative to kb/ or a page_id */
  path_or_id: string;
}

export interface KbReadPageOutput {
  path: string;
  frontmatter: Partial<PageFrontmatter>;
  body: string;
}

/**
 * kb_read_page — Read a wiki page, returning frontmatter and body separately.
 *
 * Accepts either a file path (relative to kb/) or a page_id.
 * If page_id is given, looks up the path from page-index.json.
 */
export async function kbReadPage(
  input: KbReadPageInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbReadPageOutput>> {
  // TODO: implement
  throw new Error("Not implemented");
}
