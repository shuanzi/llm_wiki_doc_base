import * as fs from "fs";
import * as path from "path";
import type { ToolResult, WorkspaceConfig, PageIndex, PageIndexEntry } from "../types";
import { resolveKbPath } from "../utils/path_validator";
import {
  parseFrontmatter,
  validateFrontmatter,
  extractHeadings,
  extractExcerpt,
} from "../utils/frontmatter";

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

const PAGE_INDEX_PATH = "state/cache/page-index.json";

/**
 * kb_write_page — Create or update a wiki page.
 * Validates frontmatter, enforces path safety, refreshes page-index.json.
 */
export async function kbWritePage(
  input: KbWritePageInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbWritePageOutput>> {
  try {
    // 1. Path safety: path must resolve within kb/wiki/
    const wikiDir = path.resolve(config.kb_root, "wiki");

    let resolvedPath: string;
    try {
      resolvedPath = resolveKbPath(input.path, config.kb_root);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }

    if (!resolvedPath.startsWith(wikiDir + path.sep) && resolvedPath !== wikiDir) {
      return {
        success: false,
        error: `Path "${input.path}" resolves to "${resolvedPath}" which is outside kb/wiki/`,
      };
    }

    // 2. Symlink check on resolved path (if it exists)
    if (fs.existsSync(resolvedPath)) {
      const stat = fs.lstatSync(resolvedPath);
      if (stat.isSymbolicLink()) {
        return {
          success: false,
          error: `Path "${input.path}" resolves to a symlink — symlinks are not allowed as write targets`,
        };
      }
    }

    // 3. Parse frontmatter from content
    const { frontmatter, body } = parseFrontmatter(input.content);

    // 4. Validate frontmatter
    const validation = validateFrontmatter(frontmatter);
    if (!validation.valid) {
      return {
        success: false,
        error: `Frontmatter validation failed:\n${validation.errors.join("\n")}`,
      };
    }

    const page_id = frontmatter.id as string;

    // 5. ID uniqueness check: read page-index.json, ensure no other path uses this id
    const pageIndexAbsPath = resolveKbPath(PAGE_INDEX_PATH, config.kb_root);
    let pageIndex: PageIndex = { pages: [] };
    if (fs.existsSync(pageIndexAbsPath)) {
      try {
        pageIndex = JSON.parse(fs.readFileSync(pageIndexAbsPath, "utf8")) as PageIndex;
      } catch {
        // treat corrupted index as empty
        pageIndex = { pages: [] };
      }
    }

    // Normalize the stored path to a kb-relative path for comparison
    const relativeInputPath = path.relative(config.kb_root, resolvedPath).replace(/\\/g, "/");

    const conflictEntry = pageIndex.pages.find(
      (entry) => entry.page_id === page_id && entry.path !== relativeInputPath
    );
    if (conflictEntry) {
      return {
        success: false,
        error: `Page ID "${page_id}" is already used by "${conflictEntry.path}" — IDs must be unique across the wiki`,
      };
    }

    // 6. create_only mode: fail if file already exists
    const fileAlreadyExists = fs.existsSync(resolvedPath);
    if (input.create_only && fileAlreadyExists) {
      return {
        success: false,
        error: `File already exists at "${relativeInputPath}" and create_only is true`,
      };
    }

    const action: "created" | "updated" = fileAlreadyExists ? "updated" : "created";

    // 7. Write the file (mkdir -p parent directory)
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, input.content, "utf8");

    // 8. Incrementally update page-index.json
    const headings = extractHeadings(body);
    const body_excerpt = extractExcerpt(body);

    const newEntry: PageIndexEntry = {
      page_id,
      path: relativeInputPath,
      type: frontmatter.type ?? "",
      title: frontmatter.title ?? "",
      aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [],
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      headings,
      body_excerpt,
    };

    // Remove any existing entry for this path, then add the new one
    pageIndex.pages = pageIndex.pages.filter((entry) => entry.path !== relativeInputPath);
    pageIndex.pages.push(newEntry);

    // Ensure parent directory of page-index exists
    const pageIndexDir = path.dirname(pageIndexAbsPath);
    if (!fs.existsSync(pageIndexDir)) {
      fs.mkdirSync(pageIndexDir, { recursive: true });
    }
    fs.writeFileSync(pageIndexAbsPath, JSON.stringify(pageIndex, null, 2), "utf8");

    return {
      success: true,
      data: {
        path: relativeInputPath,
        page_id,
        action,
        warnings: validation.warnings,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
