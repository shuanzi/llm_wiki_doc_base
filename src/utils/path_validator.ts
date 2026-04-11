import * as path from "path";

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
