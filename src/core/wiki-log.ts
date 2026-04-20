import * as fs from "fs";
import type { WorkspaceConfig } from "../types";
import { parseFrontmatter, serializeFrontmatter } from "../utils";
import { assertNotSymlinkWriteTarget, resolveWikiScopedPath } from "./wiki-search";

export interface EnsureWikiEntryInput {
  path: string;
  entry: string;
  anchor: string | null;
  dedup_key: string;
  bump_updated_at?: boolean;
}

export interface EnsureWikiEntryResult {
  action: "inserted" | "already_exists";
}

type WorkspaceLike = string | WorkspaceConfig;

function getKbRoot(workspace: WorkspaceLike): string {
  return typeof workspace === "string" ? workspace : workspace.kb_root;
}

function insertEntryAtAnchor(
  content: string,
  entryLine: string,
  anchor: string | null,
  relativePath: string
): string {
  if (anchor === null) {
    return content.trimEnd() + "\n" + entryLine + "\n";
  }

  const lines = content.split("\n");
  const anchorIndex = lines.findIndex((line) => line.trimEnd() === anchor.trimEnd());
  if (anchorIndex === -1) {
    throw new Error(`Anchor "${anchor}" not found in ${relativePath}`);
  }

  const headingMatch = lines[anchorIndex].match(/^(#{1,6})\s/);
  if (!headingMatch) {
    lines.splice(anchorIndex + 1, 0, entryLine);
    return lines.join("\n");
  }

  const anchorLevel = headingMatch[1].length;
  let boundaryIndex = lines.length;
  for (let index = anchorIndex + 1; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,6})\s/);
    if (match && match[1].length <= anchorLevel) {
      boundaryIndex = index;
      break;
    }
  }

  while (boundaryIndex > anchorIndex + 1 && lines[boundaryIndex - 1].trim() === "") {
    boundaryIndex--;
  }

  lines.splice(boundaryIndex, 0, entryLine);
  return lines.join("\n");
}

export function ensureWikiEntry(
  input: EnsureWikiEntryInput,
  workspace: WorkspaceLike
): EnsureWikiEntryResult {
  const resolvedPath = resolveWikiScopedPath(input.path, workspace);
  assertNotSymlinkWriteTarget(input.path, resolvedPath.absolutePath);
  if (!fs.existsSync(resolvedPath.absolutePath)) {
    throw new Error(`File not found: ${input.path}`);
  }

  const content = fs.readFileSync(resolvedPath.absolutePath, "utf8");
  const dedupMarker = `<!-- dedup:${input.dedup_key} -->`;
  if (content.includes(dedupMarker)) {
    return { action: "already_exists" };
  }

  const entryLine = `${input.entry} ${dedupMarker}`;
  let newContent = insertEntryAtAnchor(content, entryLine, input.anchor, input.path);

  if (input.bump_updated_at ?? true) {
    const { frontmatter, body } = parseFrontmatter(newContent);
    if (Object.keys(frontmatter).length > 0) {
      const updatedFrontmatter = {
        ...frontmatter,
        updated_at: new Date().toISOString().slice(0, 10),
      };
      const serialized = serializeFrontmatter(updatedFrontmatter as Record<string, unknown>);
      newContent = serialized + "\n\n" + body.trimStart();
    }
  }

  fs.writeFileSync(resolvedPath.absolutePath, newContent, "utf8");
  return { action: "inserted" };
}
