import * as fs from "fs";
import * as path from "path";
import type { PageFrontmatter, WorkspaceConfig } from "../types";
import {
  parseFrontmatter,
  resolveKbPath,
  serializeFrontmatter,
  validateFrontmatter,
  validateSafeId,
  resolveWikiLinkTarget,
} from "../utils";
import { assertWikiRebuildable, rebuildPageIndex } from "./wiki-maintenance";
import { assertNotSymlinkWriteTarget, resolveWikiScopedPath } from "./wiki-search";

export interface EnsureWikiEntryInput {
  path: string;
  entry: string;
  anchor: string | null;
  dedup_key: string;
  bump_updated_at?: boolean;
}

export type WikiLogEntryKind = "ingest" | "query" | "lint" | "repair";

export interface AppendWikiLogEntryInput {
  path?: string;
  kind: WikiLogEntryKind;
  title: string;
  summary: string;
  date?: string;
  run_id?: string;
  changes?: string[];
  references?: string[];
  output_page_id?: string;
  output_label?: string;
  dedup_key: string;
}

export interface EnsureWikiEntryResult {
  action: "inserted" | "already_exists";
}

export interface AppendWikiLogEntryResult {
  action: "inserted" | "already_exists";
  path: string;
}

type WorkspaceLike = string | WorkspaceConfig;

const DEFAULT_LOG_PATH = "wiki/log.md";

interface WikiReferencePage {
  pageId: string;
  path: string;
  type: string;
  title: string;
  aliases: string[];
  sourceIds: string[];
}

interface ParsedReference {
  target: string;
  label?: string;
}

type SourceManifestLookup =
  | { status: "missing" }
  | { status: "present"; ingestStatus: string; summaryPageId: string | null };

function getKbRoot(workspace: WorkspaceLike): string {
  return typeof workspace === "string" ? workspace : workspace.kb_root;
}

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


function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertValidDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("date must use YYYY-MM-DD format.");
  }
}

function assertSafeLogText(value: string, label: string): void {
  assertSingleLine(value, label);
  if (value.includes("<!-- dedup:") || value.includes("-->") || value.includes("---")) {
    throw new Error(`${label} must not contain dedup markers, HTML comment terminators, or frontmatter delimiters.`);
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function listWikiMarkdownPaths(workspace: WorkspaceLike): string[] {
  const kbRoot = getKbRoot(workspace);
  const wikiRoot = resolveKbPath("wiki", kbRoot);
  if (!fs.existsSync(wikiRoot) || !fs.statSync(wikiRoot).isDirectory()) {
    return [];
  }

  const relativePaths: string[] = [];
  const stack = [wikiRoot];
  while (stack.length > 0) {
    const currentPath = stack.pop() as string;
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        relativePaths.push(path.relative(kbRoot, absolutePath).replace(/\\/g, "/"));
      }
    }
  }

  return relativePaths.sort((left, right) => left.localeCompare(right));
}

