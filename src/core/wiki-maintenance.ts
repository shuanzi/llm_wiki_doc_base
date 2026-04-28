import * as fs from "fs";
import * as path from "path";
import type { PageFrontmatter, PageIndex, PageIndexEntry, WorkspaceConfig } from "../types";
import {
  extractExcerpt,
  extractHeadings,
  parseFrontmatter,
  resolveKbPath,
  validateFrontmatter,
} from "../utils";

const PAGE_INDEX_PATH = "state/cache/page-index.json";
const WRITTEN_TO_PATH = "kb/state/cache/page-index.json";

type WorkspaceLike = string | WorkspaceConfig;

export interface KbLintIssue {
  severity: "error" | "warning";
  rule: string;
  detail: string;
  page?: string;
}

export interface KbLintReport {
  ok: boolean;
  generated_at: string;
  total_pages: number;
  cache: {
    path: string;
    exists: boolean;
    stale: boolean;
    drift: boolean;
  };
  deterministic: {
    errors: number;
    warnings: number;
    issues: KbLintIssue[];
  };
  semantic: {
    enabled: boolean;
    warnings: number;
    issues: KbLintIssue[];
  };
}

export interface RunKbLintOptions {
  include_semantic?: boolean;
}

export interface RebuildSkippedPage {
  path: string;
  reason: "invalid_frontmatter" | "missing_index_fields";
  error: string;
}

export interface RebuildPageIndexOptions {
  allow_partial?: boolean;
}

export interface RebuildPageIndexResult {
  version: number;
  total_pages: number;
  written_to: string;
  skipped_pages: RebuildSkippedPage[];
}

export interface KbRepairFix {
  rule: "missing-meta-page" | "invalid-meta-page" | "rebuild-page-index";
  path: string;
  action: "create" | "rewrite" | "rebuild";
  applied: boolean;
  detail: string;
}

export interface KbRepairResult {
  dry_run: boolean;
  force: boolean;
  applied_fixes: KbRepairFix[];
  lint: KbLintReport;
}

interface ScannedWikiPage {
  path: string;
  frontmatter: Partial<PageFrontmatter>;
  body: string;
  rebuildEntry: PageIndexEntry | null;
  validation: ReturnType<typeof validateFrontmatter>;
  parseError?: string;
}

interface MetaPageSpec {
  relativePath: "wiki/index.md" | "wiki/log.md";
  writtenTo: "kb/wiki/index.md" | "kb/wiki/log.md";
  pageId: "wiki_index" | "wiki_log";
  title: string;
  body: string[];
}

const META_PAGE_SPECS: MetaPageSpec[] = [
  {
    relativePath: "wiki/index.md",
    writtenTo: "kb/wiki/index.md",
    pageId: "wiki_index",
    title: "Knowledge Base Index",
    body: [
      "# Knowledge Base Index",
      "",
      "## Navigation",
      "- [[wiki_log|Change Log]] — ingest and edit history <!-- dedup:index_nav_wiki_log -->",
      "",
      "## Sources",
      "",
      "## Concepts",
      "",
      "## Entities",
      "",
      "## Analyses",
    ],
  },
  {
    relativePath: "wiki/log.md",
    writtenTo: "kb/wiki/log.md",
    pageId: "wiki_log",
    title: "Change Log",
    body: ["# Change Log", "", "## Recent"],
  },
];

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

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function compareEntries(a: PageIndexEntry, b: PageIndexEntry): number {
  const byPageId = a.page_id.localeCompare(b.page_id);
  if (byPageId !== 0) {
    return byPageId;
  }

  return a.path.localeCompare(b.path);
}

function assertUniquePageIds(entries: PageIndexEntry[]): void {
  const duplicates: string[] = [];

  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1].page_id === entries[index].page_id) {
      duplicates.push(entries[index].page_id);
    }
  }

  if (duplicates.length === 0) {
    return;
  }

  const uniqueDuplicates = Array.from(new Set(duplicates)).sort((left, right) =>
    left.localeCompare(right)
  );
  throw new Error(
    `Duplicate page_id values found during rebuild: ${uniqueDuplicates.join(", ")}`
  );
}

function isLikelyPageIndexObject(value: unknown): value is { pages: unknown[] } {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { pages?: unknown }).pages)
  );
}

