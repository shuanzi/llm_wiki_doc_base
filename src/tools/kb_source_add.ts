import * as fs from "fs";
import * as path from "path";
import type { Manifest, SourceKind, ToolResult, WorkspaceConfig } from "../types";
import { generateSourceId, sha256 } from "../utils/hash";
import { resolveKbPath } from "../utils/path_validator";

export interface KbSourceAddInput {
  file_path: string; // path to the .md or .txt file to ingest
}

export interface KbSourceAddOutput {
  source_id: string;
  content_hash: string;
  canonical_path: string;
  manifest: Manifest;
}

const ALLOWED_EXTENSIONS = new Set([".md", ".txt"]);

/**
 * kb_source_add — Register a source file and write it to kb/raw/.
 *
 * MVP: only accepts .md and .txt files.
 * Generates a stable source_id from content hash (src_sha256_<prefix>).
 * Creates manifest in kb/state/manifests/.
 * Deduplicates by content hash + canonical locator.
 */
export async function kbSourceAdd(
  input: KbSourceAddInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbSourceAddOutput>> {
  try {
    // Validate extension
    const ext = path.extname(input.file_path).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return {
        success: false,
        error: `Unsupported file type "${ext}". MVP only supports: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      };
    }

    // Resolve and read the source file
    const absolutePath = path.resolve(input.file_path);
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `Source file not found: ${absolutePath}` };
    }
    const content = fs.readFileSync(absolutePath, "utf8");

    // Collect existing source_ids for collision detection
    const manifestsDir = resolveKbPath("state/manifests", config.kb_root);
    if (!fs.existsSync(manifestsDir)) {
      fs.mkdirSync(manifestsDir, { recursive: true });
    }
    const existingIds = new Set<string>();
    for (const f of fs.readdirSync(manifestsDir)) {
      if (f.endsWith(".json")) {
        try {
          const m: Manifest = JSON.parse(
            fs.readFileSync(path.join(manifestsDir, f), "utf8")
          );
          existingIds.add(m.source_id);
          // Deduplicate by content hash
          if (m.content_hash === `sha256:${sha256(content)}`) {
            return {
              success: false,
              error: `Duplicate content: source already registered as ${m.source_id} (${m.source_locator})`,
            };
          }
        } catch {
          // skip malformed manifests
        }
      }
    }

    // Generate source_id
    const { source_id, content_hash } = generateSourceId(content, existingIds);

    // Determine source kind
    const sourceKind: SourceKind = ext === ".md" ? "markdown" : "plaintext";

    // Copy file to kb/raw/inbox/<source_id><ext>
    const inboxDir = resolveKbPath("raw/inbox", config.kb_root);
    if (!fs.existsSync(inboxDir)) {
      fs.mkdirSync(inboxDir, { recursive: true });
    }
    const canonicalPath = `raw/inbox/${source_id}${ext}`;
    const destPath = resolveKbPath(canonicalPath, config.kb_root);
    fs.copyFileSync(absolutePath, destPath);

    // Create manifest
    const manifest: Manifest = {
      source_id,
      source_locator: absolutePath,
      source_kind: sourceKind,
      content_hash,
      canonical_path: canonicalPath,
      ingest_status: "registered",
      created_at: new Date().toISOString(),
    };

    const manifestPath = path.join(manifestsDir, `${source_id}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return {
      success: true,
      data: { source_id, content_hash, canonical_path: canonicalPath, manifest },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
