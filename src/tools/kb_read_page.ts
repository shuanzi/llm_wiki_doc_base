import * as fs from "fs";
import type { PageFrontmatter, PageIndex, ToolResult, WorkspaceConfig } from "../types";
import { resolveKbPath } from "../utils/path_validator";
import { parseFrontmatter } from "../utils/frontmatter";

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
  try {
    let relativePath: string;

    // Determine if input is a path or page_id
    if (input.path_or_id.includes("/") || input.path_or_id.endsWith(".md")) {
      // Treat as a path
      relativePath = input.path_or_id;
    } else {
      // Treat as page_id — look up in page-index.json
      const indexPath = resolveKbPath("state/cache/page-index.json", config.kb_root);
      if (!fs.existsSync(indexPath)) {
        return {
          success: false,
          error: `Page index not found. Use kb_write_page to create pages — the index is built incrementally.`,
        };
      }
      const index: PageIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const entry = index.pages.find((p) => p.page_id === input.path_or_id);
      if (!entry) {
        return {
          success: false,
          error: `Page not found with page_id: ${input.path_or_id}`,
        };
      }
      relativePath = entry.path;
    }

    const absPath = resolveKbPath(relativePath, config.kb_root);

    // Symlink check: ensure the resolved path is a regular file
    const stat = fs.lstatSync(absPath);
    if (stat.isSymbolicLink()) {
      return { success: false, error: `Refusing to read symlink: ${relativePath}` };
    }
    if (!stat.isFile()) {
      return { success: false, error: `Not a file: ${relativePath}` };
    }

    const content = fs.readFileSync(absPath, "utf8");
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      success: true,
      data: { path: relativePath, frontmatter, body },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
