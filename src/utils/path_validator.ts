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
