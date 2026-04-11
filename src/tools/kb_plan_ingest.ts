import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { Manifest, Plan, PlanCreateEntry, PlanUpdateEntry, ToolResult, WorkspaceConfig } from "../types";
import { resolveKbPath } from "../utils/path_validator";

export interface KbPlanIngestInput {
  source_id: string;
}

/**
 * kb_plan_ingest — Generate a structural patch plan from a registered source.
 *
 * Reads the source manifest + raw content + current wiki state,
 * then outputs a Plan JSON describing which files to create/update.
 * MVP: only creates source summary page + updates index.md / log.md.
 * Does NOT generate actual content — that is kb_draft_patch's job.
 */
export async function kbPlanIngest(
  input: KbPlanIngestInput,
  config: WorkspaceConfig
): Promise<ToolResult<Plan>> {
  try {
    // Load manifest
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
    const manifest: Manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8")
    );

    // Verify raw file exists
    const rawPath = resolveKbPath(manifest.canonical_path, config.kb_root);
    if (!fs.existsSync(rawPath)) {
      return {
        success: false,
        error: `Raw source file not found at: ${manifest.canonical_path}`,
      };
    }

    // Derive a page_id from source_id
    const pageId = `src_${input.source_id}`;

    // Determine the wiki path for the source summary page
    const sourcePage = `wiki/sources/${input.source_id}.md`;

    // Check if page already exists (conflict detection)
    const sourcePageAbsolute = resolveKbPath(sourcePage, config.kb_root);
    const conflicts: string[] = [];
    if (fs.existsSync(sourcePageAbsolute)) {
      conflicts.push(`${sourcePage} already exists`);
    }

    // Build plan entries
    const create: PlanCreateEntry[] = [
      {
        page_id: pageId,
        path: sourcePage,
        kind: "source_summary",
      },
    ];

    const update: PlanUpdateEntry[] = [
      {
        path: "wiki/index.md",
        reason: `Add link to new source page: ${input.source_id}`,
      },
      {
        path: "wiki/log.md",
        reason: `Log ingestion of source: ${input.source_id}`,
      },
    ];

    // Generate plan_id
    const planId = `plan_${crypto.randomBytes(8).toString("hex")}`;

    const plan: Plan = {
      plan_id: planId,
      source_id: input.source_id,
      status: "planned",
      create,
      update,
      moves: [],
      delete: [],
      conflicts,
      risk_level: conflicts.length > 0 ? "medium" : "low",
      notes: `MVP ingest: create source summary page for ${input.source_id}, update index and log.`,
    };

    // Archive plan to kb/state/plans/
    const plansDir = resolveKbPath("state/plans", config.kb_root);
    if (!fs.existsSync(plansDir)) {
      fs.mkdirSync(plansDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(plansDir, `${planId}.json`),
      JSON.stringify(plan, null, 2),
      "utf8"
    );

    return { success: true, data: plan };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
