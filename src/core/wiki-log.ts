import * as fs from "fs";
import type { WorkspaceConfig } from "../types";
import { parseFrontmatter, serializeFrontmatter, validateFrontmatter } from "../utils";
import { assertWikiRebuildable, rebuildPageIndex } from "./wiki-maintenance";
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

function assertSingleLine(value: string, label: string): void {
  if (/\r|\n/u.test(value)) {
    throw new Error(`${label} must be a single line.`);
  }
}

function validateDedupKey(dedupKey: string): void {
  assertSingleLine(dedupKey, "dedup_key");
  if (!/^[A-Za-z0-9._:-]+$/u.test(dedupKey)) {
    throw new Error("dedup_key may contain only letters, numbers, dot, underscore, colon, and hyphen.");
  }
}

function validateEntryInput(input: EnsureWikiEntryInput): void {
  assertSingleLine(input.entry, "entry");
  if (input.anchor !== null) {
    assertSingleLine(input.anchor, "anchor");
  }
  validateDedupKey(input.dedup_key);

  if (input.entry.includes("<!-- dedup:") || input.entry.includes("-->") || input.entry.includes("---")) {
    throw new Error("entry must not contain dedup markers, HTML comment terminators, or frontmatter delimiters.");
  }
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
  validateEntryInput(input);

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

  const currentParsed = parseFrontmatter(content);
  if (Object.keys(currentParsed.frontmatter).length > 0) {
    const currentValidation = validateFrontmatter(currentParsed.frontmatter);
    if (!currentValidation.valid) {
      throw new Error(
        `Frontmatter validation failed before entry insert:\n${currentValidation.errors.join("\n")}`
      );
    }
  }

  const entryLine = `${input.entry} ${dedupMarker}`;
  const insertedContent = insertEntryAtAnchor(content, entryLine, input.anchor, input.path);
  const { frontmatter, body } = parseFrontmatter(insertedContent);

  if (Object.keys(frontmatter).length > 0) {
    const insertedValidation = validateFrontmatter(frontmatter);
    if (!insertedValidation.valid) {
      throw new Error(
        `Frontmatter validation failed after entry insert:\n${insertedValidation.errors.join("\n")}`
      );
    }
  }

  let newContent = insertedContent;
  if ((input.bump_updated_at ?? true) && Object.keys(frontmatter).length > 0) {
    const updatedFrontmatter = {
      ...frontmatter,
      updated_at: new Date().toISOString().slice(0, 10),
    };
    const updatedValidation = validateFrontmatter(updatedFrontmatter);
    if (!updatedValidation.valid) {
      throw new Error(
        `Frontmatter validation failed after entry insert:\n${updatedValidation.errors.join("\n")}`
      );
    }

    const serialized = serializeFrontmatter(updatedFrontmatter as Record<string, unknown>);
    newContent = serialized + "\n\n" + body.trimStart();
  }

  assertWikiRebuildable(workspace);
  fs.writeFileSync(resolvedPath.absolutePath, newContent, "utf8");
  rebuildPageIndex(workspace);
  return { action: "inserted" };
}
