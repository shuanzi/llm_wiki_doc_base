import * as fs from "fs";
import * as path from "path";

/**
 * Validates that an identifier (plan_id, source_id, etc.) is safe for
 * use in file paths. Rejects path separators, dots-only segments, and
 * null bytes.
 */
export function validateSafeId(id: string, label: string = "id"): void {
  if (!id || /[\/\\]/.test(id) || /\0/.test(id) || id === "." || id === "..") {
    throw new Error(`Unsafe ${label}: "${id}" contains path separators or is invalid`);
  }
}

/**
 * Validates that a write-target path resolves within the allowed kb scope.
 * All write destinations and wiki-relative path arguments must resolve
 * under `<workspace>/kb/`. External source locators (URLs, external file
 * paths) are allowed as read-only inputs but never as write destinations.
 */
export function validateWritePath(
  targetPath: string,
  kbRoot: string
): { valid: boolean; resolved: string; error?: string } {
  const resolved = path.resolve(kbRoot, targetPath);
  const normalizedKbRoot = path.resolve(kbRoot);

  if (!resolved.startsWith(normalizedKbRoot + path.sep) && resolved !== normalizedKbRoot) {
    return {
      valid: false,
      resolved,
      error: `Path "${targetPath}" resolves to "${resolved}" which is outside kb root "${normalizedKbRoot}"`,
    };
  }

  // If the path (or its nearest existing ancestor) exists, verify via
  // realpath to catch symlink-based escapes.
  let checkPath = resolved;
  while (checkPath !== normalizedKbRoot && !fs.existsSync(checkPath)) {
    checkPath = path.dirname(checkPath);
  }
  if (fs.existsSync(checkPath)) {
    const realCheck = fs.realpathSync(checkPath);
    const realKbRoot = fs.realpathSync(normalizedKbRoot);
    if (!realCheck.startsWith(realKbRoot + path.sep) && realCheck !== realKbRoot) {
      return {
        valid: false,
        resolved,
        error: `Path "${targetPath}" resolves through symlink to "${realCheck}" which is outside kb root`,
      };
    }
  }

  return { valid: true, resolved };
}

/**
 * Resolves a relative path against the kb root and ensures it stays within bounds.
 * Returns the absolute path or throws.
 */
export function resolveKbPath(relativePath: string, kbRoot: string): string {
  const result = validateWritePath(relativePath, kbRoot);
  if (!result.valid) {
    throw new Error(result.error);
  }
  return result.resolved;
}

export function hasExplicitWikiPathSignal(target: string): boolean {
  const trimmedTarget = target.trim();
  return (
    trimmedTarget.includes("/") ||
    trimmedTarget.includes("\\") ||
    trimmedTarget.toLowerCase().endsWith(".md")
  );
}

export function normalizeWikiPathLikeTarget(target: string): string | null {
  if (!hasExplicitWikiPathSignal(target)) {
    return null;
  }

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

export interface WikiLinkTargetCandidate {
  pageId: string;
  path: string;
  title: string;
  aliases: readonly string[];
}

export type WikiLinkTargetResolution<T extends WikiLinkTargetCandidate> =
  | {
      status: "resolved";
      page: T;
      match: "page_id" | "path" | "title_or_alias";
    }
  | {
      status: "ambiguous";
      pages: T[];
    }
  | {
      status: "unresolved";
    };

export function resolveWikiLinkTarget<T extends WikiLinkTargetCandidate>(
  target: string,
  pages: readonly T[]
): WikiLinkTargetResolution<T> {
  const needle = target.toLowerCase();
  const idMatch = pages.find((page) => page.pageId.toLowerCase() === needle);
  if (idMatch) {
    return { status: "resolved", page: idMatch, match: "page_id" };
  }

  const normalizedPathTarget = normalizeWikiPathLikeTarget(target);
  const pathMatch = pages.find(
    (page) =>
      normalizedPathTarget !== null &&
      normalizeWikiPathLikeTarget(page.path) === normalizedPathTarget
  );
  if (pathMatch) {
    return { status: "resolved", page: pathMatch, match: "path" };
  }

  const titleOrAliasMatches = pages.filter(
    (page) =>
      page.title.toLowerCase() === needle ||
      page.aliases.some((alias) => alias.toLowerCase() === needle)
  );
  if (titleOrAliasMatches.length > 1) {
    return { status: "ambiguous", pages: titleOrAliasMatches };
  }
  if (titleOrAliasMatches.length === 1) {
    return {
      status: "resolved",
      page: titleOrAliasMatches[0],
      match: "title_or_alias",
    };
  }

  return { status: "unresolved" };
}
