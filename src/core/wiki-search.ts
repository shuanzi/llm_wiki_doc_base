import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import type {
  PageFrontmatter,
  PageIndex,
  PageIndexEntry,
  SearchQuery,
  SearchResult,
  WorkspaceConfig,
} from "../types";
import { parseFrontmatter, resolveKbPath } from "../utils";

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
      "Page index not found. Use kb_write_page to create pages — the index is built incrementally."
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

export function lookupWikiPagePathById(
  pageId: string,
  workspace: WorkspaceLike
): string | null {
  const entry = loadPageIndexStrict(workspace, { allowMissing: false }).pages.find(
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

export function resolveWikiLink(
  link: string,
  workspace: WorkspaceLike
): SearchResult[] {
  const normalizedLink = link.trim();
  const raw = normalizedLink.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  const pipeIndex = raw.indexOf("|");
  const linkTarget = (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
  const needle = linkTarget.toLowerCase();

  for (const page of loadPageIndexStrict(workspace).pages) {
    const titleMatch = page.title.toLowerCase() === needle;
    const idMatch = page.page_id.toLowerCase() === needle;
    const aliasMatch = page.aliases.some((alias) => alias.toLowerCase() === needle);

    if (titleMatch || idMatch || aliasMatch) {
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

const SEARCH_BM25_PATH = "state/cache/search-bm25.json";
const SEARCH_STATE_PATH = "state/cache/search-index-state.json";
const SEARCH_STATE_VERSION = 1;
const BM25_VERSION = 1;
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_RG_TIMEOUT_MS = 10_000;
const DEFAULT_QMD_TIMEOUT_MS = 30_000;

type SearchState = {
  version: number;
  generated_at: string;
  last_mutation_at?: string;
  last_mutation_reason?: string;
  bm25?: { stale: boolean; corpus_hash?: string; generated_at?: string; docs?: number; last_error?: string };
  qmd?: { stale: boolean; corpus_hash?: string; generated_at?: string; index_name?: string; collection_name?: string; last_error?: string };
};

type Bm25Doc = {
  page_id: string;
  path: string;
  title: string;
  type: string;
  aliases: string[];
  tags: string[];
  headings: string[];
  length: number;
  fields: { title: string; aliases: string; tags: string; headings: string; body: string };
};

type Bm25Index = {
  version: number;
  generated_at: string;
  corpus_hash: string;
  docs: Bm25Doc[];
  df: Record<string, number>;
  avgdl: number;
};

export interface SearchIndexStatus {
  generated_at: string;
  corpus_hash: string;
  page_index: { pages: number };
  ripgrep: { available: boolean; bin: string; error?: string };
  bm25: { exists: boolean; stale: boolean; path: string; docs: number; generated_at?: string; corpus_hash?: string; last_error?: string };
  qmd: { available: boolean; stale: boolean; bin: string; index_name: string; collection_name: string; last_rebuild_at?: string; corpus_hash?: string; last_error?: string };
}

export interface RebuildSearchIndexOptions {
  backend?: "bm25" | "qmd" | "all";
}

export interface RebuildSearchIndexResult {
  backend: "bm25" | "qmd" | "all";
  generated_at: string;
  bm25?: { rebuilt: boolean; docs: number; path: string; corpus_hash: string };
  qmd?: { rebuilt: boolean; available: boolean; index_name: string; collection_name: string; corpus_hash?: string; error?: string };
}

function nowIso(): string {
  return new Date().toISOString();
}

function statePath(workspace: WorkspaceLike): string {
  return resolveKbPath(SEARCH_STATE_PATH, getKbRoot(workspace));
}

function bm25Path(workspace: WorkspaceLike): string {
  return resolveKbPath(SEARCH_BM25_PATH, getKbRoot(workspace));
}

function readState(workspace: WorkspaceLike): SearchState {
  const target = statePath(workspace);
  if (!fs.existsSync(target)) {
    return { version: SEARCH_STATE_VERSION, generated_at: nowIso(), bm25: { stale: true }, qmd: { stale: true } };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as Partial<SearchState>;
    return {
      version: SEARCH_STATE_VERSION,
      generated_at: parsed.generated_at ?? nowIso(),
      last_mutation_at: parsed.last_mutation_at,
      last_mutation_reason: parsed.last_mutation_reason,
      bm25: { stale: parsed.bm25?.stale !== false, corpus_hash: parsed.bm25?.corpus_hash, generated_at: parsed.bm25?.generated_at, docs: parsed.bm25?.docs, last_error: parsed.bm25?.last_error },
      qmd: { stale: parsed.qmd?.stale !== false, corpus_hash: parsed.qmd?.corpus_hash, generated_at: parsed.qmd?.generated_at, index_name: parsed.qmd?.index_name, collection_name: parsed.qmd?.collection_name, last_error: parsed.qmd?.last_error },
    };
  } catch {
    return { version: SEARCH_STATE_VERSION, generated_at: nowIso(), bm25: { stale: true }, qmd: { stale: true } };
  }
}

function writeState(workspace: WorkspaceLike, state: SearchState): void {
  const target = statePath(workspace);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(state, null, 2), "utf8");
}

function patchState(workspace: WorkspaceLike, patch: (state: SearchState) => void): void {
  const state = readState(workspace);
  patch(state);
  state.generated_at = nowIso();
  writeState(workspace, state);
}

export function markSearchIndexesStale(workspace: WorkspaceLike, reason = "wiki content changed"): void {
  const state = readState(workspace);
  const at = nowIso();
  state.generated_at = at;
  state.last_mutation_at = at;
  state.last_mutation_reason = reason;
  state.bm25 = { ...(state.bm25 ?? { stale: true }), stale: true };
  state.qmd = { ...(state.qmd ?? { stale: true }), stale: true };
  writeState(workspace, state);
}

function limit(input: SearchQuery): number {
  const requested = input.limit ?? DEFAULT_SEARCH_LIMIT;
  return Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 100) : DEFAULT_SEARCH_LIMIT;
}

function requiredQuery(input: SearchQuery): string {
  const query = input.query?.trim() ?? "";
  if (!query) {
    throw new Error("kb_search_wiki requires query unless resolve_link is provided.");
  }
  return query;
}

function pageMatches(page: PageIndexEntry, input: SearchQuery): boolean {
  if (input.type_filter && page.type !== input.type_filter) {
    return false;
  }
  if (input.tags?.length) {
    const tags = new Set(page.tags.map((tag) => tag.toLowerCase()));
    return input.tags.every((tag) => tags.has(tag.toLowerCase()));
  }
  return true;
}

function listWikiMarkdownPaths(workspace: WorkspaceLike): string[] {
  const kbRoot = getKbRoot(workspace);
  const wikiDir = getWikiDir(workspace);
  if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) {
    return [];
  }
  const realKbRoot = fs.realpathSync(kbRoot);
  const realWikiDir = fs.realpathSync(wikiDir);
  if (!isWithinRoot(realWikiDir, realKbRoot)) {
    throw new Error("kb/wiki resolves through a symlink outside kb/");
  }
  const paths: string[] = [];
  const stack = [wikiDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        paths.push(path.relative(kbRoot, absolute).replace(/\\/g, "/"));
      }
    }
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

function corpusHash(workspace: WorkspaceLike): string {
  const kbRoot = getKbRoot(workspace);
  const hash = crypto.createHash("sha256");
  for (const relativePath of listWikiMarkdownPaths(workspace)) {
    const content = fs.readFileSync(resolveKbPath(relativePath, kbRoot), "utf8");
    hash.update(relativePath).update("\0").update(content).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function hasCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u.test(text);
}

function tokens(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[\[\]()*_>#|{}:`~]/g, " ");
  const matches = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]+|[\p{L}\p{N}_-]+/gu) ?? [];
  const out: string[] = [];
  for (const match of matches) {
    out.push(match);
    if (hasCjk(match)) {
      const chars = Array.from(match);
      for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
    }
  }
  return out.filter(Boolean);
}

function termCounts(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^---[\s\S]*?^---\s*/m, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label: string | undefined) => label ?? target)
    .replace(/[>#*_`~|]/g, " ");
}

function makeSnippet(text: string, queryTokens: string[], fallback: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  const lower = compact.toLowerCase();
  const first = queryTokens.map((token) => lower.indexOf(token.toLowerCase())).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return compact.length > 260 ? `${compact.slice(0, 257)}...` : compact;
  const start = Math.max(0, first - 90);
  const end = Math.min(compact.length, first + 170);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
}

function bm25Doc(page: PageIndexEntry, workspace: WorkspaceLike): Bm25Doc {
  let body = page.body_excerpt;
  const absolute = resolveKbPath(page.path, getKbRoot(workspace));
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
    const content = fs.readFileSync(absolute, "utf8");
    try { body = parseFrontmatter(content).body; } catch { body = content; }
  }
  const fields = {
    title: page.title,
    aliases: page.aliases.join("\n"),
    tags: page.tags.join("\n"),
    headings: page.headings.join("\n"),
    body: stripMarkdown(body),
  };
  const length = Math.max(1, Object.values(fields).reduce((sum, value) => sum + tokens(value).length, 0));
  return { page_id: page.page_id, path: page.path, title: page.title, type: page.type, aliases: page.aliases, tags: page.tags, headings: page.headings, length, fields };
}

function buildBm25(workspace: WorkspaceLike): Bm25Index {
  const docs = loadPageIndexStrict(workspace, { allowMissing: false }).pages.map((page) => bm25Doc(page, workspace));
  const df = new Map<string, number>();
  for (const doc of docs) {
    const unique = new Set(Object.values(doc.fields).flatMap((field) => tokens(field)));
    for (const token of unique) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return {
    version: BM25_VERSION,
    generated_at: nowIso(),
    corpus_hash: corpusHash(workspace),
    docs,
    df: Object.fromEntries([...df.entries()].sort(([a], [b]) => a.localeCompare(b))),
    avgdl: docs.length ? docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length : 1,
  };
}

function readBm25(workspace: WorkspaceLike): Bm25Index | null {
  const target = bm25Path(workspace);
  if (!fs.existsSync(target)) return null;
  try {
    const index = JSON.parse(fs.readFileSync(target, "utf8")) as Bm25Index;
    return index.version === BM25_VERSION && Array.isArray(index.docs) && typeof index.df === "object" ? index : null;
  } catch {
    return null;
  }
}

function writeBm25(workspace: WorkspaceLike, index: Bm25Index): void {
  const target = bm25Path(workspace);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(index, null, 2), "utf8");
  patchState(workspace, (state) => {
    state.bm25 = { stale: false, corpus_hash: index.corpus_hash, generated_at: index.generated_at, docs: index.docs.length };
  });
}

function loadBm25(workspace: WorkspaceLike, refresh: boolean): Bm25Index {
  const currentHash = corpusHash(workspace);
  const cached = refresh ? null : readBm25(workspace);
  const state = readState(workspace);
  if (cached && cached.corpus_hash === currentHash && state.bm25?.stale !== true) return cached;
  const rebuilt = buildBm25(workspace);
  writeBm25(workspace, rebuilt);
  return rebuilt;
}

function scoreBm25(doc: Bm25Doc, index: Bm25Index, queryTokens: string[]): number {
  const k1 = 1.2;
  const b = 0.75;
  const weights: Record<keyof Bm25Doc["fields"], number> = { title: 4, aliases: 3, tags: 2.5, headings: 2, body: 1 };
  const fieldCounts = new Map<keyof Bm25Doc["fields"], Map<string, number>>();
  for (const key of Object.keys(doc.fields) as Array<keyof Bm25Doc["fields"]>) fieldCounts.set(key, termCounts(tokens(doc.fields[key])));
  let score = 0;
  for (const token of new Set(queryTokens)) {
    const df = index.df[token] ?? 0;
    if (df === 0) continue;
    let tf = 0;
    for (const key of Object.keys(weights) as Array<keyof Bm25Doc["fields"]>) tf += (fieldCounts.get(key)?.get(token) ?? 0) * weights[key];
    if (tf <= 0) continue;
    const idf = Math.log(1 + (Math.max(index.docs.length, 1) - df + 0.5) / (df + 0.5));
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.length / Math.max(index.avgdl, 1)))));
  }
  const phrase = queryTokens.join(" ");
  if (doc.title.toLowerCase() === phrase) score += 5;
  else if (doc.title.toLowerCase().includes(phrase)) score += 2;
  return score;
}

