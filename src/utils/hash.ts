import * as crypto from "crypto";
import * as fs from "fs";

/**
 * Compute SHA-256 hash of a string and return the full hex digest.
 */
export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Compute SHA-256 hash of arbitrary bytes and return the full hex digest.
 */
export function sha256Buffer(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Generate a source_id from content.
 * Format: src_sha256_<prefix> (default 8 chars, auto-extend to 12 on collision).
 *
 * @param content - The raw source content to hash
 * @param existingIds - Set of existing source_ids to check for collisions
 */
export function generateSourceId(
  content: string,
  existingIds: Set<string> = new Set()
): { source_id: string; content_hash: string } {
  const fullHash = sha256(content);
  const contentHash = `sha256:${fullHash}`;

  // Try 8-char prefix first
  let prefix = fullHash.substring(0, 8);
  let sourceId = `src_sha256_${prefix}`;

  // If collision, extend to 12 chars
  if (existingIds.has(sourceId)) {
    prefix = fullHash.substring(0, 12);
    sourceId = `src_sha256_${prefix}`;
  }

  return { source_id: sourceId, content_hash: contentHash };
}

/**
 * Compute SHA-256 hash of a file and return the full hex digest.
 */
export function sha256File(filePath: string): string {
  return sha256Buffer(fs.readFileSync(filePath));
}
