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

function normalizeReference(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("[[") && trimmed.endsWith("]]") ? trimmed : `[[${trimmed}]]`;
}

function summaryLabel(kind: WikiLogEntryKind): string {
  if (kind === "query") return "结论";
  if (kind === "lint") return "结果";
  return "摘要";
}

function buildLogEntryBlock(input: AppendWikiLogEntryInput, date: string, dedupMarker: string): string {
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
    lines.push(`- 产出: [[${input.output_page_id}|${label}]]`);
  }

  if (input.references && input.references.length > 0) {
    lines.push(`- 参考: ${input.references.map(normalizeReference).join(", ")}`);
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
  const block = buildLogEntryBlock(input, date, dedupMarker);
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