function listWikiReferencePages(workspace: WorkspaceLike): WikiReferencePage[] {
  const kbRoot = getKbRoot(workspace);
  return listWikiMarkdownPaths(workspace).map((relativePath) => {
    const content = fs.readFileSync(resolveKbPath(relativePath, kbRoot), "utf8");
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(content);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot resolve log references because ${relativePath} has invalid frontmatter: ${message}`
      );
    }

    const validation = validateFrontmatter(parsed.frontmatter);
    if (!validation.valid) {
      throw new Error(
        `Cannot resolve log references because ${relativePath} has invalid frontmatter: ${validation.errors.join("; ")}`
      );
    }

    const frontmatter = parsed.frontmatter as Partial<PageFrontmatter>;
    return {
      pageId: frontmatter.id as string,
      path: relativePath,
      type: typeof frontmatter.type === "string" ? frontmatter.type : "",
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      aliases: normalizeStringArray(frontmatter.aliases),
      sourceIds: normalizeStringArray(frontmatter.source_ids),
    };
  });
}

function parseReference(value: string): ParsedReference {
  const trimmed = value.trim();
  const raw =
    trimmed.startsWith("[[") && trimmed.endsWith("]]")
      ? trimmed.slice(2, -2).trim()
      : trimmed;
  const pipeIndex = raw.indexOf("|");
  const target = (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
  const label = pipeIndex >= 0 ? raw.slice(pipeIndex + 1).trim() : undefined;
  return { target, label: label || undefined };
}

function assertSafeWikilinkLabel(label: string, fieldName: string): void {
  if (label.includes("[[") || label.includes("]]") || label.includes("|")) {
    throw new Error(`${fieldName} must not contain wikilink delimiters.`);
  }
}

function isSourceIdLike(value: string): boolean {
  return /^src_[A-Za-z0-9._:-]+$/u.test(value);
}

function pageReferencesSourceId(page: WikiReferencePage, sourceId: string): boolean {
  const needle = sourceId.toLowerCase();
  return (
    page.pageId.toLowerCase() === needle ||
    page.sourceIds.some((candidateSourceId) => candidateSourceId.toLowerCase() === needle)
  );
}

function findSourceSummaryPage(
  sourceId: string,
  workspace: WorkspaceLike,
  pages: WikiReferencePage[]
): WikiReferencePage | undefined {
  const manifestLookup = readSourceManifestSummaryPageId(sourceId, workspace);
  if (manifestLookup.status === "missing") {
    throw new Error(
      `references[] source_id ${sourceId} must resolve to an existing source manifest.`
    );
  }

  if (manifestLookup.summaryPageId !== null) {
    const manifestPage = pages.find((page) => page.pageId === manifestLookup.summaryPageId);
    if (!manifestPage) {
      return undefined;
    }
    if (manifestPage.type !== "source") {
      throw new Error(
        `references[] source_id ${sourceId} manifest summary_page_id ${manifestLookup.summaryPageId} is not a source page.`
      );
    }
    if (!pageReferencesSourceId(manifestPage, sourceId)) {
      throw new Error(
        `references[] source_id ${sourceId} manifest summary_page_id ${manifestLookup.summaryPageId} does not reference source_id ${sourceId}.`
      );
    }
    return manifestPage;
  }
  if (manifestLookup.ingestStatus !== "registered") {
    throw new Error(
      `references[] source_id ${sourceId} manifest ingest_status ${manifestLookup.ingestStatus} cannot use source summary fallback.`
    );
  }

  const candidates = pages.filter(
    (page) =>
      page.type === "source" &&
      pageReferencesSourceId(page, sourceId)
  );
  if (candidates.length > 1) {
    throw new Error(
      `references[] source_id ${sourceId} resolves to multiple source summary pages: ${candidates
        .map((page) => page.pageId)
        .join(", ")}`
    );
  }

  return candidates[0];
}

function readSourceManifestSummaryPageId(
  sourceId: string,
  workspace: WorkspaceLike
): SourceManifestLookup {
  validateSafeId(sourceId, "references[] source_id");
  const manifestPath = resolveKbPath(`state/manifests/${sourceId}.json`, getKbRoot(workspace));
  if (!fs.existsSync(manifestPath)) {
    return { status: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`references[] source_id ${sourceId} has a malformed manifest.`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { source_id?: unknown }).source_id !== "string" ||
    typeof (parsed as { ingest_status?: unknown }).ingest_status !== "string"
  ) {
    throw new Error(
      `references[] source_id ${sourceId} manifest must contain source_id and ingest_status.`
    );
  }

  const manifestSourceId = (parsed as { source_id: string }).source_id;
  if (manifestSourceId !== sourceId) {
    throw new Error(
      `references[] source_id ${sourceId} manifest source_id ${manifestSourceId} does not match ${sourceId}.`
    );
  }

  if (
    typeof (parsed as { ingest_summary_page_id?: unknown }).ingest_summary_page_id === "string" &&
    (parsed as { ingest_summary_page_id: string }).ingest_summary_page_id.length > 0
  ) {
    return {
      status: "present",
      ingestStatus: (parsed as { ingest_status: string }).ingest_status,
      summaryPageId: (parsed as { ingest_summary_page_id: string }).ingest_summary_page_id,
    };
  }

  return {
    status: "present",
    ingestStatus: (parsed as { ingest_status: string }).ingest_status,
    summaryPageId: null,
  };
}

function formatReference(target: string, label?: string): string {
  return label ? `[[${target}|${label}]]` : `[[${target}]]`;
}

function normalizeReferences(values: readonly string[], workspace: WorkspaceLike): string[] {
  if (values.length === 0) {
    return [];
  }

  const pages = listWikiReferencePages(workspace);
  return values.map((value) => {
    const parsed = parseReference(value);
    if (!parsed.target) {
      throw new Error("references[] entries must not be empty.");
    }
    if (parsed.label) {
      assertSafeWikilinkLabel(parsed.label, "references[] label");
    }

    if (isSourceIdLike(parsed.target)) {
      const summaryPage = findSourceSummaryPage(parsed.target, workspace, pages);
      if (summaryPage) {
        return formatReference(summaryPage.pageId, parsed.label ?? parsed.target);
      }
      throw new Error(
        `references[] source_id ${parsed.target} must resolve to an existing source summary page before log entry append.`
      );
    }

    const pageResolution = resolveWikiLinkTarget(parsed.target, pages);
    if (pageResolution.status === "resolved") {
      return formatReference(pageResolution.page.pageId, parsed.label);
    }
    if (pageResolution.status === "ambiguous") {
      throw new Error(
        `references[] target ${parsed.target} resolves to multiple wiki pages: ${pageResolution.pages
          .map((page) => page.pageId)
          .join(", ")}`
      );
    }

    throw new Error(`references[] must resolve to an existing wiki page: ${parsed.target}`);
  });
}

function summaryLabel(kind: WikiLogEntryKind): string {
  if (kind === "query") return "结论";
  if (kind === "lint") return "结果";
  return "摘要";
}

function buildLogEntryBlock(
  input: AppendWikiLogEntryInput,
  date: string,
  dedupMarker: string,
  references: string[]
): string {
  const lines = [`## [${date}] ${input.kind} | ${input.title}`];
  if (input.run_id) {
    lines.push(`- run_id: ${input.run_id}`);
  }

  lines.push(`- ${summaryLabel(input.kind)}: ${input.summary}`);
  for (const change of input.changes ?? []) {
    lines.push(`- 变更: ${change}`);
  }

  if (input.output_page_id) {
    const label = input.output_label ?? input.output_page_id;
    assertSafeWikilinkLabel(input.output_page_id, "output_page_id");
    assertSafeWikilinkLabel(label, input.output_label ? "output_label" : "output_page_id");
    lines.push(`- 产出: [[${input.output_page_id}|${label}]]`);
  }

  if (references.length > 0) {
    lines.push(`- 参考: ${references.join(", ")}`);
  }

  lines.push(dedupMarker);
  return lines.join("\n");
}

function validateAppendLogEntryInput(input: AppendWikiLogEntryInput): void {
  assertSafeLogText(input.kind, "kind");
  if (!["ingest", "query", "lint", "repair"].includes(input.kind)) {
    throw new Error("kind must be ingest, query, lint, or repair.");
  }

  assertSafeLogText(input.title, "title");
  assertSafeLogText(input.summary, "summary");
  validateDedupKey(input.dedup_key);
  if (input.date) assertValidDate(input.date);
  if (input.run_id) assertSafeLogText(input.run_id, "run_id");
  if (input.output_page_id) assertSafeLogText(input.output_page_id, "output_page_id");
  if (input.output_label) assertSafeLogText(input.output_label, "output_label");
  for (const change of input.changes ?? []) assertSafeLogText(change, "changes[]");
  for (const reference of input.references ?? []) assertSafeLogText(reference, "references[]");
}

function insertEntryAtAnchor(
  content: string,
  entryLine: string,
  anchor: string | null,
  relativePath: string
): string {
  if (anchor === null || anchor.trim().length === 0) {
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

export function appendWikiLogEntry(
  input: AppendWikiLogEntryInput,
  workspace: WorkspaceLike
): AppendWikiLogEntryResult {
  validateAppendLogEntryInput(input);

  const targetPath = input.path ?? DEFAULT_LOG_PATH;
  const resolvedPath = resolveWikiScopedPath(targetPath, workspace);
  assertNotSymlinkWriteTarget(targetPath, resolvedPath.absolutePath);
  if (!fs.existsSync(resolvedPath.absolutePath)) {
    throw new Error(`File not found: ${targetPath}`);
  }

  const content = fs.readFileSync(resolvedPath.absolutePath, "utf8");
  const dedupMarker = `<!-- dedup:${input.dedup_key} -->`;
  if (content.includes(dedupMarker)) {
    return { action: "already_exists", path: resolvedPath.relativePath };
  }

  const currentParsed = parseFrontmatter(content);
  if (Object.keys(currentParsed.frontmatter).length > 0) {
    const currentValidation = validateFrontmatter(currentParsed.frontmatter);
    if (!currentValidation.valid) {
      throw new Error(
        `Frontmatter validation failed before log entry append:\n${currentValidation.errors.join("\n")}`
      );
    }
  }

  const date = input.date ?? todayIso();
  const references = normalizeReferences(input.references ?? [], workspace);
  const block = buildLogEntryBlock(input, date, dedupMarker, references);
  const appendedContent = content.trimEnd() + "\n\n" + block + "\n";
  const { frontmatter, body } = parseFrontmatter(appendedContent);
  let newContent = appendedContent;

  if (Object.keys(frontmatter).length > 0) {
    const updatedFrontmatter = { ...frontmatter, updated_at: date };
    const updatedValidation = validateFrontmatter(updatedFrontmatter);
    if (!updatedValidation.valid) {
      throw new Error(
        `Frontmatter validation failed after log entry append:\n${updatedValidation.errors.join("\n")}`
      );
    }
    newContent = serializeFrontmatter(updatedFrontmatter as Record<string, unknown>) + "\n\n" + body.trimStart();
  }

  assertWikiRebuildable(workspace, { path: resolvedPath.relativePath, content: newContent });
  fs.writeFileSync(resolvedPath.absolutePath, newContent, "utf8");
  rebuildPageIndex(workspace);
  return { action: "inserted", path: resolvedPath.relativePath };
}
