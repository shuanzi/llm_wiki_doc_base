import * as fs from "fs";
import * as path from "path";
import type {
  PageFrontmatter,
  PageIndex,
  PageIndexEntry,
  SearchQuery,
  SearchResult,
  WorkspaceConfig,
} from "../types";
import { parseFrontmatter, resolveKbPath } from "../utils";
import { rebuildPageIndex } from "./wiki-maintenance";

export interface ReadWikiPageResult {
  path: string;
  frontmatter: Partial<PageFrontmatter>;
  body: string;
}

const PAGE_INDEX_PATH = "state/cache/page-index.json";

type WorkspaceLike = string | WorkspaceConfig;
type LoadPageIndexOptions = {
  allowMissing?: boolean;
  allowMalformed?: boolean;
};

export interface ResolvedWikiPath {
  absolutePath: string;
  relativePath: string;
}

class PageIndexLoadError extends Error {
  constructor(
    message: string,
    readonly kind: "parse" | "shape" | "entry"
  ) {
    super(message);
    this.name = "PageIndexLoadError";
  }
}

function getKbRoot(workspace: WorkspaceLike): string {
  return typeof workspace === "string" ? workspace : workspace.kb_root;
}

function getWikiDir(workspace: WorkspaceLike): string {
  return path.resolve(getKbRoot(workspace), "wiki");
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep);
}

function findNearestExistingAncestor(targetPath: string, stopPath: string): string {
  let currentPath = targetPath;
  while (!fs.existsSync(currentPath) && currentPath !== stopPath) {
    currentPath = path.dirname(currentPath);
  }

  return currentPath;
}

function assertNoSymlinkedWikiAncestors(
  targetPath: string,
  absolutePath: string,
  wikiDir: string
): void {
  let currentPath = path.dirname(absolutePath);
  while (isWithinRoot(currentPath, wikiDir)) {
    if (fs.existsSync(currentPath) && fs.lstatSync(currentPath).isSymbolicLink()) {
      throw new Error(
        `Path "${targetPath}" traverses a symlinked directory under kb/wiki/`
      );
    }

    if (currentPath === wikiDir) {
      break;
    }

    currentPath = path.dirname(currentPath);
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPageIndexEntry(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.page_id === "string" &&
    typeof entry.path === "string" &&
    typeof entry.type === "string" &&
    typeof entry.title === "string" &&
    isStringArray(entry.aliases) &&
    isStringArray(entry.tags) &&
    isStringArray(entry.headings) &&
    typeof entry.body_excerpt === "string"
  );
}

function parsePageIndexJson(indexPath: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    throw new PageIndexLoadError(`Malformed page index at ${PAGE_INDEX_PATH}`, "parse");
  }

  return parsed;
}

