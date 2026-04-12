import * as fs from "fs";
import * as path from "path";
import type { Manifest, SourceKind, ToolResult, WorkspaceConfig } from "../types";
import { resolveKbPath, validateSafeId } from "../utils/path_validator";

export interface KbReadSourceInput {
  source_id: string;
}

export interface KbReadSourceOutput {
  source_id: string;
  source_kind: SourceKind;
  file_name: string;
  content: string;
}

const MAX_CONTENT_BYTES = 200 * 1024; // 200KB

/**
 * kb_read_source — Read raw source content by source_id.
 * Large file truncation at 200KB.
 */
export async function kbReadSource(
  input: KbReadSourceInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbReadSourceOutput>> {
  try {
    // Validate source_id before using in paths
    validateSafeId(input.source_id, "source_id");

    // Load manifest from kb/state/manifests/{source_id}.json
    const manifestPath = resolveKbPath(
      `state/manifests/${input.source_id}.json`,
      config.kb_root
    );

    if (!fs.existsSync(manifestPath)) {
      return {
        success: false,
        error: `Manifest not found for source_id: ${input.source_id}`,
      };
    }

    let manifest: Manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
    } catch {
      return {
        success: false,
        error: `Malformed manifest for source_id: ${input.source_id}`,
      };
    }

    // Read the raw source file from canonical_path in the manifest
    const sourcePath = resolveKbPath(manifest.canonical_path, config.kb_root);

    if (!fs.existsSync(sourcePath)) {
      return {
        success: false,
        error: `Source file not found at canonical path: ${manifest.canonical_path}`,
      };
    }

    const rawBuffer = fs.readFileSync(sourcePath);
    let content: string;
    let truncated = false;

    if (rawBuffer.byteLength > MAX_CONTENT_BYTES) {
      // Truncate to MAX_CONTENT_BYTES (byte-safe via Buffer slice)
      content = rawBuffer.slice(0, MAX_CONTENT_BYTES).toString("utf8");
      truncated = true;
    } else {
      content = rawBuffer.toString("utf8");
    }

    if (truncated) {
      content +=
        "\n\n[WARNING: Content truncated. File exceeds 200KB limit. " +
        `Original size: ${rawBuffer.byteLength} bytes.]`;
    }

    return {
      success: true,
      data: {
        source_id: manifest.source_id,
        source_kind: manifest.source_kind,
        file_name: manifest.file_name,
        content,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