function normalizePageIndexEntry(value: unknown): PageIndexEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Record<string, unknown>;
  if (typeof entry.page_id !== "string" || typeof entry.path !== "string") {
    return null;
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

function readCachedPageIndex(
  workspace: WorkspaceLike
): { exists: false } | { exists: true; malformed: true } | { exists: true; malformed: false; index: PageIndex } {
  const indexPath = resolveKbPath(PAGE_INDEX_PATH, getKbRoot(workspace));
  if (!fs.existsSync(indexPath)) {
    return { exists: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return { exists: true, malformed: true };
  }

  if (!isLikelyPageIndexObject(parsed)) {
    return { exists: true, malformed: true };
  }

  const pages: PageIndexEntry[] = [];
  for (const page of parsed.pages) {
    const normalized = normalizePageIndexEntry(page);
    if (!normalized) {
      return { exists: true, malformed: true };
    }
    pages.push(normalized);
  }

  pages.sort(compareEntries);
  return {
    exists: true,
    malformed: false,
    index: { pages },
  };
}

function scanWikiPages(workspace: WorkspaceLike): ScannedWikiPage[] {
  return listWikiMarkdownPaths(workspace).map((relativePath) => {
    const absolutePath = resolveKbPath(relativePath, getKbRoot(workspace));
    const content = fs.readFileSync(absolutePath, "utf8");

    try {
      const { frontmatter, body } = parseFrontmatter(content);
      return {
        path: relativePath,
        frontmatter,
        body,
        rebuildEntry: buildPageIndexEntry(relativePath, content),
        validation: validateFrontmatter(frontmatter),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        path: relativePath,
        frontmatter: {},
        body: "",
        rebuildEntry: null,
        validation: {
          valid: false,
          errors: [message],
          warnings: [],
          parsed: {},
        },
        parseError: message,
      };
    }
  });
}

function buildPageIndexFromScan(pages: ScannedWikiPage[]): PageIndex {
  return {
    pages: pages
      .filter((page) => page.validation.valid)
      .map((page) => page.rebuildEntry)
      .filter((entry): entry is PageIndexEntry => entry !== null)
      .sort(compareEntries),
  };
}

function collectPageIndexFailures(pages: ScannedWikiPage[]): RebuildSkippedPage[] {
  return pages
    .filter((page) => !page.validation.valid || page.rebuildEntry === null)
    .map((page) => {
      if (!page.validation.valid || page.parseError) {
        return {
          path: page.path,
          reason: "invalid_frontmatter" as const,
          error: page.validation.errors.join("; ") || page.parseError || "Invalid frontmatter",
        };
      }

      return {
        path: page.path,
        reason: "missing_index_fields" as const,
        error: "Page is missing id or type frontmatter required for page-index.json",
      };
    });
}

function formatPageIndexFailures(failures: RebuildSkippedPage[]): string {
  return failures
    .map((failure) => "- " + failure.path + ": " + failure.reason + ": " + failure.error)
    .join("\n");
}

function comparePageIndexEntryContent(left: PageIndexEntry, right: PageIndexEntry): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function extractWikilinks(body: string): string[] {
  const matches = body.match(/\[\[[^[\]]+\]\]/g) ?? [];
  return matches.map((match) => {
    const raw = match.slice(2, -2).trim();
    const pipeIndex = raw.indexOf("|");
    return (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
  });
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

function hasWikilinkTarget(
  target: string,
  pages: ScannedWikiPage[]
): boolean {
  const needle = target.toLowerCase();
  const normalizedPathTarget = normalizeWikiPathLikeTarget(target);
  return pages.some((page) => {
    const id = typeof page.frontmatter.id === "string" ? page.frontmatter.id.toLowerCase() : "";
    const title =
      typeof page.frontmatter.title === "string" ? page.frontmatter.title.toLowerCase() : "";
    const aliases = normalizeStringArray(page.frontmatter.aliases).map((alias) =>
      alias.toLowerCase()
    );
    if (id === needle || title === needle || aliases.includes(needle)) {
      return true;
    }

    if (!normalizedPathTarget) {
      return false;
    }

    return normalizeWikiPathLikeTarget(page.path) === normalizedPathTarget;
  });
}

function daysBetween(dayIso: string, now: Date): number | null {
  const timestamp = Date.parse(`${dayIso}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.floor((now.getTime() - timestamp) / (1000 * 60 * 60 * 24));
}

function pushIssue(issues: KbLintIssue[], issue: KbLintIssue): void {
  issues.push(issue);
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
        relativePaths.push(
          path.relative(kbRoot, absolutePath).replace(/\\/g, "/")
        );
      }
    }
  }

  return relativePaths.sort((left, right) => left.localeCompare(right));
}

function buildPageIndexEntry(filePath: string, content: string): PageIndexEntry | null {
  let frontmatter: Partial<PageFrontmatter>;
  let body: string;
  try {
    const parsed = parseFrontmatter(content);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  } catch {
    return null;
  }

  const fm = frontmatter as Partial<PageFrontmatter>;

  if (typeof fm.id !== "string" || typeof fm.type !== "string") {
    return null;
  }

  return {
    page_id: fm.id,
    path: filePath,
    type: fm.type,
    title: typeof fm.title === "string" && fm.title.length > 0 ? fm.title : fm.id,
    aliases: normalizeStringArray(fm.aliases),
    tags: normalizeStringArray(fm.tags),
    headings: extractHeadings(body),
    body_excerpt: extractExcerpt(body),
  };
}

function buildPageIndex(
  workspace: WorkspaceLike,
  options: RebuildPageIndexOptions = {}
): { index: PageIndex; skipped_pages: RebuildSkippedPage[] } {
  const scannedPages = scanWikiPages(workspace);
  const skippedPages = collectPageIndexFailures(scannedPages);
  if (skippedPages.length > 0 && options.allow_partial !== true) {
    throw new Error(
      "Cannot rebuild page index because one or more wiki pages cannot be indexed.\n" +
        formatPageIndexFailures(skippedPages)
    );
  }

  const index = buildPageIndexFromScan(scannedPages);
  assertUniquePageIds(index.pages);

  return { index, skipped_pages: skippedPages };
}

export function assertWikiRebuildable(
  workspace: WorkspaceLike
): void {
  buildPageIndex(workspace);
}

function buildMetaPageContent(spec: MetaPageSpec): string {
  return [
    "---",
    `id: ${spec.pageId}`,
    "type: index",
    `title: ${spec.title}`,
    `updated_at: ${todayIso()}`,
    "status: active",
    "---",
    "",
    ...spec.body,
    "",
  ].join("\n");
}

function getMetaPageState(
  workspace: WorkspaceLike,
  spec: MetaPageSpec
): { action: "create" | "rewrite" | null; absolutePath: string; malformed: boolean } {
  const absolutePath = resolveKbPath(spec.relativePath, getKbRoot(workspace));

  if (!fs.existsSync(absolutePath)) {
    return { action: "create", absolutePath, malformed: false };
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  let frontmatter: Partial<PageFrontmatter>;
  try {
    frontmatter = parseFrontmatter(content).frontmatter;
  } catch {
    return { action: "rewrite", absolutePath, malformed: true };
  }

  const validation = validateFrontmatter(frontmatter);

  if (!validation.valid) {
    return { action: "rewrite", absolutePath, malformed: true };
  }

  if (frontmatter.id !== spec.pageId || frontmatter.type !== "index") {
    return { action: "rewrite", absolutePath, malformed: false };
  }

  return { action: null, absolutePath, malformed: false };
}

function ensureMetaPage(
  workspace: WorkspaceLike,
  spec: MetaPageSpec,
  apply: boolean,
  force: boolean,
  fixes: KbRepairFix[]
): { unappliedMalformedRewrite: boolean } {
  const state = getMetaPageState(workspace, spec);
  if (!state.action) {
    return { unappliedMalformedRewrite: false };
  }

  const isDestructiveRewrite = state.action === "rewrite" && state.malformed;
  const shouldApply = apply && (!isDestructiveRewrite || force);
  fixes.push({
    rule: state.action === "create" ? "missing-meta-page" : "invalid-meta-page",
    path: spec.writtenTo,
    action: state.action,
    applied: shouldApply,
    detail:
      state.action === "create"
        ? `Create ${spec.writtenTo}`
        : state.malformed
          ? force
            ? `Rewrite malformed structural page ${spec.writtenTo}`
            : `Skip destructive rewrite of malformed structural page ${spec.writtenTo}; pass force: true to rewrite it`
          : `Rewrite structural page ${spec.writtenTo} to restore expected id/type`,
  });

  if (!shouldApply) {
    return {
      unappliedMalformedRewrite:
        state.action === "rewrite" && state.malformed,
    };
  }

  fs.mkdirSync(path.dirname(state.absolutePath), { recursive: true });
  fs.writeFileSync(state.absolutePath, buildMetaPageContent(spec), "utf8");
  return { unappliedMalformedRewrite: false };
}
function sourcePageIds(page: ScannedWikiPage): string[] {
  const sourceIds = normalizeStringArray(page.frontmatter.source_ids);
  if (sourceIds.length > 0) {
    return Array.from(new Set(sourceIds)).sort((left, right) => left.localeCompare(right));
  }

  return typeof page.frontmatter.id === "string" && page.frontmatter.id.startsWith("src_")
    ? [page.frontmatter.id]
    : [];
}

function pushSourceTraceabilityIssue(
  issues: KbLintIssue[],
  page: ScannedWikiPage,
  rule: "source-manifest-missing" | "source-manifest-malformed" | "source-raw-missing",
  detail: string
): void {
  const isExplicitlyUnverified = page.frontmatter.verification_status === "missing_raw_source";
  pushIssue(issues, {
    severity: isExplicitlyUnverified ? "warning" : "error",
    rule: isExplicitlyUnverified ? "source-trace-unverified" : rule,
    detail,
    page: page.path,
  });
}

function checkSourceTraceability(
  workspace: WorkspaceLike,
  page: ScannedWikiPage,
  issues: KbLintIssue[]
): void {
  if (page.frontmatter.type !== "source") {
    return;
  }

  const kbRoot = getKbRoot(workspace);
  for (const sourceId of sourcePageIds(page)) {
    const manifestPath = resolveKbPath("state/manifests/" + sourceId + ".json", kbRoot);
    if (!fs.existsSync(manifestPath)) {
      pushSourceTraceabilityIssue(
        issues,
        page,
        "source-manifest-missing",
        "Source page references " + sourceId + ", but kb/state/manifests/" + sourceId + ".json is missing."
      );
      continue;
    }

    let manifest: { source_id?: unknown; canonical_path?: unknown };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        source_id?: unknown;
        canonical_path?: unknown;
      };
    } catch {
      pushSourceTraceabilityIssue(
        issues,
        page,
        "source-manifest-malformed",
        "Manifest kb/state/manifests/" + sourceId + ".json is not valid JSON."
      );
      continue;
    }

    if (manifest.source_id !== sourceId || typeof manifest.canonical_path !== "string") {
      pushSourceTraceabilityIssue(
        issues,
        page,
        "source-manifest-malformed",
        "Manifest kb/state/manifests/" + sourceId + ".json does not match source_id or lacks canonical_path."
      );
      continue;
    }

    let canonicalSourcePath: string;
    try {
      canonicalSourcePath = resolveKbPath(manifest.canonical_path, kbRoot);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      pushSourceTraceabilityIssue(
        issues,
        page,
        "source-manifest-malformed",
        "Manifest kb/state/manifests/" +
          sourceId +
          ".json has invalid canonical_path: " +
          message
      );
      continue;
    }

    if (!fs.existsSync(canonicalSourcePath)) {
      pushSourceTraceabilityIssue(
        issues,
        page,
        "source-raw-missing",
        "Manifest canonical source is missing: kb/" + manifest.canonical_path + "."
      );
    }
  }
}
export function runKbLint(
  workspace: WorkspaceLike,
  options: RunKbLintOptions = {}
): KbLintReport {
  const includeSemantic = options.include_semantic !== false;
  const generatedAt = new Date().toISOString();
  const now = new Date();
  const deterministicIssues: KbLintIssue[] = [];
  const semanticIssues: KbLintIssue[] = [];
  const scannedPages = scanWikiPages(workspace);
  const rebuiltIndex = buildPageIndexFromScan(scannedPages);
  const cacheInfo = readCachedPageIndex(workspace);
  let cacheStale = false;
  let cacheDrift = false;

  const pageIdToPaths = new Map<string, string[]>();
  for (const page of scannedPages) {
    if (typeof page.frontmatter.id === "string" && page.frontmatter.id.length > 0) {
      const currentPaths = pageIdToPaths.get(page.frontmatter.id) ?? [];
      currentPaths.push(page.path);
      pageIdToPaths.set(page.frontmatter.id, currentPaths);
    }
  }

  for (const [pageId, pagePaths] of Array.from(pageIdToPaths.entries()).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (pagePaths.length > 1) {
      pushIssue(deterministicIssues, {
        severity: "error",
        rule: "duplicate-page-id",
        detail: `Duplicate page id "${pageId}" appears in ${pagePaths.length} pages.`,
        page: pagePaths.join(", "),
      });
    }
  }

  if (!cacheInfo.exists) {
    cacheStale = true;
    pushIssue(deterministicIssues, {
      severity: "error",
      rule: "cache-missing",
      detail: `Missing page index at kb/${PAGE_INDEX_PATH}`,
      page: `kb/${PAGE_INDEX_PATH}`,
    });
  } else if (cacheInfo.malformed) {
    cacheStale = true;
    pushIssue(deterministicIssues, {
      severity: "error",
      rule: "cache-malformed",
      detail: `Malformed page index at kb/${PAGE_INDEX_PATH}`,
      page: `kb/${PAGE_INDEX_PATH}`,
    });
  } else {
    const rebuiltByPageId = new Map(rebuiltIndex.pages.map((page) => [page.page_id, page]));
    const cachedByPageId = new Map(cacheInfo.index.pages.map((page) => [page.page_id, page]));

    for (const rebuiltPage of rebuiltIndex.pages) {
      const cachedPage = cachedByPageId.get(rebuiltPage.page_id);
      if (!cachedPage) {
        cacheStale = true;
        pushIssue(deterministicIssues, {
          severity: "warning",
          rule: "cache-stale",
          detail: `Cached page index is missing page "${rebuiltPage.page_id}".`,
          page: rebuiltPage.path,
        });
        continue;
      }

      if (!comparePageIndexEntryContent(cachedPage, rebuiltPage)) {
        cacheStale = true;
        cacheDrift = true;
        pushIssue(deterministicIssues, {
          severity: "warning",
          rule: "cache-drift",
          detail: `Cached page index entry for "${rebuiltPage.page_id}" differs from wiki content.`,
          page: rebuiltPage.path,
        });
      }
    }

    for (const cachedPage of cacheInfo.index.pages) {
      if (!rebuiltByPageId.has(cachedPage.page_id)) {
        cacheStale = true;
        pushIssue(deterministicIssues, {
          severity: "warning",
          rule: "cache-stale",
          detail: `Cached page index contains stale page "${cachedPage.page_id}".`,
          page: cachedPage.path,
        });
      }
    }
  }

  for (const metaPath of ["wiki/index.md", "wiki/log.md"]) {
    const absolutePath = resolveKbPath(metaPath, getKbRoot(workspace));
    if (!fs.existsSync(absolutePath)) {
      pushIssue(deterministicIssues, {
        severity: "error",
        rule: "missing-meta-page",
        detail: `Required meta page is missing: ${metaPath}`,
        page: metaPath,
      });
    }
  }

  for (const page of scannedPages) {
    if (!page.validation.valid) {
      pushIssue(deterministicIssues, {
        severity: "error",
        rule: "invalid-frontmatter",
        detail: page.validation.errors.join("; "),
        page: page.path,
      });
    }

    for (const warning of page.validation.warnings) {
      pushIssue(deterministicIssues, {
        severity: "warning",
        rule: "frontmatter-warning",
        detail: warning,
        page: page.path,
      });
    }

    if (page.validation.valid) {
      checkSourceTraceability(workspace, page, deterministicIssues);
    }

    for (const linkTarget of extractWikilinks(page.body)) {
      if (!hasWikilinkTarget(linkTarget, scannedPages)) {
        pushIssue(deterministicIssues, {
          severity: "error",
          rule: "broken-wikilink",
          detail: `Unresolved wikilink [[${linkTarget}]].`,
          page: page.path,
        });
      }
    }
  }

  if (includeSemantic) {
    const validPages = scannedPages.filter((page) => page.validation.valid);
    const sourcePages = validPages.filter((page) => page.frontmatter.type === "source");
    const conceptOrEntityPages = validPages.filter(
      (page) => page.frontmatter.type === "concept" || page.frontmatter.type === "entity"
    );

    if (sourcePages.length > 0 && conceptOrEntityPages.length === 0) {
      pushIssue(semanticIssues, {
        severity: "warning",
        rule: "semantic-missing-concept-entity-pages",
        detail: "Source pages exist but no concept or entity pages were found.",
      });
    }

    for (const page of validPages) {
      if (
        page.frontmatter.type === "source" ||
        page.frontmatter.type === "concept" ||
        page.frontmatter.type === "entity" ||
        page.frontmatter.type === "analysis"
      ) {
        const relatedLinks = normalizeStringArray(page.frontmatter.related);
        if (relatedLinks.length === 0) {
          pushIssue(semanticIssues, {
            severity: "warning",
            rule: "semantic-missing-related-links",
            detail: "Page has no related links.",
            page: page.path,
          });
        }
      }

      if (typeof page.frontmatter.updated_at === "string") {
        const ageInDays = daysBetween(page.frontmatter.updated_at, now);
        if (ageInDays !== null && ageInDays > 365) {
          pushIssue(semanticIssues, {
            severity: "warning",
            rule: "semantic-stale-page",
            detail: `Page was last updated ${ageInDays} days ago.`,
            page: page.path,
          });
        }
      }

      if (
        page.frontmatter.type === "analysis" &&
        !/##\s+(uncertainties|open questions)/i.test(page.body)
      ) {
        pushIssue(semanticIssues, {
          severity: "warning",
          rule: "semantic-missing-uncertainties",
          detail: "Analysis page has no uncertainties or open questions section.",
          page: page.path,
        });
      }
    }
  }

  const deterministicErrors = deterministicIssues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const deterministicWarnings = deterministicIssues.filter(
    (issue) => issue.severity === "warning"
  ).length;

  return {
    ok: deterministicErrors === 0,
    generated_at: generatedAt,
    total_pages: scannedPages.length,
    cache: {
      path: `kb/${PAGE_INDEX_PATH}`,
      exists: cacheInfo.exists,
      stale: cacheStale,
      drift: cacheDrift,
    },
    deterministic: {
      errors: deterministicErrors,
      warnings: deterministicWarnings,
      issues: deterministicIssues,
    },
    semantic: {
      enabled: includeSemantic,
      warnings: includeSemantic ? semanticIssues.length : 0,
      issues: includeSemantic ? semanticIssues : [],
    },
  };
}

export function rebuildPageIndex(
  workspace: WorkspaceLike,
  options: RebuildPageIndexOptions = {}
): RebuildPageIndexResult {
  const kbRoot = getKbRoot(workspace);
  const pageIndexPath = resolveKbPath(PAGE_INDEX_PATH, kbRoot);
  const { index, skipped_pages } = buildPageIndex(workspace, options);

  fs.mkdirSync(path.dirname(pageIndexPath), { recursive: true });
  fs.writeFileSync(pageIndexPath, JSON.stringify(index, null, 2), "utf8");

  return {
    version: 2,
    total_pages: index.pages.length,
    written_to: WRITTEN_TO_PATH,
    skipped_pages,
  };
}

export function repairKb(
  workspace: WorkspaceLike,
  options: { dry_run?: boolean; force?: boolean } = {}
): KbRepairResult {
  const dryRun = options.dry_run === true;
  const apply = !dryRun;
  const force = options.force === true;
  const fixes: KbRepairFix[] = [];
  let hasUnappliedMalformedMetaRewrite = false;

  for (const spec of META_PAGE_SPECS) {
    const outcome = ensureMetaPage(workspace, spec, apply, force, fixes);
    hasUnappliedMalformedMetaRewrite =
      hasUnappliedMalformedMetaRewrite || outcome.unappliedMalformedRewrite;
  }

  const blockedByUnappliedMalformedMetaRewrite =
    apply && hasUnappliedMalformedMetaRewrite;
  const shouldRebuildPageIndex = apply && !hasUnappliedMalformedMetaRewrite;

  fixes.push({
    rule: "rebuild-page-index",
    path: WRITTEN_TO_PATH,
    action: "rebuild",
    applied: shouldRebuildPageIndex,
    detail: blockedByUnappliedMalformedMetaRewrite
      ? `Skip rebuilding ${WRITTEN_TO_PATH} because malformed structural pages still require force: true`
      : `Rebuild ${WRITTEN_TO_PATH}`,
  });

  if (shouldRebuildPageIndex) {
    rebuildPageIndex(workspace);
  }

  return {
    dry_run: dryRun,
    force,
    applied_fixes: fixes,
    lint: runKbLint(workspace),
  };
}
