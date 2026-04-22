import * as path from "path";
import type { ToolResult, WorkspaceConfig } from "../types";
import { writeWikiPage } from "../core/wiki-pages";
import { resolveKbPath } from "../utils/path_validator";

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

function getLegacyOutsideWikiError(targetPath: string, kbRoot: string): string | null {
  const resolvedPath = resolveKbPath(targetPath, kbRoot);
  const wikiDir = path.resolve(kbRoot, "wiki");

  if (!resolvedPath.startsWith(wikiDir + path.sep) && resolvedPath !== wikiDir) {
    return `Path "${targetPath}" resolves to "${resolvedPath}" which is outside kb/wiki/`;
  }

  return null;
}

export async function kbWritePage(
  input: KbWritePageInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbWritePageOutput>> {
  try {
    const outsideWikiError = getLegacyOutsideWikiError(input.path, config.kb_root);
    if (outsideWikiError) {
      return { success: false, error: outsideWikiError };
    }

    const data = writeWikiPage(input, config);

    return {
      success: true,
      data,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