function searchIndex(input: SearchQuery, workspace: WorkspaceLike): SearchResult[] {
  const query = requiredQuery(input).toLowerCase();
  const keywords = query.split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];
  for (const page of loadPageIndexStrict(workspace).pages) {
    if (!pageMatches(page, input)) continue;
    let score = 0;
    for (const keyword of keywords) {
      if (page.title.toLowerCase().includes(keyword)) score += 3;
      if (page.aliases.some((alias) => alias.toLowerCase().includes(keyword))) score += 2;
      if (page.tags.some((tag) => tag.toLowerCase() === keyword)) score += 2;
      if (page.headings.some((heading) => heading.toLowerCase().includes(keyword))) score += 1;
      if (page.body_excerpt.toLowerCase().includes(keyword)) score += 1;
    }
    if (score > 0) results.push({ page_id: page.page_id, path: page.path, title: page.title, type: page.type, score, excerpt: page.body_excerpt, backend: "index", match_kind: "page", highlights: keywords });
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit(input));
}

function searchBm25(input: SearchQuery, workspace: WorkspaceLike): SearchResult[] {
  const queryTokens = tokens(requiredQuery(input));
  if (!queryTokens.length) return [];
  const index = loadBm25(workspace, input.refresh_index === true);
  const results: SearchResult[] = [];
  for (const doc of index.docs) {
    const page: PageIndexEntry = { page_id: doc.page_id, path: doc.path, title: doc.title, type: doc.type, aliases: doc.aliases, tags: doc.tags, headings: doc.headings, body_excerpt: "" };
    if (!pageMatches(page, input)) continue;
    const score = scoreBm25(doc, index, queryTokens);
    if (score > 0) results.push({ page_id: doc.page_id, path: doc.path, title: doc.title, type: doc.type, score, excerpt: makeSnippet(doc.fields.body, queryTokens, ""), backend: "bm25", match_kind: "document", highlights: [...new Set(queryTokens)] });
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit(input));
}

