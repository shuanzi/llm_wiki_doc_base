import * as fs from "fs";
import * as path from "path";
import type {
  Plan,
  Draft,
  DraftFile,
  DraftFileCreate,
  DraftFileEnsureEntry,
  Manifest,
  ToolResult,
  WorkspaceConfig,
  PageFrontmatter,
} from "../types";
import { resolveKbPath } from "../utils/path_validator";
import { parseFrontmatter, serializeFrontmatter, extractExcerpt, extractHeadings } from "../utils/frontmatter";

export interface KbDraftPatchInput {
  plan: Plan;
}

/**
 * kb_draft_patch — Render a plan into a complete, replayable file changeset.
 *
 * This is the audit chain's last human-reviewable stable artifact.
 * The draft IS the final executable changeset — kb_apply_patch generates
 * no content of its own.
 *
 * Uses ensure_entry (not append) for index.md / log.md to guarantee
 * retry safety (idempotent by dedup_key).
 *
 * Archives draft to kb/state/drafts/<plan_id>.json.
 */
export async function kbDraftPatch(
  input: KbDraftPatchInput,
  config: WorkspaceConfig
): Promise<ToolResult<Draft>> {
  try {
    const { plan } = input;

    // Load manifest for source metadata
    const manifestPath = resolveKbPath(
      `state/manifests/${plan.source_id}.json`,
      config.kb_root
    );
    if (!fs.existsSync(manifestPath)) {
      return {
        success: false,
        error: `Manifest not found for source_id: ${plan.source_id}`,
      };
    }
    const manifest: Manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8")
    );

    // Load raw content for summary generation
    const rawPath = resolveKbPath(manifest.canonical_path, config.kb_root);
    if (!fs.existsSync(rawPath)) {
      return {
        success: false,
        error: `Raw source file not found: ${manifest.canonical_path}`,
      };
    }
    const rawContent = fs.readFileSync(rawPath, "utf8");
    const { frontmatter: rawFm, body: rawBody } = parseFrontmatter(rawContent);

    const files: DraftFile[] = [];
    const now = new Date().toISOString().split("T")[0];

    // --- Generate file creates ---
    for (const entry of plan.create) {
      if (entry.kind === "source_summary") {
        // Build source summary page content
        const title = (rawFm.title as string) || `Source: ${plan.source_id}`;
        const headings = extractHeadings(rawBody);
        const excerpt = extractExcerpt(rawBody, 500);

        const pageFm: PageFrontmatter = {
          id: entry.page_id,
          type: "source",
          title,
          source_ids: [plan.source_id],
          updated_at: now,
          status: "active",
          tags: [],
        };

        const body = [
          "",
          `# ${title}`,
          "",
          "## Source Info",
          "",
          `- **Source ID**: ${plan.source_id}`,
          `- **Kind**: ${manifest.source_kind}`,
          `- **Content Hash**: ${manifest.content_hash}`,
          `- **Ingested**: ${now}`,
          "",
          "## Summary",
          "",
          excerpt,
          "",
        ];

        if (headings.length > 0) {
          body.push("## Structure", "");
          for (const h of headings) {
            body.push(`- ${h}`);
          }
          body.push("");
        }

        const fileContent =
          serializeFrontmatter(pageFm as unknown as Record<string, unknown>) +
          "\n" +
          body.join("\n");

        const createFile: DraftFileCreate = {
          action: "create",
          path: entry.path,
          content: fileContent,
        };
        files.push(createFile);
      }
    }

    // --- Generate index.md ensure_entry ---
    for (const entry of plan.update) {
      if (entry.path === "wiki/index.md") {
        // Add a link under the "## Sources" section
        const sourceLink = plan.create[0];
        if (sourceLink) {
          const rawTitle =
            (rawFm.title as string) || `Source: ${plan.source_id}`;
          const ensureEntry: DraftFileEnsureEntry = {
            action: "ensure_entry",
            path: "wiki/index.md",
            entry: `- [${rawTitle}](sources/${plan.source_id}.md)`,
            anchor: "## Sources",
            dedup_key: `index_source_${plan.source_id}`,
          };
          files.push(ensureEntry);
        }
      } else if (entry.path === "wiki/log.md") {
        // Add log entry under "# Change Log"
        const logEntry: DraftFileEnsureEntry = {
          action: "ensure_entry",
          path: "wiki/log.md",
          entry: `- ${now}: Ingested source \`${plan.source_id}\` → [wiki/sources/${plan.source_id}.md](sources/${plan.source_id}.md)`,
          anchor: "# Change Log",
          dedup_key: `log_ingest_${plan.source_id}`,
        };
        files.push(logEntry);
      }
    }

    const draft: Draft = {
      plan_id: plan.plan_id,
      status: "drafted",
      files,
    };

    // Archive draft
    const draftsDir = resolveKbPath("state/drafts", config.kb_root);
    if (!fs.existsSync(draftsDir)) {
      fs.mkdirSync(draftsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(draftsDir, `${plan.plan_id}.json`),
      JSON.stringify(draft, null, 2),
      "utf8"
    );

    return { success: true, data: draft };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
