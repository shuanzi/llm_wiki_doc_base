import * as fs from "fs";
import * as path from "path";
import type { PageIndex, PageIndexEntry, WorkspaceConfig } from "../types";
import {
  extractExcerpt,
  extractHeadings,
  parseFrontmatter,
  resolveKbPath,
  serializeFrontmatter,
  validateFrontmatter,
} from "../utils";
import {
  assertNotSymlinkWriteTarget,
  loadPageIndexLenient,
  resolveWikiScopedPath,
  type ResolvedWikiPath,
} from "./wiki-search";

export interface WriteWikiPageInput {
  path: string;
  content: string;
  create_only?: boolean;
}

export interface WriteWikiPageResult {
  path: string;
  page_id: string;
  action: "created" | "updated";
  warnings: string[];
}

export interface UpdateWikiSectionInput {
  path: string;
  heading: string;
  content: string;
  append?: boolean;
  create_if_missing?: boolean;
}

export interface UpdateWikiSectionResult {
  path: string;
  action: "replaced" | "appended" | "created_section";
}

const PAGE_INDEX_PATH = "state/cache/page-index.json";

type WorkspaceLike = string | WorkspaceConfig;

function getKbRoot(workspace: WorkspaceLike): string {
  return typeof workspace === "string" ? workspace : workspace.kb_root;
}

function upsertPageIndexEntry(workspace: WorkspaceLike, entry: PageIndexEntry): void {
  const pageIndexPath = resolveKbPath(PAGE_INDEX_PATH, getKbRoot(workspace));
  const pageIndex: PageIndex = loadPageIndexLenient(workspace);
  pageIndex.pages = pageIndex.pages.filter((page) => page.path !== entry.path);
  pageIndex.pages.push(entry);

  const indexDir = path.dirname(pageIndexPath);
  if (!fs.existsSync(indexDir)) {
    fs.mkdirSync(indexDir, { recursive: true });
  }

  fs.writeFileSync(pageIndexPath, JSON.stringify(pageIndex, null, 2), "utf8");
}

export function writeWikiPage(
  input: WriteWikiPageInput,
  workspace: WorkspaceLike
): WriteWikiPageResult {
  const resolvedPath: ResolvedWikiPath = resolveWikiScopedPath(input.path, workspace);
  assertNotSymlinkWriteTarget(input.path, resolvedPath.absolutePath);

  const { frontmatter, body } = parseFrontmatter(input.content);
  const validation = validateFrontmatter(frontmatter);
  if (!validation.valid) {
    throw new Error(`Frontmatter validation failed:\n${validation.errors.join("\n")}`);
  }

  const page_id = frontmatter.id as string;
  const relativePath = resolvedPath.relativePath;
  const pageIndex = loadPageIndexLenient(workspace);
  const conflictEntry = pageIndex.pages.find(
    (entry) => entry.page_id === page_id && entry.path !== relativePath
  );
  if (conflictEntry) {
    throw new Error(
      `Page ID "${page_id}" is already used by "${conflictEntry.path}" — IDs must be unique across the wiki`
    );
  }

  const fileAlreadyExists = fs.existsSync(resolvedPath.absolutePath);
  if (input.create_only && fileAlreadyExists) {
    throw new Error(`File already exists at "${relativePath}" and create_only is true`);
  }

  const action: WriteWikiPageResult["action"] = fileAlreadyExists ? "updated" : "created";
  const parentDir = path.dirname(resolvedPath.absolutePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(resolvedPath.absolutePath, input.content, "utf8");

  upsertPageIndexEntry(workspace, {
    page_id,
    path: relativePath,
    type: frontmatter.type ?? "",
    title: frontmatter.title ?? "",
    aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [],
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    headings: extractHeadings(body),
    body_excerpt: extractExcerpt(body),
  });

  return {
    path: relativePath,
    page_id,
    action,
    warnings: validation.warnings,
  };
}

export function updateWikiSection(
  input: UpdateWikiSectionInput,
  workspace: WorkspaceLike
): UpdateWikiSectionResult {
  const resolvedPath = resolveWikiScopedPath(input.path, workspace);
  assertNotSymlinkWriteTarget(input.path, resolvedPath.absolutePath);
  if (!fs.existsSync(resolvedPath.absolutePath)) {
    throw new Error(`File not found: ${input.path}`);
  }

  const raw = fs.readFileSync(resolvedPath.absolutePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const append = input.append ?? false;
  const createIfMissing = input.create_if_missing ?? true;
  const lines = body.split("\n");

  let headingLineIndex = -1;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trimEnd() === input.heading.trimEnd()) {
      headingLineIndex = index;
      break;
    }
  }

  let newBody: string;
  let action: UpdateWikiSectionResult["action"];

  if (headingLineIndex === -1) {
    if (!createIfMissing) {
      throw new Error(`Heading "${input.heading}" not found in ${input.path}`);
    }

    newBody = `${body.trimEnd()}\n\n${input.heading}\n\n${input.content}`;
    action = "created_section";
  } else {
    const headingLevelMatch = input.heading.match(/^(#{1,6})\s/);
    const headingLevel = headingLevelMatch ? headingLevelMatch[1].length : 0;

    let nextHeadingLineIndex = lines.length;
    for (let index = headingLineIndex + 1; index < lines.length; index++) {
      const match = lines[index].match(/^(#{1,6})\s/);
      if (match && match[1].length <= headingLevel) {
        nextHeadingLineIndex = index;
        break;
      }
    }

    const beforeSection = lines.slice(0, headingLineIndex + 1);
    const afterSection = lines.slice(nextHeadingLineIndex);

    if (append) {
      const sectionContent = lines.slice(headingLineIndex + 1, nextHeadingLineIndex);
      const trimmedSectionContent = sectionContent.join("\n").trimEnd();
      const newSectionContent = trimmedSectionContent
        ? trimmedSectionContent + "\n\n" + input.content
        : input.content;
      const afterSectionStr = afterSection.length > 0 ? "\n\n" + afterSection.join("\n") : "";
      newBody = beforeSection.join("\n") + "\n\n" + newSectionContent + afterSectionStr;
      action = "appended";
    } else {
      const afterSectionStr = afterSection.length > 0 ? "\n\n" + afterSection.join("\n") : "";
      newBody = beforeSection.join("\n") + "\n\n" + input.content + afterSectionStr;
      action = "replaced";
    }
  }

  const updatedFrontmatter = {
    ...frontmatter,
    updated_at: new Date().toISOString().slice(0, 10),
  };
  const serialized = serializeFrontmatter(updatedFrontmatter as Record<string, unknown>);
  const newContent = serialized + "\n\n" + newBody.trimStart();
  fs.writeFileSync(resolvedPath.absolutePath, newContent, "utf8");

  const indexPath = resolveKbPath(PAGE_INDEX_PATH, getKbRoot(workspace));
  if (fs.existsSync(indexPath)) {
    const index = loadPageIndexLenient(workspace);
    const entryIndex = index.pages.findIndex((page) => page.path === resolvedPath.relativePath);
    if (entryIndex !== -1) {
      index.pages[entryIndex].headings = extractHeadings(newBody);
      index.pages[entryIndex].body_excerpt = extractExcerpt(newBody);
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
    }
  }

  return {
    path: resolvedPath.relativePath,
    action,
  };
}