function exe(bin: string, args = ["--version"]): { available: boolean; error?: string } {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 5_000 });
  if (result.error) return { available: false, error: result.error.message };
  if (typeof result.status === "number" && result.status > 1) return { available: false, error: (result.stderr || result.stdout || `exit ${result.status}`).trim() };
  return { available: true };
}

function rgBin(): string { return process.env.RG_BIN || "rg"; }
function qmdBin(): string { return process.env.QMD_BIN || "qmd"; }
function qmdCollection(): string { return process.env.QMD_COLLECTION_NAME || "llm_doc_base_wiki"; }
function qmdIndex(workspace: WorkspaceLike): string {
  return process.env.QMD_INDEX_NAME?.trim() || `llm_doc_base_${crypto.createHash("sha256").update(getKbRoot(workspace)).digest("hex").slice(0, 8)}`;
}
function qmdSearchCommand(): "search" | "query" | "vsearch" {
  const command = process.env.QMD_SEARCH_COMMAND;
  return command === "search" || command === "vsearch" || command === "query" ? command : "query";
}
function timeoutEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pageByPath(pages: PageIndexEntry[], rawPath: string): PageIndexEntry | undefined {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const withWiki = normalized.startsWith("wiki/") ? normalized : `wiki/${normalized}`;
  return pages.find((page) => page.path === withWiki || page.path === normalized);
}

