import { stringify as stringifyYaml, parseDocument } from "yaml";
import type { PageFrontmatter, FrontmatterValidation } from "../types";
import { CORE_PAGE_TYPES, PAGE_ID_PATTERN } from "../types";

const FRONTMATTER_FIELD_ORDER = [
  "id",
  "type",
  "title",
  "updated_at",
  "status",
  "tags",
  "aliases",
  "source_ids",
  "related",
] as const;

const ARRAY_FIELDS = ["tags", "aliases", "source_ids", "related"] as const;
const STATUS_VALUES = ["active", "stub", "deprecated"] as const;

function removeBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function splitFrontmatter(content: string): { yamlBlock: string; body: string } | null {
  const text = removeBom(content);
  const openingMatch = text.match(/^---[ \t]*(?:\r?\n|$)/u);
  if (!openingMatch) {
    return null;
  }

  const yamlStart = openingMatch[0].length;
  const closingPattern = /\r?\n---[ \t]*(?=\r?\n|$)/gu;
  closingPattern.lastIndex = yamlStart;
  const closingMatch = closingPattern.exec(text);
  if (!closingMatch) {
    return null;
  }

  const yamlBlock = text.slice(yamlStart, closingMatch.index);
  let bodyStart = closingMatch.index + closingMatch[0].length;
  if (text.startsWith("\r\n", bodyStart)) {
    bodyStart += 2;
  } else if (text.startsWith("\n", bodyStart)) {
    bodyStart += 1;
  }

  return {
    yamlBlock,
    body: text.slice(bodyStart).trimStart(),
  };
}

function normalizeYamlError(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

/**
 * Parse a markdown file's YAML frontmatter and body content.
 *
 * Delimiters are matched only as standalone `---` lines at the beginning of
 * the file and at the end of the YAML block. YAML itself is parsed with the
 * `yaml` package rather than a custom subset parser.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Partial<PageFrontmatter>;
  body: string;
} {
  const parts = splitFrontmatter(content);
  if (!parts) {
    return { frontmatter: {}, body: content };
  }

  const document = parseDocument(parts.yamlBlock, {
    prettyErrors: false,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    const details = document.errors.map((error) => normalizeYamlError(error.message)).join("; ");
    throw new Error(`Invalid YAML frontmatter: ${details}`);
  }

  if (document.warnings.length > 0) {
    const details = document.warnings
      .map((warning) => normalizeYamlError(warning.message))
      .join("; ");
    throw new Error(`Invalid YAML frontmatter: ${details}`);
  }

  const parsed = document.toJS({ mapAsMap: false }) as unknown;
  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body: parts.body };
  }

  if (!isPlainRecord(parsed)) {
    throw new Error("Invalid YAML frontmatter: root value must be a mapping/object.");
  }

  return { frontmatter: parsed as Partial<PageFrontmatter>, body: parts.body };
}

function orderFrontmatterFields(fm: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const consumed = new Set<string>();

  for (const key of FRONTMATTER_FIELD_ORDER) {
    const value = fm[key];
    if (value !== undefined && value !== null) {
      result[key] = value;
      consumed.add(key);
    }
  }

  for (const key of Object.keys(fm).sort((left, right) => left.localeCompare(right))) {
    if (consumed.has(key)) {
      continue;
    }

    const value = fm[key];
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Serialize frontmatter fields back to YAML string (between --- delimiters).
 */
export function serializeFrontmatter(fm: Record<string, unknown>): string {
  const ordered = orderFrontmatterFields(fm);
  const yaml = stringifyYaml(ordered, {
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();

  return ["---", yaml, "---"].join("\n");
}

function requireNonEmptyString(
  fm: Partial<PageFrontmatter>,
  key: keyof PageFrontmatter,
  errors: string[]
): string | undefined {
  const value = fm[key];
  if (value === undefined || value === null || value === "") {
    errors.push(`Missing required field: ${key}`);
    return undefined;
  }

  if (typeof value !== "string") {
    errors.push(`Invalid field type: ${key} must be a string`);
    return undefined;
  }

  if (value.trim().length === 0) {
    errors.push(`Missing required field: ${key}`);
    return undefined;
  }

  return value;
}

function isValidIsoDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateStringArrayField(
  fm: Partial<PageFrontmatter>,
  key: (typeof ARRAY_FIELDS)[number],
  errors: string[]
): void {
  const value = fm[key];
  if (value === undefined || value === null) {
    return;
  }

  if (!Array.isArray(value)) {
    errors.push(`Invalid field type: ${key} must be an array of strings`);
    return;
  }

  const invalidIndex = value.findIndex((item) => typeof item !== "string");
  if (invalidIndex !== -1) {
    errors.push(`Invalid field type: ${key}[${invalidIndex}] must be a string`);
  }
}

/**
 * Validate frontmatter against the wiki page schema.
 * Returns errors (blocking) and warnings (non-blocking).
 */
export function validateFrontmatter(
  fm: Partial<PageFrontmatter>
): FrontmatterValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const id = requireNonEmptyString(fm, "id", errors);
  const type = requireNonEmptyString(fm, "type", errors);
  requireNonEmptyString(fm, "title", errors);
  const updatedAt = requireNonEmptyString(fm, "updated_at", errors);
  const status = requireNonEmptyString(fm, "status", errors);

  if (id && !PAGE_ID_PATTERN.test(id)) {
    errors.push(
      `Invalid id format: "${id}" — must match [a-z0-9_-]+`
    );
  }

  if (updatedAt && !isValidIsoDateOnly(updatedAt)) {
    errors.push(
      `Invalid updated_at: "${updatedAt}" — must use YYYY-MM-DD format`
    );
  }

  if (status && !(STATUS_VALUES as readonly string[]).includes(status)) {
    errors.push(
      `Invalid status: "${status}" — must be active, stub, or deprecated`
    );
  }

  if (type && !(CORE_PAGE_TYPES as readonly string[]).includes(type)) {
    warnings.push(
      `Unknown page type: "${type}" — not in core types (${CORE_PAGE_TYPES.join(", ")})`
    );
  }

  for (const key of ARRAY_FIELDS) {
    validateStringArrayField(fm, key, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    parsed: fm,
  };
}

/**
 * Extract headings (## level) from markdown body.
 */
export function extractHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match) {
      headings.push(match[1].trim());
    }
  }
  return headings;
}

/**
 * Extract a body excerpt (first N characters, stripped of markdown formatting).
 */
export function extractExcerpt(body: string, maxLength: number = 200): string {
  const plain = body
    .replace(/^#{1,6}\s+.+$/gm, "") // remove headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/[*_`~]/g, "") // inline formatting
    .replace(/\n{2,}/g, "\n") // collapse blank lines
    .trim();
  return plain.length > maxLength ? plain.substring(0, maxLength) + "..." : plain;
}
