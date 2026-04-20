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

export interface RebuildPageIndexResult {
  version: number;
  total_pages: number;
  written_to: string;
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
  applied_fixes: KbRepairFix[];
  lint: KbLintReport;
}

interface ScannedWikiPage {
  path: string;
  frontmatter: Partial<PageFrontmatter>;
  body: string;
  rebuildEntry: PageIndexEntry | null;
  validation: ReturnType<typeof validateFrontmatter>;
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
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      path: relativePath,
      frontmatter,
      body,
      rebuildEntry: buildPageIndexEntry(relativePath, content),
      validation: validateFrontmatter(frontmatter),
    };
  });
}

function buildPageIndexFromScan(pages: ScannedWikiPage[]): PageIndex {
  return {
    pages: pages
      .map((page) => page.rebuildEntry)
      .filter((entry): entry is PageIndexEntry => entry !== null)
      .sort(compareEntries),
  };
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

function hasWikilinkTarget(
  target: string,
  pages: ScannedWikiPage[]
): boolean {
  const needle = target.toLowerCase();
  return pages.some((page) => {
    const id = typeof page.frontmatter.id === "string" ? page.frontmatter.id.toLowerCase() : "";
    const title =
      typeof page.frontmatter.title === "string" ? page.frontmatter.title.toLowerCase() : "";
    const aliases = normalizeStringArray(page.frontmatter.aliases).map((alias) =>
      alias.toLowerCase()
    );
    return id === needle || title === needle || aliases.includes(needle);
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
  const { frontmatter, body } = parseFrontmatter(content);
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

function buildPageIndex(workspace: WorkspaceLike): PageIndex {
  const pages = buildPageIndexFromScan(scanWikiPages(workspace)).pages;

  assertUniquePageIds(pages);

  return { pages };
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
): { action: "create" | "rewrite" | null; absolutePath: string } {
  const absolutePath = resolveKbPath(spec.relativePath, getKbRoot(workspace));

  if (!fs.existsSync(absolutePath)) {
    return { action: "create", absolutePath };
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  const { frontmatter } = parseFrontmatter(content);
  const validation = validateFrontmatter(frontmatter);

  if (!validation.valid) {
    return { action: "rewrite", absolutePath };
  }

  if (frontmatter.id !== spec.pageId || frontmatter.type !== "index") {
    return { action: "rewrite", absolutePath };
  }

  return { action: null, absolutePath };
}

function ensureMetaPage(
  workspace: WorkspaceLike,
  spec: MetaPageSpec,
  apply: boolean,
  fixes: KbRepairFix[]
): void {
  const state = getMetaPageState(workspace, spec);
  if (!state.action) {
    return;
  }

  fixes.push({
    rule: state.action === "create" ? "missing-meta-page" : "invalid-meta-page",
    path: spec.writtenTo,
    action: state.action,
    applied: apply,
    detail:
      state.action === "create"
        ? `Create ${spec.writtenTo}`
        : `Rewrite malformed structural page ${spec.writtenTo}`,
  });

  if (!apply) {
    return;
  }

  fs.mkdirSync(path.dirname(state.absolutePath), { recursive: true });
  fs.writeFileSync(state.absolutePath, buildMetaPageContent(spec), "utf8");
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

export function rebuildPageIndex(workspace: WorkspaceLike): RebuildPageIndexResult {
  const kbRoot = getKbRoot(workspace);
  const pageIndexPath = resolveKbPath(PAGE_INDEX_PATH, kbRoot);
  const pageIndex = buildPageIndex(workspace);

  fs.mkdirSync(path.dirname(pageIndexPath), { recursive: true });
  fs.writeFileSync(pageIndexPath, JSON.stringify(pageIndex, null, 2), "utf8");

  return {
    version: 2,
    total_pages: pageIndex.pages.length,
    written_to: WRITTEN_TO_PATH,
  };
}

export function repairKb(
  workspace: WorkspaceLike,
  options: { dry_run?: boolean } = {}
): KbRepairResult {
  const dryRun = options.dry_run === true;
  const apply = !dryRun;
  const fixes: KbRepairFix[] = [];

  for (const spec of META_PAGE_SPECS) {
    ensureMetaPage(workspace, spec, apply, fixes);
  }

  fixes.push({
    rule: "rebuild-page-index",
    path: WRITTEN_TO_PATH,
    action: "rebuild",
    applied: apply,
    detail: `Rebuild ${WRITTEN_TO_PATH}`,
  });

  if (apply) {
    rebuildPageIndex(workspace);
  }

  return {
    dry_run: dryRun,
    applied_fixes: fixes,
    lint: runKbLint(workspace),
  };
}
