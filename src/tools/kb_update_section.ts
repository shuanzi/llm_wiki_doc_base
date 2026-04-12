import * as fs from "fs";
import * as path from "path";
import type { PageIndex, ToolResult, WorkspaceConfig } from "../types";
import { resolveKbPath } from "../utils/path_validator";
import {
  parseFrontmatter,
  serializeFrontmatter,
  extractHeadings,
  extractExcerpt,
} from "../utils/frontmatter";

export interface KbUpdateSectionInput {
  path: string;
  heading: string;
  content: string;
  append?: boolean;
  create_if_missing?: boolean;
}

export interface KbUpdateSectionOutput {
  path: string;
  action: "replaced" | "appended" | "created_section";
}

/**
 * kb_update_section — Update a specific section in a wiki page.
 * Auto-updates frontmatter updated_at.
 */
export async function kbUpdateSection(
  input: KbUpdateSectionInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbUpdateSectionOutput>> {
  try {
    // 1. Path safety: resolve and verify within kb/wiki/
    const absPath = resolveKbPath(input.path, config.kb_root);
    const wikiDir = path.resolve(config.kb_root, "wiki");
    if (!absPath.startsWith(wikiDir + path.sep) && absPath !== wikiDir) {
      return {
        success: false,
        error: `Path "${input.path}" must be within kb/wiki/`,
      };
    }

    // 2. Read existing page — error if file doesn't exist
    if (!fs.existsSync(absPath)) {
      return {
        success: false,
        error: `File not found: ${input.path}`,
      };
    }

    const raw = fs.readFileSync(absPath, "utf8");

    // 3. Parse frontmatter + body
    const { frontmatter, body } = parseFrontmatter(raw);

    const append = input.append ?? false;
    const createIfMissing = input.create_if_missing ?? true;

    // 4. Locate the heading in the body
    const lines = body.split("\n");
    let headingLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimEnd() === input.heading.trimEnd()) {
        headingLineIndex = i;
        break;
      }
    }

    let newBody: string;
    let action: KbUpdateSectionOutput["action"];

    if (headingLineIndex === -1) {
      // Heading not found
      if (!createIfMissing) {
        return {
          success: false,
          error: `Heading "${input.heading}" not found in ${input.path}`,
        };
      }
      // Append new section to end of body
      const trimmedBody = body.trimEnd();
      newBody = `${trimmedBody}\n\n${input.heading}\n\n${input.content}`;
      action = "created_section";
    } else {
      // 5. Find section boundaries
      // Determine the level of the heading (number of leading #)
      const headingLevelMatch = input.heading.match(/^(#{1,6})\s/);
      const headingLevel = headingLevelMatch ? headingLevelMatch[1].length : 0;

      // Find the next heading of equal or higher level (fewer or equal # chars)
      let nextHeadingLineIndex = lines.length; // default: end of file
      for (let i = headingLineIndex + 1; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,6})\s/);
        if (m && m[1].length <= headingLevel) {
          nextHeadingLineIndex = i;
          break;
        }
      }

      // 6. Replace or append
      const beforeSection = lines.slice(0, headingLineIndex + 1); // includes the heading line
      const afterSection = lines.slice(nextHeadingLineIndex); // next heading onward

      if (append) {
        // Find the last non-empty line in the section content before next heading
        // Insert the new content at the end of the existing section
        const sectionContent = lines.slice(headingLineIndex + 1, nextHeadingLineIndex);
        const trimmedSectionContent = sectionContent.join("\n").trimEnd();
        const newSectionContent = trimmedSectionContent
          ? trimmedSectionContent + "\n\n" + input.content
          : input.content;

        const afterSectionStr = afterSection.length > 0
          ? "\n\n" + afterSection.join("\n")
          : "";
        newBody =
          beforeSection.join("\n") +
          "\n\n" +
          newSectionContent +
          afterSectionStr;
        action = "appended";
      } else {
        // Replace: replace the section content between heading and next heading
        const afterSectionStr = afterSection.length > 0
          ? "\n\n" + afterSection.join("\n")
          : "";
        newBody =
          beforeSection.join("\n") +
          "\n\n" +
          input.content +
          afterSectionStr;
        action = "replaced";
      }
    }

    // 8. Auto-update frontmatter updated_at
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const updatedFrontmatter = { ...frontmatter, updated_at: today };

    // 9. Write back: serialize frontmatter + body
    const serialized = serializeFrontmatter(updatedFrontmatter as Record<string, unknown>);
    const newContent = serialized + "\n\n" + newBody.trimStart();
    fs.writeFileSync(absPath, newContent, "utf8");

    // 10. Refresh page-index.json
    const indexPath = resolveKbPath("state/cache/page-index.json", config.kb_root);
    if (fs.existsSync(indexPath)) {
      const index: PageIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const relPath = input.path;
      const entryIdx = index.pages.findIndex((p) => p.path === relPath);
      if (entryIdx !== -1) {
        index.pages[entryIdx].headings = extractHeadings(newBody);
        index.pages[entryIdx].body_excerpt = extractExcerpt(newBody);
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
      }
    }

    return {
      success: true,
      data: { path: input.path, action },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
