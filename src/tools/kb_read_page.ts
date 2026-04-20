import type { PageFrontmatter, ToolResult, WorkspaceConfig } from "../types";
import { readWikiPage } from "../core/wiki-search";

export interface KbReadPageInput {
  /** page path relative to kb/ or a page_id */
  path_or_id: string;
}

export interface KbReadPageOutput {
  path: string;
  frontmatter: Partial<PageFrontmatter>;
  body: string;
}

export async function kbReadPage(
  input: KbReadPageInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbReadPageOutput>> {
  try {
    return {
      success: true,
      data: readWikiPage(input.path_or_id, config),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