function searchRg(input: SearchQuery, workspace: WorkspaceLike): SearchResult[] {
  const query = requiredQuery(input);
  const status = exe(rgBin());
  if (!status.available) throw new Error(`ripgrep backend is unavailable (${rgBin()}): ${status.error ?? "not found"}`);
  const result = spawnSync(rgBin(), ["--json", "--smart-case", "--fixed-strings", "--glob", "**/*.md", "-e", query, "."], {
    cwd: getWikiDir(workspace), encoding: "utf8", timeout: timeoutEnv("RG_TIMEOUT_MS", DEFAULT_RG_TIMEOUT_MS), maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`ripgrep backend failed: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1) throw new Error(`ripgrep backend failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  const index = loadPageIndexStrict(workspace, { allowMissing: false });
  const grouped = new Map<string, Array<{ line: string; lineNumber: number; highlights: string[] }>>();
  for (const line of (result.stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    let parsed: { type?: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number; submatches?: Array<{ match?: { text?: string } }> } };
    try { parsed = JSON.parse(line) as typeof parsed; } catch { continue; }
    if (parsed.type !== "match" || !parsed.data?.path?.text || !parsed.data.lines?.text) continue;
    const page = pageByPath(index.pages, parsed.data.path.text);
    if (!page || !pageMatches(page, input)) continue;
    const matches = grouped.get(page.path) ?? [];
    matches.push({ line: parsed.data.lines.text.trimEnd(), lineNumber: parsed.data.line_number ?? 0, highlights: (parsed.data.submatches ?? []).map((m) => m.match?.text).filter((value): value is string => !!value) });
    grouped.set(page.path, matches);
  }
  const results: SearchResult[] = [];
  for (const [relativePath, matches] of grouped.entries()) {
    const page = index.pages.find((entry) => entry.path === relativePath);
    if (!page) continue;
    results.push({
      page_id: page.page_id, path: page.path, title: page.title, type: page.type, score: 10 + matches.length,
      excerpt: matches.slice(0, input.include_body ? 4 : 2).map((m) => `L${m.lineNumber}: ${m.line}`).join("\n") || page.body_excerpt,
      backend: "rg", match_kind: "line", line_number: matches[0]?.lineNumber,
      highlights: [...new Set(matches.flatMap((m) => m.highlights.length ? m.highlights : [query]))],
    });
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit(input));
}

function normalizeQmdPath(raw: string, workspace: WorkspaceLike): string | null {
  const cleaned = raw.replace(/\\/g, "/").replace(/^file:\/\//, "");
  if (path.isAbsolute(cleaned)) {
    const relKb = path.relative(getKbRoot(workspace), cleaned).replace(/\\/g, "/");
    if (relKb.startsWith("wiki/")) return relKb;
    const relWiki = path.relative(getWikiDir(workspace), cleaned).replace(/\\/g, "/");
    return relWiki.startsWith("..") ? null : `wiki/${relWiki}`;
  }
  return cleaned.startsWith("wiki/") ? cleaned : `wiki/${cleaned.replace(/^\.\//, "")}`;
}

function recordsFromJson(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  for (const key of ["results", "matches", "documents", "items"]) {
    if (Array.isArray(obj[key])) return (obj[key] as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  return [];
}

function strField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) if (typeof obj[key] === "string" && (obj[key] as string).trim()) return obj[key] as string;
  return undefined;
}

function numField(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && Number.isFinite(Number.parseFloat(value))) return Number.parseFloat(value);
  }
  return undefined;
}

function rebuildQmd(workspace: WorkspaceLike, throwOnError: boolean): RebuildSearchIndexResult["qmd"] {
  const bin = qmdBin(), indexName = qmdIndex(workspace), collectionName = qmdCollection(), hash = corpusHash(workspace);
  const status = exe(bin, ["--help"]);
  if (!status.available) {
    const error = `QMD backend is unavailable (${bin}): ${status.error ?? "not found"}`;
    patchState(workspace, (state) => { state.qmd = { ...(state.qmd ?? { stale: true }), stale: true, index_name: indexName, collection_name: collectionName, last_error: error }; });
    if (throwOnError) throw new Error(error);
    return { rebuilt: false, available: false, index_name: indexName, collection_name: collectionName, error };
  }
  const base = ["--index", indexName];
  const add = spawnSync(bin, [...base, "collection", "add", getWikiDir(workspace), "--name", collectionName, "--mask", "**/*.md"], { encoding: "utf8", timeout: timeoutEnv("QMD_TIMEOUT_MS", DEFAULT_QMD_TIMEOUT_MS), maxBuffer: 8 * 1024 * 1024 });
  if (add.error) {
    const error = `QMD collection add failed: ${add.error.message}`;
    patchState(workspace, (state) => { state.qmd = { ...(state.qmd ?? { stale: true }), stale: true, last_error: error }; });
    if (throwOnError) throw new Error(error);
    return { rebuilt: false, available: true, index_name: indexName, collection_name: collectionName, error };
  }
  const update = spawnSync(bin, [...base, "update"], { encoding: "utf8", timeout: timeoutEnv("QMD_TIMEOUT_MS", DEFAULT_QMD_TIMEOUT_MS), maxBuffer: 8 * 1024 * 1024 });
  if (update.error || update.status !== 0) {
    const error = update.error?.message ?? (update.stderr || update.stdout || `exit ${update.status}`).trim();
    patchState(workspace, (state) => { state.qmd = { ...(state.qmd ?? { stale: true }), stale: true, index_name: indexName, collection_name: collectionName, corpus_hash: hash, last_error: error }; });
    if (throwOnError) throw new Error(`QMD update failed: ${error}`);
    return { rebuilt: false, available: true, index_name: indexName, collection_name: collectionName, corpus_hash: hash, error };
  }
  patchState(workspace, (state) => { state.qmd = { stale: false, corpus_hash: hash, generated_at: nowIso(), index_name: indexName, collection_name: collectionName }; });
  return { rebuilt: true, available: true, index_name: indexName, collection_name: collectionName, corpus_hash: hash };
}

function searchQmd(input: SearchQuery, workspace: WorkspaceLike): SearchResult[] {
  const query = requiredQuery(input);
  const bin = qmdBin();
  const status = exe(bin, ["--help"]);
  if (!status.available) throw new Error(`QMD backend is unavailable (${bin}): ${status.error ?? "not found"}`);
  if (input.refresh_index) rebuildQmd(workspace, true);
  if (readState(workspace).qmd?.stale === true) throw new Error("QMD search index is stale. Run kb_search_rebuild_index with backend='qmd' or pass refresh_index=true.");
  const result = spawnSync(bin, ["--index", qmdIndex(workspace), qmdSearchCommand(), "--json", "-n", String(limit(input)), query], { encoding: "utf8", timeout: timeoutEnv("QMD_TIMEOUT_MS", DEFAULT_QMD_TIMEOUT_MS), maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(`QMD backend failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`QMD backend failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout || "[]"); } catch { throw new Error("QMD backend returned non-JSON output despite --json."); }
  const pages = loadPageIndexStrict(workspace, { allowMissing: false }).pages;
  const results: SearchResult[] = [];
  for (const record of recordsFromJson(parsed)) {
    const rawPath = strField(record, ["path", "filepath", "file", "filename", "document", "id"]);
    if (!rawPath) continue;
    const page = pageByPath(pages, normalizeQmdPath(rawPath, workspace) ?? "");
    if (!page || !pageMatches(page, input)) continue;
    results.push({ page_id: page.page_id, path: page.path, title: strField(record, ["title"]) ?? page.title, type: page.type, score: numField(record, ["score", "rerankScore", "rerank_score", "similarity"]) ?? 0, excerpt: strField(record, ["snippet", "text", "excerpt", "content", "body"]) ?? page.body_excerpt, backend: "qmd", match_kind: "document", highlights: [query] });
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit(input));
}

function preferRg(query: string): boolean {
  return /\[\[[^\]]+\]\]/u.test(query) || /\bsrc_sha256_[0-9a-f]{8,12}\b/u.test(query) || /\b[a-z0-9_-]+\.md\b/iu.test(query) || query.includes("/") || /^"[^"]+"$/u.test(query.trim());
}