function assertPageIndexHasPagesArray(parsed: unknown): asserts parsed is { pages: unknown[] } {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { pages?: unknown }).pages)
  ) {
    throw new PageIndexLoadError(`Malformed page index at ${PAGE_INDEX_PATH}`, "shape");
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeStringArray(value: unknown): string[] {
  return isStringArray(value) ? value : [];
}

function normalizeStrictPageIndexEntry(value: unknown): PageIndexEntry {
  if (!value || typeof value !== "object") {
    throw new PageIndexLoadError(`Malformed page index at ${PAGE_INDEX_PATH}`, "entry");
  }

  const entry = value as Record<string, unknown>;
  if (typeof entry.page_id !== "string" || typeof entry.path !== "string") {
    throw new PageIndexLoadError(`Malformed page index at ${PAGE_INDEX_PATH}`, "entry");
  }

  return {
    page_id: entry.page_id,
    path: entry.path,
    type: normalizeString(entry.type),
    title: normalizeString(entry.title),
    aliases: normalizeStringArray(entry.aliases),
    tags: normalizeStringArray(entry.tags),
    headings: normalizeStringArray(entry.headings),
    body_excerpt: normalizeString(entry.body_excerpt),
  };
}

function parsePageIndexStrict(indexPath: string): PageIndex {
  const parsed = parsePageIndexJson(indexPath);
  assertPageIndexHasPagesArray(parsed);

  return {
    pages: parsed.pages.map((page) => normalizeStrictPageIndexEntry(page)),
  };
}

function parsePageIndexLenient(indexPath: string): PageIndex {
  const parsed = parsePageIndexJson(indexPath);
  assertPageIndexHasPagesArray(parsed);
  return parsed as PageIndex;
}

function readPageIndex(
  workspace: WorkspaceLike,
  options: LoadPageIndexOptions = {}
): PageIndex {
  const indexPath = resolveKbPath(PAGE_INDEX_PATH, getKbRoot(workspace));
  if (!fs.existsSync(indexPath)) {
    if (options.allowMissing ?? true) {
      return { pages: [] };
    }

    throw new Error(
      "Page index not found. Run kb_rebuild_index to build kb/state/cache/page-index.json."
    );
  }

  try {
    return options.allowMalformed ? parsePageIndexLenient(indexPath) : parsePageIndexStrict(indexPath);
  } catch (error) {
    if (options.allowMalformed && error instanceof PageIndexLoadError && error.kind === "parse") {
      return { pages: [] };
    }

    throw error;
  }
}

export function loadPageIndexStrict(
  workspace: WorkspaceLike,
  options: Omit<LoadPageIndexOptions, "allowMalformed"> = {}
): PageIndex {
  return readPageIndex(workspace, {
    allowMissing: options.allowMissing,
    allowMalformed: false,
  });
}

export function loadPageIndexLenient(workspace: WorkspaceLike): PageIndex {
  return readPageIndex(workspace, {
    allowMissing: true,
    allowMalformed: true,
  });
}

export function resolveWikiScopedPath(
  targetPath: string,
  workspace: WorkspaceLike
): ResolvedWikiPath {
  const kbRoot = getKbRoot(workspace);
  const wikiDir = getWikiDir(workspace);
  const absolutePath = resolveKbPath(targetPath, kbRoot);

  if (!isWithinRoot(absolutePath, wikiDir)) {
    throw new Error(`Path "${targetPath}" must be within kb/wiki/`);
  }

  assertNoSymlinkedWikiAncestors(targetPath, absolutePath, wikiDir);

  const nearestExistingAncestor = findNearestExistingAncestor(absolutePath, kbRoot);
  const realKbRoot = fs.realpathSync(kbRoot);
  const realAncestor = fs.realpathSync(nearestExistingAncestor);
  if (!isWithinRoot(realAncestor, realKbRoot)) {
    throw new Error(
      `Path "${targetPath}" resolves through a symlink outside kb/wiki/`
    );
  }

  if (fs.existsSync(wikiDir)) {
    const realWikiDir = fs.realpathSync(wikiDir);
    if (!isWithinRoot(realAncestor, realWikiDir)) {
      throw new Error(
        `Path "${targetPath}" resolves through a symlink outside kb/wiki/`
      );
    }
  }

  return {
    absolutePath,
    relativePath: path.relative(kbRoot, absolutePath).replace(/\\/g, "/"),
  };
}

export function assertNotSymlinkWriteTarget(targetPath: string, absolutePath: string): void {
  if (fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isSymbolicLink()) {
    throw new Error(
      `Path "${targetPath}" resolves to a symlink — symlinks are not allowed as write targets`
    );
  }
}

export function loadPageIndex(workspace: WorkspaceLike): PageIndex {
  return loadPageIndexLenient(workspace);
}

function loadSearchablePageIndex(workspace: WorkspaceLike): PageIndex {
  try {
    return loadPageIndexStrict(workspace, { allowMissing: false });
  } catch (error) {
    rebuildPageIndex(workspace);
    return loadPageIndexStrict(workspace, { allowMissing: false });
  }
}

export function lookupWikiPagePathById(
  pageId: string,
  workspace: WorkspaceLike
): string | null {
  const entry = loadSearchablePageIndex(workspace).pages.find(
    (page) => page.page_id === pageId
  );
  return entry?.path ?? null;
}

export function resolveWikiPagePathOrId(
  pathOrId: string,
  workspace: WorkspaceLike
): string {
  if (pathOrId.includes("/") || pathOrId.endsWith(".md")) {
    return resolveWikiScopedPath(pathOrId, workspace).relativePath;
  }

  const relativePath = lookupWikiPagePathById(pathOrId, workspace);
  if (!relativePath) {
    throw new Error(`Page not found with page_id: ${pathOrId}`);
  }

  return resolveWikiScopedPath(relativePath, workspace).relativePath;
}

function normalizeWikiPathLikeTarget(target: string): string | null {
  let normalized = target.trim().toLowerCase().replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }

  normalized = normalized.replace(/^\/+/, "").replace(/\/+/g, "/");
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (normalized.startsWith("wiki/")) {
    normalized = normalized.slice("wiki/".length);
  }
  if (normalized.endsWith(".md")) {
    normalized = normalized.slice(0, -3);
  }
  normalized = normalized.replace(/^\/+|\/+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

export function resolveWikiLink(
  link: string,
  workspace: WorkspaceLike
): SearchResult[] {
  const normalizedLink = link.trim();
  const raw = normalizedLink.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  const pipeIndex = raw.indexOf("|");
  const linkTarget = (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
  const needle = linkTarget.toLowerCase();
  const normalizedPathTarget = normalizeWikiPathLikeTarget(linkTarget);

  for (const page of loadSearchablePageIndex(workspace).pages) {
    const titleMatch = page.title.toLowerCase() === needle;
    const idMatch = page.page_id.toLowerCase() === needle;
    const aliasMatch = page.aliases.some((alias) => alias.toLowerCase() === needle);
    const pathMatch =
      normalizedPathTarget !== null &&
      normalizeWikiPathLikeTarget(page.path) === normalizedPathTarget;

    if (titleMatch || idMatch || aliasMatch || pathMatch) {
      return [
        {
          page_id: page.page_id,
          path: page.path,
          title: page.title,
          type: page.type,
          score: 1,
          excerpt: page.body_excerpt,
        },
      ];
    }
  }

  return [];
}

export function searchWiki(
  input: SearchQuery,
  workspace: WorkspaceLike
): SearchResult[] {
  const resolveLink =
    typeof input.resolve_link === "string" ? input.resolve_link.trim() : "";
  if (resolveLink) {
    return resolveWikiLink(resolveLink, workspace);
  }

  const query = (input.query ?? "").toLowerCase().trim();
  if (!query) {
    throw new Error("query is required unless resolve_link is provided.");
  }
  const keywords = query.split(/\s+/).filter((keyword) => keyword.length > 0);
  const limit = input.limit ?? 10;
  const results: SearchResult[] = [];

  for (const page of loadSearchablePageIndex(workspace).pages) {
    if (input.type_filter && page.type !== input.type_filter) {
      continue;
    }

    if (input.tags && input.tags.length > 0) {
      const pageTags = new Set(page.tags.map((tag) => tag.toLowerCase()));
      if (!input.tags.every((tag) => pageTags.has(tag.toLowerCase()))) {
        continue;
      }
    }

    let score = 0;
    for (const keyword of keywords) {
      if (page.title.toLowerCase().includes(keyword)) {
        score += 3;
      }
      if (page.aliases.some((alias) => alias.toLowerCase().includes(keyword))) {
        score += 2;
      }
      if (page.tags.some((tag) => tag.toLowerCase() === keyword)) {
        score += 2;
      }
      if (page.headings.some((heading) => heading.toLowerCase().includes(keyword))) {
        score += 1;
      }
      if (page.body_excerpt.toLowerCase().includes(keyword)) {
        score += 1;
      }
    }

    if (score > 0) {
      results.push({
        page_id: page.page_id,
        path: page.path,
        title: page.title,
        type: page.type,
        score,
        excerpt: page.body_excerpt,
      });
    }
  }

  results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  return results.slice(0, limit);
}

export function readWikiPage(
  pathOrId: string,
  workspace: WorkspaceLike
): ReadWikiPageResult {
  const relativePath = resolveWikiPagePathOrId(pathOrId, workspace);
  const { absolutePath } = resolveWikiScopedPath(relativePath, workspace);
  const stat = fs.lstatSync(absolutePath);

  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to read symlink: ${relativePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);

  return {
    path: relativePath,
    frontmatter,
    body,
  };
}
