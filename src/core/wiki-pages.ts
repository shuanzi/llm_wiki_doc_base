import * as fs from "fs";
import * as path from "path";
import type { WorkspaceConfig } from "../types";
import {
  parseFrontmatter,
  resolveKbPath,
  serializeFrontmatter,
  validateFrontmatter,
} from "../utils";
import { assertWikiRebuildable, rebuildPageIndex } from "./wiki-maintenance";
import {
  assertNotSymlinkWriteTarget,
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

type WorkspaceLike = string | WorkspaceConfig;

function getKbRoot(workspace: WorkspaceLike): string {
  return typeof workspace === "string" ? workspace : workspace.kb_root;
}

function getWikiRoot(workspace: WorkspaceLike): string {
  return path.resolve(getKbRoot(workspace), "wiki");
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep);
}

function getHeadingLevel(line: string): number | null {
  const match = line.trimEnd().match(/^(#{1,6})\s+.+$/);
  return match ? match[1].length : null;
}

function listWikiMarkdownPaths(workspace: WorkspaceLike): string[] {
  const kbRoot = getKbRoot(workspace);
  const wikiRoot = getWikiRoot(workspace);
  if (!fs.existsSync(wikiRoot) || !fs.statSync(wikiRoot).isDirectory()) {
    return [];
  }

  const realKbRoot = fs.realpathSync(kbRoot);
  const realWikiRoot = fs.realpathSync(wikiRoot);
  if (!isWithinRoot(realWikiRoot, realKbRoot)) {
    throw new Error("kb/wiki resolves through a symlink outside kb/");
  }

  const relativePaths: string[] = [];
  const stack: string[] = [wikiRoot];

  while (stack.length > 0) {
    const currentPath = stack.pop() as string;
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        relativePaths.push(path.relative(kbRoot, absolutePath).replace(/\\/g, "/"));
      }
    }
  }

  return relativePaths.sort((left, right) => left.localeCompare(right));
}

function assertUniquePageId(
  pageId: string,
  targetRelativePath: string,
  workspace: WorkspaceLike
): void {
  const kbRoot = getKbRoot(workspace);

  for (const relativePath of listWikiMarkdownPaths(workspace)) {
    if (relativePath === targetRelativePath) {
      continue;
    }

    const absolutePath = resolveKbPath(relativePath, kbRoot);
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(fs.readFileSync(absolutePath, "utf8"));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot verify page_id uniqueness because ${relativePath} has invalid frontmatter: ${message}`
      );
    }

    const validation = validateFrontmatter(parsed.frontmatter);
    if (!validation.valid) {
      throw new Error(
        `Cannot verify page_id uniqueness because ${relativePath} has invalid frontmatter: ${validation.errors.join("; ")}`
      );
    }

    if (parsed.frontmatter.id === pageId) {
      throw new Error(
        `Page ID "${pageId}" is already used by "${relativePath}" — IDs must be unique across the wiki`
      );
    }
  }
}

export function writeWikiPage(
  input: WriteWikiPageInput,
  workspace: WorkspaceLike
): WriteWikiPageResult {
  const resolvedPath: ResolvedWikiPath = resolveWikiScopedPath(input.path, workspace);
  assertNotSymlinkWriteTarget(input.path, resolvedPath.absolutePath);

  const { frontmatter } = parseFrontmatter(input.content);
  const validation = validateFrontmatter(frontmatter);
  if (!validation.valid) {
    throw new Error(`Frontmatter validation failed:\n${validation.errors.join("\n")}`);
  }

  const page_id = frontmatter.id as string;
  const relativePath = resolvedPath.relativePath;
  assertUniquePageId(page_id, relativePath, workspace);

  const fileAlreadyExists = fs.existsSync(resolvedPath.absolutePath);
  if (input.create_only && fileAlreadyExists) {
    throw new Error(`File already exists at "${relativePath}" and create_only is true`);
  }

  const action: WriteWikiPageResult["action"] = fileAlreadyExists ? "updated" : "created";
  const parentDir = path.dirname(resolvedPath.absolutePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  assertWikiRebuildable(workspace, {
    path: relativePath,
    content: input.content,
  });
  fs.writeFileSync(resolvedPath.absolutePath, input.content, "utf8");
  rebuildPageIndex(workspace);

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
  const headingLevel = getHeadingLevel(input.heading);
  if (headingLevel === null) {
    throw new Error(
      `Invalid heading "${input.heading}" for ${input.path}; expected a Markdown heading like "## Summary".`
    );
  }

  const resolvedPath = resolveWikiScopedPath(input.path, workspace);
  assertNotSymlinkWriteTarget(input.path, resolvedPath.absolutePath);
  if (!fs.existsSync(resolvedPath.absolutePath)) {
    throw new Error(`File not found: ${input.path}`);
  }

  const raw = fs.readFileSync(resolvedPath.absolutePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const currentValidation = validateFrontmatter(frontmatter);
  if (!currentValidation.valid) {
    throw new Error(
      `Frontmatter validation failed before update:\n${currentValidation.errors.join("\n")}`
    );
  }

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
  const updatedValidation = validateFrontmatter(updatedFrontmatter);
  if (!updatedValidation.valid) {
    throw new Error(
      `Frontmatter validation failed after update:\n${updatedValidation.errors.join("\n")}`
    );
  }

  const serialized = serializeFrontmatter(updatedFrontmatter as Record<string, unknown>);
  const newContent = serialized + "\n\n" + newBody.trimStart();

  assertWikiRebuildable(workspace);
  fs.writeFileSync(resolvedPath.absolutePath, newContent, "utf8");
  rebuildPageIndex(workspace);

  return {
    path: resolvedPath.relativePath,
    action,
  };
}