function searchAuto(input: SearchQuery, workspace: WorkspaceLike): SearchResult[] {
  const query = requiredQuery(input);
  if (preferRg(query)) {
    try { return searchRg(input, workspace); } catch { return searchBm25(input, workspace); }
  }
  if (exe(qmdBin(), ["--help"]).available && readState(workspace).qmd?.stale === false) {
    try {
      const qmd = searchQmd(input, workspace);
      if (qmd.length) return qmd;
    } catch { /* local fallback below */ }
  }
  return searchBm25(input, workspace);
}

export function getSearchIndexStatus(workspace: WorkspaceLike): SearchIndexStatus {
  const hash = corpusHash(workspace);
  const state = readState(workspace);
  const bm25 = readBm25(workspace);
  const rg = exe(rgBin());
  const qmd = exe(qmdBin(), ["--help"]);
  return {
    generated_at: nowIso(),
    corpus_hash: hash,
    page_index: { pages: loadPageIndexStrict(workspace, { allowMissing: true }).pages.length },
    ripgrep: { available: rg.available, bin: rgBin(), error: rg.error },
    bm25: { exists: !!bm25, stale: !bm25 || bm25.corpus_hash !== hash || state.bm25?.stale !== false, path: `kb/${SEARCH_BM25_PATH}`, docs: bm25?.docs.length ?? 0, generated_at: bm25?.generated_at, corpus_hash: bm25?.corpus_hash, last_error: state.bm25?.last_error },
    qmd: { available: qmd.available, stale: state.qmd?.stale !== false || state.qmd?.corpus_hash !== hash, bin: qmdBin(), index_name: qmdIndex(workspace), collection_name: qmdCollection(), last_rebuild_at: state.qmd?.generated_at, corpus_hash: state.qmd?.corpus_hash, last_error: qmd.error ?? state.qmd?.last_error },
  };
}

export function rebuildSearchIndexes(workspace: WorkspaceLike, options: RebuildSearchIndexOptions = {}): RebuildSearchIndexResult {
  const backend = options.backend ?? "all";
  const result: RebuildSearchIndexResult = { backend, generated_at: nowIso() };
  if (backend === "bm25" || backend === "all") {
    const index = buildBm25(workspace);
    writeBm25(workspace, index);
    result.bm25 = { rebuilt: true, docs: index.docs.length, path: `kb/${SEARCH_BM25_PATH}`, corpus_hash: index.corpus_hash };
  }
  if (backend === "qmd" || backend === "all") result.qmd = rebuildQmd(workspace, backend === "qmd");
  return result;
}

export function searchWiki(input: SearchQuery, workspace: WorkspaceLike): SearchResult[] {
  if (input.resolve_link !== undefined) return resolveWikiLink(input.resolve_link, workspace);
  switch (input.mode ?? "auto") {
    case "index": return searchIndex(input, workspace);
    case "rg": return searchRg(input, workspace);
    case "bm25": return searchBm25(input, workspace);
    case "qmd": return searchQmd(input, workspace);
    case "auto": return searchAuto(input, workspace);
  }
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
