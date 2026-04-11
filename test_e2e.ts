/**
 * End-to-end test: ingest real documents through the full pipeline.
 *
 * Usage: npx ts-node test_e2e.ts
 */
import * as fs from "fs";
import * as path from "path";
import { kbSourceAdd } from "./src/tools/kb_source_add";
import { kbPlanIngest } from "./src/tools/kb_plan_ingest";
import { kbDraftPatch } from "./src/tools/kb_draft_patch";
import { kbApplyPatch } from "./src/tools/kb_apply_patch";
import { kbSearchWiki } from "./src/tools/kb_search_wiki";
import { kbReadPage } from "./src/tools/kb_read_page";
import { kbCommit } from "./src/tools/kb_commit";
import type { Plan } from "./src/types";

const KB_ROOT = path.resolve(__dirname, "kb");
const config = { kb_root: KB_ROOT };
const TEST_DIR = "/Users/xiquandai/Downloads/test";

async function main() {
  const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  console.log(`\n=== Found ${files.length} files to ingest ===\n`);

  const sourceIds: string[] = [];
  let failCount = 0;

  // --- Phase 1: source_add ---
  console.log("--- Phase 1: kb_source_add ---");
  for (const file of files) {
    const filePath = path.join(TEST_DIR, file);
    const result = await kbSourceAdd({ file_path: filePath }, config);
    if (result.success && result.data) {
      console.log(`  ✓ ${file} → ${result.data.source_id}`);
      sourceIds.push(result.data.source_id);
    } else {
      console.log(`  ✗ ${file}: ${result.error}`);
      failCount++;
    }
  }
  console.log(`\n  Registered: ${sourceIds.length}, Failed: ${failCount}\n`);

  // --- Phase 2: plan_ingest + draft_patch + apply_patch for each ---
  console.log("--- Phase 2: plan → draft → apply ---");
  let appliedCount = 0;

  for (const sid of sourceIds) {
    // Plan
    const planResult = await kbPlanIngest({ source_id: sid }, config);
    if (!planResult.success || !planResult.data) {
      console.log(`  ✗ plan ${sid}: ${planResult.error}`);
      continue;
    }
    const plan: Plan = planResult.data;
    console.log(`  ✓ plan ${sid} → ${plan.plan_id} (risk: ${plan.risk_level})`);

    // Draft
    const draftResult = await kbDraftPatch({ plan }, config);
    if (!draftResult.success || !draftResult.data) {
      console.log(`  ✗ draft ${sid}: ${draftResult.error}`);
      continue;
    }
    console.log(`  ✓ draft ${sid} → ${draftResult.data.files.length} file ops`);

    // Apply
    const applyResult = await kbApplyPatch({ draft: draftResult.data }, config);
    if (!applyResult.success || !applyResult.data) {
      console.log(`  ✗ apply ${sid}: ${applyResult.error}`);
      continue;
    }
    console.log(`  ✓ apply ${sid} → ${applyResult.data.applied_files.length} files, index_updated: ${applyResult.data.index_updated}`);
    appliedCount++;

    // Commit after each apply (so next apply sees clean state)
    const commitResult = await kbCommit(
      { message: `kb: ingest ${sid}` },
      config
    );
    if (commitResult.success && commitResult.data) {
      console.log(`  ✓ commit ${commitResult.data.commit_hash.substring(0, 7)}`);
    } else {
      console.log(`  ✗ commit: ${commitResult.error}`);
    }
  }
  console.log(`\n  Applied: ${appliedCount}/${sourceIds.length}\n`);

  // --- Phase 3: search ---
  console.log("--- Phase 3: kb_search_wiki ---");
  const queries = ["RISC-V", "Linux", "LLM", "安全", "Docker"];
  for (const q of queries) {
    const searchResult = await kbSearchWiki({ query: q, limit: 5 }, config);
    if (searchResult.success && searchResult.data) {
      console.log(`  "${q}" → ${searchResult.data.length} results`);
      for (const r of searchResult.data.slice(0, 3)) {
        console.log(`    - [${r.score}] ${r.title} (${r.type})`);
      }
    } else {
      console.log(`  "${q}" → error: ${searchResult.error}`);
    }
  }

  // --- Phase 4: read a page ---
  console.log("\n--- Phase 4: kb_read_page ---");
  if (sourceIds.length > 0) {
    const pageId = sourceIds[0];
    const readResult = await kbReadPage({ path_or_id: pageId }, config);
    if (readResult.success && readResult.data) {
      console.log(`  ✓ Read page_id="${pageId}"`);
      console.log(`    path: ${readResult.data.path}`);
      console.log(`    title: ${readResult.data.frontmatter.title}`);
      console.log(`    body preview: ${readResult.data.body.substring(0, 150)}...`);
    } else {
      console.log(`  ✗ ${readResult.error}`);
    }
  }

  // --- Phase 5: dedup test ---
  console.log("\n--- Phase 5: dedup test ---");
  if (files.length > 0) {
    const dupResult = await kbSourceAdd(
      { file_path: path.join(TEST_DIR, files[0]) },
      config
    );
    if (!dupResult.success) {
      console.log(`  ✓ Dedup correctly rejected: ${dupResult.error}`);
    } else {
      console.log(`  ✗ Dedup failed — should have been rejected!`);
    }
  }

  // --- Summary ---
  const indexPath = path.join(KB_ROOT, "state/cache/page-index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  console.log(`\n=== Summary ===`);
  console.log(`  Total pages in index: ${index.pages.length}`);
  console.log(`  Sources ingested: ${appliedCount}`);
  console.log(`  Manifests: ${fs.readdirSync(path.join(KB_ROOT, "state/manifests")).length}`);
  console.log(`  Applied drafts: ${fs.readdirSync(path.join(KB_ROOT, "state/applied")).length}`);
}

main().catch(console.error);
