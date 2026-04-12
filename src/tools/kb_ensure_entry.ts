import * as fs from "fs";
import * as path from "path";
import type { ToolResult, WorkspaceConfig } from "../types";
import { resolveKbPath } from "../utils/path_validator";
import { parseFrontmatter, serializeFrontmatter } from "../utils/frontmatter";

export interface KbEnsureEntryInput {
  path: string;
  entry: string;
  anchor: string | null;
  dedup_key: string;
}

export interface KbEnsureEntryOutput {
  action: "inserted" | "already_exists";
}

/**
 * kb_ensure_entry — Idempotent entry insertion into index.md / log.md.
 * Uses dedup_key with HTML comment markers to prevent duplicates.
 */
export async function kbEnsureEntry(
  input: KbEnsureEntryInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbEnsureEntryOutput>> {
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

    // 2. Read existing file — error if not found
    if (!fs.existsSync(absPath)) {
      return {
        success: false,
        error: `File not found: ${input.path}`,
      };
    }

    const content = fs.readFileSync(absPath, "utf8");

    // 3. Dedup check: if content already contains <!-- dedup:{dedup_key} -->, return already_exists
    const dedupMarker = `<!-- dedup:${input.dedup_key} -->`;
    if (content.includes(dedupMarker)) {
      return {
        success: true,
        data: { action: "already_exists" },
      };
    }

    // 4. Find anchor and insert entry
    const entryLine = `${input.entry} ${dedupMarker}`;
    let newContent: string;

    if (input.anchor !== null) {
      // Find the anchor line in the content
      const lines = content.split("\n");
      const anchorIndex = lines.findIndex(
        (line) => line.trimEnd() === input.anchor!.trimEnd()
      );

      if (anchorIndex === -1) {
        return {
          success: false,
          error: `Anchor "${input.anchor}" not found in ${input.path}`,
        };
      }

      // 5. Insert entry at the end of the anchor's section (Bug 2 fix)
      const anchorLine = lines[anchorIndex];
      const headingMatch = anchorLine.match(/^(#{1,6})\s/);
      if (headingMatch) {
        // Anchor is a heading — find the end of its section
        const anchorLevel = headingMatch[1].length;
        let boundaryIndex = lines.length;
        for (let i = anchorIndex + 1; i < lines.length; i++) {
          const m = lines[i].match(/^(#{1,6})\s/);
          if (m && m[1].length <= anchorLevel) {
            boundaryIndex = i;
            break;
          }
        }
        // Walk back over trailing blank lines so entry sits adjacent to content
        while (boundaryIndex > anchorIndex + 1 && lines[boundaryIndex - 1].trim() === "") {
          boundaryIndex--;
        }
        lines.splice(boundaryIndex, 0, entryLine);
      } else {
        // Non-heading anchor: fall back to inserting immediately after
        lines.splice(anchorIndex + 1, 0, entryLine);
      }
      newContent = lines.join("\n");
    } else {
      // 6. No anchor: append to end of file
      const trimmed = content.trimEnd();
      newContent = trimmed + "\n" + entryLine + "\n";
    }

    // 7. Bump updated_at in frontmatter, then write back (Bug 1 fix)
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const { frontmatter, body } = parseFrontmatter(newContent);
    if (Object.keys(frontmatter).length > 0) {
      const updatedFrontmatter = { ...frontmatter, updated_at: today };
      const serialized = serializeFrontmatter(updatedFrontmatter as Record<string, unknown>);
      newContent = serialized + "\n\n" + body.trimStart();
    }
    fs.writeFileSync(absPath, newContent, "utf8");

    return {
      success: true,
      data: { action: "inserted" },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
