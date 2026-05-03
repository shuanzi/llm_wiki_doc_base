import * as fs from "fs";
import * as path from "path";
import type {
  PageFrontmatter,
  SearchIndex,
  SearchIndexChunk,
  SearchQuery,
  SearchResult,
  WorkspaceConfig,
} from "../types";
import { parseFrontmatter, resolveKbPath, validateFrontmatter } from "../utils";

const SEARCH_INDEX_PATH = "state/cache/search-index.json";
const WRITTEN_TO_PATH = "kb/state/cache/search-index.json";
const MAX_MATCH_EXCERPT_CHARS = 240;

type WorkspaceLike = string | WorkspaceConfig;

export interface RebuildSearchIndexResult {
  version: number;
  total_chunks: number;
  written_to: string;
}

interface RebuildSearchIndexOptions {
  allow_partial?: boolean;
}

interface MarkdownChunkDraft {
  heading_path: string[];
  text: string;
}

function getKbRoot(workspace: WorkspaceLike): string {
  return typeof workspace === "string" ? workspace : workspace.kb_root;
}

function getWikiRoot(workspace: WorkspaceLike): string {
  return path.resolve(getKbRoot(workspace), "wiki");
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
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

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);

  return slug.length > 0 ? slug : "body";
}

function extractWikilinkTargets(text: string): string[] {
  const matches = text.match(/\[\[[^[\]]+\]\]/g) ?? [];
  const targets = matches.map((match) => {
    const raw = match.slice(2, -2).trim();
    const pipeIndex = raw.indexOf("|");
    return (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
  });

  return Array.from(new Set(targets.filter((target) => target.length > 0))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function splitBodyIntoHeadingChunks(body: string): MarkdownChunkDraft[] {
  const chunks: MarkdownChunkDraft[] = [];
  const headingStack: string[] = [];
  let currentHeadingPath: string[] = [];
  let currentLines: string[] = [];

  function flush(): void {
    const text = currentLines.join("\n").trim();
    if (text.length > 0) {
      chunks.push({ heading_path: currentHeadingPath, text });
    }
    currentLines = [];
  }

  for (const line of body.split("\n")) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/u);
    if (!headingMatch) {
      currentLines.push(line);
      continue;
    }

    flush();
    const level = headingMatch[1].length;
    headingStack.length = level - 1;
    headingStack[level - 1] = headingMatch[2].trim();
    currentHeadingPath = headingStack.filter((heading) => heading.length > 0);
    currentLines = [line];
  }

  flush();
  return chunks;
}

function buildSearchIndexChunk(
  relativePath: string,
  frontmatter: Partial<PageFrontmatter>,
  chunk: MarkdownChunkDraft,
  index: number
): SearchIndexChunk | null {
  if (typeof frontmatter.id !== "string" || typeof frontmatter.type !== "string") {
    return null;
  }

  const title =
    typeof frontmatter.title === "string" && frontmatter.title.length > 0
      ? frontmatter.title
      : frontmatter.id;
  const headingSlug = slugify(chunk.heading_path.join("-") || title);

  return {
    chunk_id: `${frontmatter.id}#${String(index + 1).padStart(3, "0")}-${headingSlug}`,
    page_id: frontmatter.id,
    path: relativePath,
    type: frontmatter.type,
    title,
    heading_path: chunk.heading_path,
    text: chunk.text,
    source_ids: normalizeStringArray(frontmatter.source_ids),
    tags: normalizeStringArray(frontmatter.tags),
    outlinks: extractWikilinkTargets(chunk.text),
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidSearchIndexChunk(value: unknown): value is SearchIndexChunk {
  if (!value || typeof value !== "object") {
    return false;
  }

  const chunk = value as Record<string, unknown>;
  return (
    typeof chunk.chunk_id === "string" &&
    typeof chunk.page_id === "string" &&
    typeof chunk.path === "string" &&
    typeof chunk.type === "string" &&
    typeof chunk.title === "string" &&
    isStringArray(chunk.heading_path) &&
    typeof chunk.text === "string" &&
    isStringArray(chunk.source_ids) &&
    isStringArray(chunk.tags) &&
    isStringArray(chunk.outlinks)
  );
}

function parseSearchIndex(value: unknown): SearchIndex | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeIndex = value as Partial<SearchIndex>;
  if (typeof maybeIndex.version !== "number" || !Array.isArray(maybeIndex.chunks)) {
    return null;
  }

  if (!maybeIndex.chunks.every((chunk) => isValidSearchIndexChunk(chunk))) {
    return null;
  }

  return {
    version: maybeIndex.version,
    chunks: maybeIndex.chunks,
  };
}

function buildSearchIndex(
  workspace: WorkspaceLike,
  options: RebuildSearchIndexOptions = {}
): SearchIndex {
  const kbRoot = getKbRoot(workspace);
  const chunks: SearchIndexChunk[] = [];

  for (const relativePath of listWikiMarkdownPaths(workspace)) {
    const content = fs.readFileSync(resolveKbPath(relativePath, kbRoot), "utf8");
    let frontmatter: Partial<PageFrontmatter>;
    let body: string;
    try {
      const parsed = parseFrontmatter(content);
      frontmatter = parsed.frontmatter;
      body = parsed.body;
    } catch (error: unknown) {
      if (options.allow_partial === true) {
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error("Cannot rebuild search index for " + relativePath + ": " + message);
    }
    const validation = validateFrontmatter(frontmatter);
    if (!validation.valid) {
      if (options.allow_partial === true) {
        continue;
      }
      throw new Error(
        `Cannot rebuild search index for ${relativePath}: Frontmatter validation failed: ${validation.errors.join("; ")}`
      );
    }

    splitBodyIntoHeadingChunks(body).forEach((chunk, index) => {
      const searchChunk = buildSearchIndexChunk(relativePath, frontmatter, chunk, index);
      if (searchChunk) {
        chunks.push(searchChunk);
      }
    });
  }

  chunks.sort((left, right) => left.chunk_id.localeCompare(right.chunk_id));
  return { version: 1, chunks };
}

export function rebuildSearchIndex(
  workspace: WorkspaceLike,
  options: RebuildSearchIndexOptions = {}
): RebuildSearchIndexResult {
  const kbRoot = getKbRoot(workspace);
  const index = buildSearchIndex(workspace, options);
  const indexPath = resolveKbPath(SEARCH_INDEX_PATH, kbRoot);

  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");

  return {
    version: index.version,
    total_chunks: index.chunks.length,
    written_to: WRITTEN_TO_PATH,
  };
}

function loadSearchIndexOrRebuild(workspace: WorkspaceLike): SearchIndex {
  const kbRoot = getKbRoot(workspace);
  const indexPath = resolveKbPath(SEARCH_INDEX_PATH, kbRoot);
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = parseSearchIndex(JSON.parse(fs.readFileSync(indexPath, "utf8")) as unknown);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Rebuild below.
    }
  }

  rebuildSearchIndex(workspace);
  return parseSearchIndex(JSON.parse(fs.readFileSync(indexPath, "utf8")) as unknown) ?? {
    version: 1,
    chunks: [],
  };
}

function matchExcerpt(text: string, keywords: string[]): string {
  const lowerText = text.toLowerCase();
  const firstKeyword = keywords.find((keyword) => lowerText.includes(keyword));
  if (!firstKeyword) {
    return text.slice(0, MAX_MATCH_EXCERPT_CHARS);
  }

  const start = Math.max(0, lowerText.indexOf(firstKeyword) - 80);
  const excerpt = text.slice(start, start + MAX_MATCH_EXCERPT_CHARS).trim();
  return start > 0 ? "..." + excerpt : excerpt;
}

export function searchWikiChunks(input: SearchQuery, workspace: WorkspaceLike): SearchResult[] {
  const query = (input.query ?? "").toLowerCase().trim();
  if (!query) {
    throw new Error("query is required for chunk search.");
  }

  const keywords = query.split(/\s+/u).filter((keyword) => keyword.length > 0);
  const limit = input.limit ?? 10;
  const results: SearchResult[] = [];

  for (const chunk of loadSearchIndexOrRebuild(workspace).chunks) {
    if (input.type_filter && chunk.type !== input.type_filter) {
      continue;
    }

    if (input.tags && input.tags.length > 0) {
      const chunkTags = new Set(chunk.tags.map((tag) => tag.toLowerCase()));
      if (!input.tags.every((tag) => chunkTags.has(tag.toLowerCase()))) {
        continue;
      }
    }

    let score = 0;
    const title = chunk.title.toLowerCase();
    const headings = chunk.heading_path.join(" ").toLowerCase();
    const text = chunk.text.toLowerCase();
    const tags = chunk.tags.map((tag) => tag.toLowerCase());

    for (const keyword of keywords) {
      if (title.includes(keyword)) score += 3;
      if (headings.includes(keyword)) score += 2;
      if (tags.includes(keyword)) score += 2;
      if (text.includes(keyword)) score += 1;
    }

    if (score > 0) {
      const excerpt = matchExcerpt(chunk.text, keywords);
      results.push({
        page_id: chunk.page_id,
        path: chunk.path,
        title: chunk.title,
        type: chunk.type,
        score,
        excerpt,
        heading_path: chunk.heading_path,
        match_text: excerpt,
      });
    }
  }

  results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  return results.slice(0, limit);
}
