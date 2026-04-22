import type { PageFrontmatter, FrontmatterValidation } from "../types";
import { CORE_PAGE_TYPES, PAGE_ID_PATTERN } from "../types";

/**
 * Parse a markdown file's frontmatter (YAML between --- delimiters)
 * and body content. This is a lightweight parser that handles the
 * subset of YAML used in wiki page frontmatter.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Partial<PageFrontmatter>;
  body: string;
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.substring(3, endIndex).trim();
  const body = trimmed.substring(endIndex + 3).trimStart();
  const frontmatter = parseSimpleYaml(yamlBlock);

  return { frontmatter: frontmatter as Partial<PageFrontmatter>, body };
}

/**
 * Minimal YAML parser for frontmatter fields.
 * Supports: strings, arrays (inline [...] and multiline - item), booleans, numbers.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  const stripOptionalQuotes = (value: string): string => {
    if (value.length < 2) return value;
    const quote = value[0];
    if ((quote === `"` || quote === "'") && value[value.length - 1] === quote) {
      return value.slice(1, -1);
    }
    return value;
  };

  for (const line of lines) {
    // Multiline array item
    const arrayItemMatch = line.match(/^\s+-\s+(.+)$/);
    if (arrayItemMatch && currentKey && currentArray) {
      currentArray.push(stripOptionalQuotes(arrayItemMatch[1].trim()));
      continue;
    }

    // Flush pending array
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key: value pair
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    // Inline array: [item1, item2]
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1).trim();
      if (inner === "") {
        result[key] = [];
      } else {
        result[key] = inner.split(",").map((s) => stripOptionalQuotes(s.trim()));
      }
      continue;
    }

    // Empty value — might be start of multiline array
    if (rawValue === "") {
      currentKey = key;
      currentArray = [];
      continue;
    }

    // Boolean
    if (rawValue === "true") { result[key] = true; continue; }
    if (rawValue === "false") { result[key] = false; continue; }

    // Number
    if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      result[key] = Number(rawValue);
      continue;
    }

    // String (strip optional quotes)
    result[key] = stripOptionalQuotes(rawValue);
  }

  // Flush final pending array
  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

/**
 * Serialize frontmatter fields back to YAML string (between --- delimiters).
 */
export function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
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

  // Required fields
  if (!fm.id) errors.push("Missing required field: id");
  if (!fm.type) errors.push("Missing required field: type");
  if (!fm.title) errors.push("Missing required field: title");
  if (!fm.updated_at) errors.push("Missing required field: updated_at");
  if (!fm.status) errors.push("Missing required field: status");

  // ID format
  if (fm.id && !PAGE_ID_PATTERN.test(fm.id)) {
    errors.push(
      `Invalid id format: "${fm.id}" — must match [a-z0-9_-]+`
    );
  }

  // Status enum
  if (fm.status && !["active", "stub", "deprecated"].includes(fm.status)) {
    errors.push(
      `Invalid status: "${fm.status}" — must be active, stub, or deprecated`
    );
  }

  // Type: core types are validated, custom types get a warning
  if (fm.type && !(CORE_PAGE_TYPES as readonly string[]).includes(fm.type)) {
    warnings.push(
      `Unknown page type: "${fm.type}" — not in core types (${CORE_PAGE_TYPES.join(", ")})`
    );
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
