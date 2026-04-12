import * as fs from "fs";
import * as path from "path";
import type { ToolResult, WorkspaceConfig } from "../types";
import { resolveKbPath } from "../utils/path_validator";

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

      // 5. Insert entry after the anchor line
      lines.splice(anchorIndex + 1, 0, entryLine);
      newContent = lines.join("\n");
    } else {
      // 6. No anchor: append to end of file
      const trimmed = content.trimEnd();
      newContent = trimmed + "\n" + entryLine + "\n";
    }

    // 7. Write back
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
