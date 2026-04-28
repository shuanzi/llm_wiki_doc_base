/**
 * e2e_v2_ingest.ts — General-purpose E2E driver for the V2 kb_ingest skill
 *
 * Exercises all 8 V2 tools on any arbitrary source document, then validates
 * that a second run (same source) is idempotent.
 *
 * Usage:
 *   npx tsx scripts/e2e_v2_ingest.ts <source-path> [--commit] [--kb-root <path>]
 *
 * Examples:
 *   npx tsx scripts/e2e_v2_ingest.ts "/path/to/某文档.md"
 *   npx tsx scripts/e2e_v2_ingest.ts "/path/to/doc.md" --commit
 *   npx tsx scripts/e2e_v2_ingest.ts "/path/to/doc.md" --kb-root ./kb
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import type { WorkspaceConfig } from "../src/types";
import { kbSourceAdd } from "../src/tools/kb_source_add";
import { kbReadSource } from "../src/tools/kb_read_source";
import { kbSearchWiki } from "../src/tools/kb_search_wiki";
import { kbReadPage } from "../src/tools/kb_read_page";
import { kbWritePage } from "../src/tools/kb_write_page";
import { kbUpdateSection } from "../src/tools/kb_update_section";
import { kbEnsureEntry } from "../src/tools/kb_ensure_entry";
import { kbCommit } from "../src/tools/kb_commit";
import { serializeFrontmatter } from "../src/utils";

// ── CLI parsing ───────────────────────────────────────────────────────────────

function parseArgs(): { sourcePath: string; doCommit: boolean; explicitKbRoot: string | null } {
  const args = process.argv.slice(2);

  let sourcePath = "";
  let doCommit = false;
  let explicitKbRoot: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--commit") {
      doCommit = true;
      continue;
    }

    if (arg === "--kb-root") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        console.error('[FATAL] "--kb-root" requires a path value.');
        process.exit(1);
      }
      explicitKbRoot = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      console.error(`[FATAL] Unknown flag: ${arg}`);
      process.exit(1);
    }

    if (!sourcePath) {
      sourcePath = arg;
      continue;
    }

    console.error(`[FATAL] Unexpected extra positional argument: ${arg}`);
    process.exit(1);
  }

  if (!sourcePath) {
    console.error("Usage: npx tsx scripts/e2e_v2_ingest.ts <source-path> [--commit] [--kb-root <path>]");
    console.error("Default behavior: run against a throwaway temp copy of ./kb (safe, non-destructive).");
    console.error("Use --kb-root to intentionally target a specific kb root.");
    process.exit(1);
  }

  return { sourcePath, doCommit, explicitKbRoot };
}

interface ResolvedKbRoot {
  kbRoot: string;
  mode: "throwaway" | "explicit";
  tempWorkspaceRoot: string | null;
}

function ensureCommitTargetSupported(kbRoot: string): void {
  if (path.basename(kbRoot) !== "kb") {
    console.error(`[FATAL] --commit requires --kb-root to be a directory named "kb". Received: ${kbRoot}`);
    process.exit(1);
  }

  const repoRoot = path.dirname(kbRoot);
  const expectedKbPath = path.resolve(repoRoot, "kb");
  if (path.resolve(kbRoot) !== expectedKbPath) {
    console.error(`[FATAL] --commit requires --kb-root to equal "<git-repo>/kb". Received: ${kbRoot}`);
    process.exit(1);
  }

  try {
    const isGitRepo = execSync("git rev-parse --is-inside-work-tree", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (isGitRepo !== "true") {
      console.error(`[FATAL] --commit requires parent directory to be a git work tree: ${repoRoot}`);
      process.exit(1);
    }

    const gitTopLevel = execSync("git rev-parse --show-toplevel", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (path.resolve(gitTopLevel) !== path.resolve(repoRoot)) {
      console.error(
        `[FATAL] --commit requires --kb-root to be "<git-top-level>/kb". ` +
        `Resolved parent "${repoRoot}" is inside repo "${gitTopLevel}", not its top-level.`
      );
      process.exit(1);
    }
  } catch {
    console.error(`[FATAL] --commit requires parent directory to be a git work tree: ${repoRoot}`);
    process.exit(1);
  }
}

function resolveKbRoot(explicitKbRoot: string | null, doCommit: boolean): ResolvedKbRoot {
  if (explicitKbRoot) {
    if (!fs.existsSync(explicitKbRoot) || !fs.statSync(explicitKbRoot).isDirectory()) {
      console.error(`[FATAL] --kb-root must point to an existing kb directory: ${explicitKbRoot}`);
      process.exit(1);
    }
    if (doCommit) {
      ensureCommitTargetSupported(explicitKbRoot);
    }
    return {
      kbRoot: explicitKbRoot,
      mode: "explicit",
      tempWorkspaceRoot: null,
    };
  }

  if (doCommit) {
    console.error("[FATAL] --commit requires explicit --kb-root. Default mode uses throwaway temp kb and cannot commit to repo.");
    process.exit(1);
  }

  const seedKbRoot = path.resolve(process.cwd(), "kb");
  if (!fs.existsSync(seedKbRoot) || !fs.statSync(seedKbRoot).isDirectory()) {
    console.error(`[FATAL] Seed kb directory not found at ${seedKbRoot}`);
    process.exit(1);
  }

  const tempWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-e2e-v2-"));
  const tempKbRoot = path.join(tempWorkspaceRoot, "kb");
  fs.cpSync(seedKbRoot, tempKbRoot, { recursive: true });

  return {
    kbRoot: tempKbRoot,
    mode: "throwaway",
    tempWorkspaceRoot,
  };
}

function listFilesRecursive(root: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(abs));
    } else if (entry.isFile()) {
      files.push(abs);
    }
  }
  return files;
}

function snapshotKbContents(kbRoot: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const absPath of listFilesRecursive(kbRoot)) {
    const relPath = path.relative(kbRoot, absPath).replace(/\\/g, "/");
    const content = fs.readFileSync(absPath, "utf8");
    snapshot.set(relPath, content);
  }
  return snapshot;
}

function diffSnapshots(
  before: Map<string, string>,
  after: Map<string, string>
): string[] {
  const allPaths = new Set<string>([...before.keys(), ...after.keys()]);
  const changed: string[] = [];
  for (const relPath of allPaths) {
    if (before.get(relPath) !== after.get(relPath)) {
      changed.push(relPath);
    }
  }
  changed.sort();
  return changed;
}

// ── Keyword-based entity/concept extraction ───────────────────────────────────

interface PageSpec {
  id: string;
  title: string;
}

const ENTITY_KEYWORDS: Array<{ pattern: RegExp; id: string; title: string }> = [
  { pattern: /risc[-_]?v/i,   id: "risc_v",     title: "RISC-V" },
  { pattern: /linux/i,        id: "linux",       title: "Linux" },
  { pattern: /docker/i,       id: "docker",      title: "Docker" },
  { pattern: /llm|大模型/i,  id: "llm",         title: "大语言模型（LLM）" },
  { pattern: /openai/i,       id: "openai",      title: "OpenAI" },
  { pattern: /anthropic/i,    id: "anthropic",   title: "Anthropic" },
  { pattern: /tee|可信执行/,  id: "tee",         title: "TEE（可信执行环境）" },
  { pattern: /tpcm/i,         id: "tpcm",        title: "TPCM（可信平台控制模块）" },
  { pattern: /opensbi/i,      id: "opensbi",     title: "OpenSBI" },
  { pattern: /windows/i,      id: "windows",     title: "Windows" },
  { pattern: /java/i,         id: "java",        title: "Java" },
  { pattern: /u[-_]?boot/i,   id: "uboot",       title: "U-Boot" },
  { pattern: /siri/i,         id: "siri",        title: "Siri" },
  { pattern: /apple/i,        id: "apple",       title: "Apple" },
];

const CONCEPT_KEYWORDS: Array<{ pattern: RegExp; id: string; title: string }> = [
  { pattern: /安全启动|secure.?boot/i,             id: "secure_boot",        title: "安全启动（信任链）" },
  { pattern: /可信计算|trusted.?computing/i,        id: "trusted_computing",  title: "可信计算" },
  { pattern: /硬件隔离|hardware.?isol/i,            id: "hardware_isolation", title: "硬件隔离" },
  { pattern: /内存管理|memory.?manag/i,            id: "memory_management",  title: "内存管理" },
  { pattern: /虚拟化|virtualiz/i,                  id: "virtualization",     title: "虚拟化" },
  { pattern: /后训练|post.?train/i,                id: "post_training",      title: "后训练（Post-training）" },
  { pattern: /code.?model|程序模型/i,              id: "code_model",         title: "代码模型（Code Model）" },
  { pattern: /半导体|semiconductor/i,              id: "semiconductor",      title: "半导体产业" },
  { pattern: /启动流程|boot.?flow/i,               id: "boot_flow",          title: "启动流程" },
];

/** Slugify to ASCII-only [a-z0-9_] — required by kb frontmatter id format */
function slugify(str: string): string {
  return str
    .toLowerCase()
    // Transliterate common CJK-adjacent letters (keep ASCII letters/digits)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "stub";
}

function extractEntitiesFromFilename(sourcePath: string): PageSpec[] {
  const base = path.basename(sourcePath);
  const matches: PageSpec[] = [];
  for (const kw of ENTITY_KEYWORDS) {
    if (kw.pattern.test(base)) {
      matches.push({ id: kw.id, title: kw.title });
      if (matches.length >= 3) break;
    }
  }
  if (matches.length === 0) {
    // Fallback: stub entity with ASCII-only id derived from source_id shape
    // Use a deterministic slug from the filename without CJK chars
    const nameNoExt = path.basename(base, path.extname(base));
    const asciiOnly = nameNoExt.replace(/[^\x00-\x7F]+/g, "").trim();
    const slug = slugify(asciiOnly || "stub_entity");
    matches.push({ id: slug, title: nameNoExt.slice(0, 60) });
  }
  return matches;
}

function extractConceptsFromFilename(sourcePath: string): PageSpec[] {
  const base = path.basename(sourcePath);
  const matches: PageSpec[] = [];
  for (const kw of CONCEPT_KEYWORDS) {
    if (kw.pattern.test(base)) {
      matches.push({ id: kw.id, title: kw.title });
      if (matches.length >= 2) break;
    }
  }
  if (matches.length === 0) {
    // Fallback: one concept with ASCII-only id
    const nameNoExt = path.basename(base, path.extname(base));
    const asciiOnly = nameNoExt.replace(/[^\x00-\x7F]+/g, "").trim();
    const slug = slugify(asciiOnly || "stub_concept");
    matches.push({ id: `concept_${slug}`, title: `核心概念（${nameNoExt.slice(0, 40)}）` });
  }
  return matches;
}

// ── Page template helpers ─────────────────────────────────────────────────────

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function resolveIngestToday(): string {
  const override = process.env.E2E_V2_INGEST_TODAY?.trim();
  if (!override) {
    return new Date().toISOString().slice(0, 10);
  }
  if (!ISO_DATE_PATTERN.test(override)) {
    throw new Error(
      `E2E_V2_INGEST_TODAY must be in YYYY-MM-DD format. Received: "${override}"`
    );
  }
  return override;
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return ISO_DATE_PATTERN.test(trimmed) ? trimmed : null;
}

const INGEST_TODAY = resolveIngestToday();

type PageFrontmatterTemplate = Record<string, unknown> & {
  id: string;
  type: "source" | "entity" | "concept";
  title: string;
  updated_at: string;
  status: "active";
  tags: string[];
  source_ids: string[];
};

function buildPage(
  frontmatter: PageFrontmatterTemplate,
  body: string
): string {
  return `${serializeFrontmatter(frontmatter)}\n\n${body.trim()}`;
}

function makeSourcePage(sourceId: string, title: string, charCount: number, updatedAt: string): string {
  return buildPage({
    id: sourceId,
    type: "source",
    title,
    updated_at: updatedAt,
    status: "active",
    tags: ["e2e-driver", "auto-generated"],
    source_ids: [sourceId],
  }, `# ${title}

## 文档概述

本页是由 e2e_v2_ingest.ts 驱动程序自动生成的占位源摘要页。原始文档包含约 ${charCount} 个字符。

此页面用于验证 kb_ingest 工具链的完整 8 步流程能够正常工作。

## 关联

（由驱动程序自动生成——实际摘要应由 Claude Code 通过 kb_ingest 技能生成。）

## 来源

- 原始文件：${title}
`);
}

function makeEntityPage(
  entityId: string,
  entityTitle: string,
  sourceId: string,
  sourceTitle: string,
  updatedAt: string
): string {
  return buildPage({
    id: entityId,
    type: "entity",
    title: entityTitle,
    updated_at: updatedAt,
    status: "active",
    tags: ["e2e-driver", "auto-generated"],
    source_ids: [sourceId],
  }, `# ${entityTitle}

Placeholder entity page for ${entityTitle}, backed by [[${sourceId}|${sourceTitle}]].

（由 e2e_v2_ingest.ts 驱动程序自动生成，用于验证工具链。）

## 关联

（待补充）

## 来源

- 基于 [[${sourceId}|${sourceTitle}]]`);
}

function makeConceptPage(
  conceptId: string,
  conceptTitle: string,
  sourceId: string,
  sourceTitle: string,
  updatedAt: string
): string {
  return buildPage({
    id: conceptId,
    type: "concept",
    title: conceptTitle,
    updated_at: updatedAt,
    status: "active",
    tags: ["e2e-driver", "auto-generated"],
    source_ids: [sourceId],
  }, `# ${conceptTitle}

Placeholder concept page for ${conceptTitle}, backed by [[${sourceId}|${sourceTitle}]].

（由 e2e_v2_ingest.ts 驱动程序自动生成，用于验证工具链。）

## 关联

（待补充）

## 来源

- 基于 [[${sourceId}|${sourceTitle}]]
`);
}

// ── Logging helpers ───────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(msg);
}

function logTool(tool: string, input: Record<string, unknown>, output: unknown): void {
  const outputStr = JSON.stringify(output).slice(0, 200);
  log(`  [TOOL] ${tool}(${JSON.stringify(input).slice(0, 120)}) => ${outputStr}`);
}

function checkWarnings(toolName: string, warnings: string[]): void {
  if (warnings.length > 0) {
    console.warn(`  [WARN] ${toolName} warnings:`);
    warnings.forEach((w) => console.warn(`    - ${w}`));
  }
}

function abort(step: string, error: string): never {
  throw new Error(`Step "${step}" failed: ${error}`);
}

// ── Core ingest flow ──────────────────────────────────────────────────────────

interface RunResult {
  sourceId: string;
  sourceTitle: string;
  entities: PageSpec[];
  concepts: PageSpec[];
  /** Map from dedup_key → action */
  ensureActions: Record<string, string>;
}

async function runIngest(
  sourcePath: string,
  config: WorkspaceConfig,
  runLabel: string,
  runStep6bCoverageCheck: boolean
): Promise<RunResult> {
  log(`\n${"=".repeat(70)}`);
  log(`${runLabel}`);
  log(`Source: ${sourcePath}`);
  log("=".repeat(70));

  // ── Step 1: kb_source_add ────────────────────────────────────────────────
  log("\n[Step 1] kbSourceAdd — register source file...");
  const addInput = { file_path: sourcePath };
  const addResult = await kbSourceAdd(addInput, config);
  logTool("kbSourceAdd", addInput, { success: addResult.success, data: addResult.data, error: addResult.error });

  let sourceId: string;
  let alreadyRegistered = false;

  if (!addResult.success) {
    if (addResult.error?.includes("already registered")) {
      // Extract existing source_id from the error message
      const match = addResult.error.match(/src_sha256_[0-9a-f]+/);
      if (!match) {
        abort("kbSourceAdd", `already-registered but no source_id in error: ${addResult.error}`);
      }
      sourceId = match[0];
      alreadyRegistered = true;
      log(`  [OK] Source already registered (idempotent). source_id=${sourceId}`);
    } else {
      abort("kbSourceAdd", addResult.error ?? "unknown");
    }
  } else {
    sourceId = addResult.data!.source_id;
    log(`  [OK] Newly registered. source_id=${sourceId}, file_name=${addResult.data!.file_name}`);
  }

  if (runLabel.includes("Run 2") && alreadyRegistered) {
    log(`  [IDEMPOTENCY] kbSourceAdd correctly returned already-registered for run 2.`);
  }

  // ── Step 2: kb_read_source ───────────────────────────────────────────────
  log("\n[Step 2] kbReadSource — read raw content...");
  const readSrcInput = { source_id: sourceId };
  const readSrcResult = await kbReadSource(readSrcInput, config);
  logTool("kbReadSource", readSrcInput, { success: readSrcResult.success, charCount: readSrcResult.data?.content.length });

  if (!readSrcResult.success) {
    abort("kbReadSource", readSrcResult.error ?? "unknown");
  }
  const { content: rawContent, file_name: rawFileName } = readSrcResult.data!;
  // file_name may be undefined if manifest lacks that field — fall back to source path
  const file_name = rawFileName ?? path.basename(sourcePath);
  log(`  [OK] Read ${rawContent.length} chars from "${file_name}"`);

  const sourceTitle = path.basename(file_name, path.extname(file_name));

  // Derive entities and concepts from the filename
  const entities = extractEntitiesFromFilename(sourcePath);
  const concepts = extractConceptsFromFilename(sourcePath);
  log(`  Derived entities: ${entities.map((e) => e.id).join(", ")}`);
  log(`  Derived concepts: ${concepts.map((c) => c.id).join(", ")}`);

  // ── Step 3: kbSearchWiki — pre-write existence check ───────────────────
  log("\n[Step 3] kbSearchWiki — check existence of pages to be written...");
  const allPageSpecs = [
    { id: sourceId, title: sourceTitle, type: "source" as const },
    ...entities.map((e) => ({ ...e, type: "entity" as const })),
    ...concepts.map((c) => ({ ...c, type: "concept" as const })),
  ];
  const existingUpdatedAtByPageId: Record<string, string> = {};

  for (const spec of allPageSpecs) {
    const srInput = { query: spec.title, type_filter: spec.type };
    const srResult = await kbSearchWiki(srInput, config);
    if (!srResult.success) {
      abort(`kbSearchWiki (${spec.id})`, srResult.error ?? "unknown");
    }
    const hit = srResult.data?.find((r) => r.page_id === spec.id);
    log(`  Search "${spec.title}" [${spec.type}]: ${hit ? `found (page_id=${hit.page_id})` : "not found (will create)"}`);

    // If found on run 2, read the page first to inspect (kbReadPage usage)
    if (hit) {
      log(`\n[Step 3b] kbReadPage — inspect existing page "${spec.id}"...`);
      const rpInput = { path_or_id: spec.id };
      const rpResult = await kbReadPage(rpInput, config);
      logTool("kbReadPage", rpInput, { success: rpResult.success, path: rpResult.data?.path, fm_id: rpResult.data?.frontmatter.id });
      if (!rpResult.success) {
        log(`  [WARN] kbReadPage failed for ${spec.id}: ${rpResult.error}`);
      } else {
        const existingUpdatedAt = parseIsoDate(rpResult.data!.frontmatter.updated_at);
        if (existingUpdatedAt) {
          existingUpdatedAtByPageId[spec.id] = existingUpdatedAt;
        }
        log(`  [OK] kbReadPage: path=${rpResult.data!.path}, type=${rpResult.data!.frontmatter.type}, status=${rpResult.data!.frontmatter.status}`);
      }
    }
  }

  // ── Step 4: kbWritePage — source summary ────────────────────────────────
  log("\n[Step 4] kbWritePage — source summary page...");
  const sourceUpdatedAt = existingUpdatedAtByPageId[sourceId] ?? INGEST_TODAY;
  const sourcePageContent = makeSourcePage(sourceId, sourceTitle, rawContent.length, sourceUpdatedAt);
  const wpSrcInput = { path: `wiki/sources/${sourceId}.md`, content: sourcePageContent };
  const wpSrcResult = await kbWritePage(wpSrcInput, config);
  logTool("kbWritePage(source)", wpSrcInput, { success: wpSrcResult.success, data: wpSrcResult.data });
  if (!wpSrcResult.success) {
    abort("kbWritePage (source)", wpSrcResult.error ?? "unknown");
  }
  checkWarnings("kbWritePage (source)", wpSrcResult.data!.warnings);
  log(`  [OK] source page: action=${wpSrcResult.data!.action}, page_id=${wpSrcResult.data!.page_id}`);

  // ── Step 5: kbWritePage — entity pages ──────────────────────────────────
  log("\n[Step 5] kbWritePage — entity pages...");
  let firstEntityWriteAction: "created" | "updated" | null = null;
  for (const [index, entity] of entities.entries()) {
    const updatedAt = existingUpdatedAtByPageId[entity.id] ?? INGEST_TODAY;
    const content = makeEntityPage(entity.id, entity.title, sourceId, sourceTitle, updatedAt);
    const wpInput = { path: `wiki/entities/${entity.id}.md`, content };
    const wpResult = await kbWritePage(wpInput, config);
    logTool(`kbWritePage(entity:${entity.id})`, wpInput, { success: wpResult.success, data: wpResult.data });
    if (!wpResult.success) {
      abort(`kbWritePage (entity:${entity.id})`, wpResult.error ?? "unknown");
    }
    checkWarnings(`kbWritePage (entity:${entity.id})`, wpResult.data!.warnings);
    const action = wpResult.data!.action;
    if (index === 0) {
      firstEntityWriteAction = action;
    }
    log(`  [OK] entity "${entity.id}": action=${action}`);
  }

  // ── Step 6: kbWritePage — concept pages ────────────────────────────────
  log("\n[Step 6] kbWritePage — concept pages...");
  for (const concept of concepts) {
    const updatedAt = existingUpdatedAtByPageId[concept.id] ?? INGEST_TODAY;
    const content = makeConceptPage(concept.id, concept.title, sourceId, sourceTitle, updatedAt);
    const wpInput = { path: `wiki/concepts/${concept.id}.md`, content };
    const wpResult = await kbWritePage(wpInput, config);
    logTool(`kbWritePage(concept:${concept.id})`, wpInput, { success: wpResult.success, data: wpResult.data });
    if (!wpResult.success) {
      abort(`kbWritePage (concept:${concept.id})`, wpResult.error ?? "unknown");
    }
    checkWarnings(`kbWritePage (concept:${concept.id})`, wpResult.data!.warnings);
    log(`  [OK] concept "${concept.id}": action=${wpResult.data!.action}`);
  }

  // ── Step 6b: kbUpdateSection — create-time-only coverage/normalization check
  if (runStep6bCoverageCheck && entities.length > 0 && firstEntityWriteAction === "created") {
    const firstEntity = entities[0];
    log(`\n[Step 6b] kbUpdateSection — create-time 来源 section coverage check on entity "${firstEntity.id}"...`);
    const usInput = {
      path: `wiki/entities/${firstEntity.id}.md`,
      heading: "## 来源",
      content: `- 基于 [[${sourceId}|${sourceTitle}]]`,
      append: false,
      create_if_missing: false,
    };
    const usResult = await kbUpdateSection(usInput, config);
    logTool("kbUpdateSection", usInput, { success: usResult.success, data: usResult.data });
    if (!usResult.success) {
      log(`  [WARN] kbUpdateSection failed (section may be missing): ${usResult.error}`);
    } else {
      log(`  [OK] kbUpdateSection: action=${usResult.data!.action}`);
    }
  } else if (!runStep6bCoverageCheck) {
    log("\n[Step 6b] Skipped on Run 2 — preserving raw second-pass writes for idempotency drift detection.");
  } else if (entities.length === 0) {
    log("\n[Step 6b] Skipped — no entity pages available for coverage check.");
  } else {
    log("\n[Step 6b] Skipped — first entity already existed; avoiding repeat section update/date drift.");
  }

  // ── Step 7: kbEnsureEntry — index.md and log.md ─────────────────────────
  log("\n[Step 7] kbEnsureEntry — update index.md and log.md...");

  const ensureActions: Record<string, string> = {};

  // Entity entries in index.md
  for (const entity of entities) {
    const dedupKey = `index_${entity.id}`;
    const eeInput = {
      path: "wiki/index.md",
      entry: `- [[${entity.id}|${entity.title}]] — 由 ${sourceTitle} 提炼（e2e driver）`,
      anchor: "## Entities",
      dedup_key: dedupKey,
    };
    const eeResult = await kbEnsureEntry(eeInput, config);
    logTool(`kbEnsureEntry(${dedupKey})`, eeInput, { success: eeResult.success, data: eeResult.data });
    if (!eeResult.success) {
      abort(`kbEnsureEntry (${dedupKey})`, eeResult.error ?? "unknown");
    }
    ensureActions[dedupKey] = eeResult.data!.action;
    log(`  [OK] ${dedupKey}: ${eeResult.data!.action}`);
  }

  // Concept entries in index.md
  for (const concept of concepts) {
    const dedupKey = `index_${concept.id}`;
    const eeInput = {
      path: "wiki/index.md",
      entry: `- [[${concept.id}|${concept.title}]] — 由 ${sourceTitle} 提炼（e2e driver）`,
      anchor: "## Concepts",
      dedup_key: dedupKey,
    };
    const eeResult = await kbEnsureEntry(eeInput, config);
    logTool(`kbEnsureEntry(${dedupKey})`, eeInput, { success: eeResult.success, data: eeResult.data });
    if (!eeResult.success) {
      abort(`kbEnsureEntry (${dedupKey})`, eeResult.error ?? "unknown");
    }
    ensureActions[dedupKey] = eeResult.data!.action;
    log(`  [OK] ${dedupKey}: ${eeResult.data!.action}`);
  }

  // Source entry in index.md under ## Sources
  {
    const dedupKey = `index_${sourceId}`;
    const eeInput = {
      path: "wiki/index.md",
      entry: `- [[${sourceId}|${sourceTitle}]] — 原始文档（e2e driver）`,
      anchor: "## Sources",
      dedup_key: dedupKey,
    };
    const eeResult = await kbEnsureEntry(eeInput, config);
    logTool(`kbEnsureEntry(${dedupKey})`, eeInput, { success: eeResult.success, data: eeResult.data });
    if (!eeResult.success) {
      abort(`kbEnsureEntry (${dedupKey})`, eeResult.error ?? "unknown");
    }
    ensureActions[dedupKey] = eeResult.data!.action;
    log(`  [OK] ${dedupKey}: ${eeResult.data!.action}`);
  }

  // Log entry — canonical dedup_key: log_ingest_{source_id}
  {
    const dedupKey = `log_ingest_${sourceId}`;
    const entityList = entities.map((e) => `[[${e.id}|${e.title}]] (entity)`).join(", ");
    const conceptList = concepts.map((c) => `[[${c.id}|${c.title}]] (concept)`).join(", ");
    const logEntry = `## [${INGEST_TODAY}] ingest | ${sourceTitle}
- 新建/更新: [[${sourceId}|源摘要页]] (source)
- 实体: ${entityList}
- 概念: ${conceptList}
- 工具: kbSourceAdd, kbReadSource, kbSearchWiki, kbReadPage, kbWritePage, kbUpdateSection, kbEnsureEntry`;

    const logInput = {
      path: "wiki/log.md",
      entry: logEntry,
      anchor: null as null,
      dedup_key: dedupKey,
    };
    const logResult = await kbEnsureEntry(logInput, config);
    logTool(`kbEnsureEntry(${dedupKey})`, logInput, { success: logResult.success, data: logResult.data });
    if (!logResult.success) {
      abort(`kbEnsureEntry (${dedupKey})`, logResult.error ?? "unknown");
    }
    ensureActions[dedupKey] = logResult.data!.action;
    log(`  [OK] ${dedupKey}: ${logResult.data!.action}`);
  }

  return { sourceId, sourceTitle, entities, concepts, ensureActions };
}

// ── Post-write verification ───────────────────────────────────────────────────

async function verify(
  result: RunResult,
  config: WorkspaceConfig,
  runLabel: string
): Promise<boolean> {
  log(`\n${"─".repeat(60)}`);
  log(`Verification — ${runLabel}`);
  log("─".repeat(60));

  let passed = true;

  // 1. Read page-index.json and count by type
  const pageIndexPath = path.resolve(config.kb_root, "state/cache/page-index.json");
  if (!fs.existsSync(pageIndexPath)) {
    log(`FAIL: page-index.json not found at ${pageIndexPath}`);
    return false;
  }
  const pageIndex = JSON.parse(fs.readFileSync(pageIndexPath, "utf8")) as {
    pages: Array<{ page_id: string; type: string; path: string }>;
  };
  const typeCounts: Record<string, number> = {};
  for (const page of pageIndex.pages) {
    typeCounts[page.type] = (typeCounts[page.type] ?? 0) + 1;
  }
  log("\n  page-index.json — page count by type:");
  for (const [type, count] of Object.entries(typeCounts).sort()) {
    log(`    ${type}: ${count}`);
  }
  log(`    TOTAL: ${pageIndex.pages.length}`);

  // 2. Verify each written page is retrievable via kbReadPage
  const pagesToCheck: Array<{ id: string; label: string }> = [
    { id: result.sourceId, label: "source" },
    ...result.entities.map((e) => ({ id: e.id, label: `entity:${e.id}` })),
    ...result.concepts.map((c) => ({ id: c.id, label: `concept:${c.id}` })),
  ];

  log("\n  kbReadPage checks:");
  for (const { id, label } of pagesToCheck) {
    const rpResult = await kbReadPage({ path_or_id: id }, config);
    if (!rpResult.success) {
      log(`  FAIL: kbReadPage(${id}) failed: ${rpResult.error}`);
      passed = false;
    } else {
      const fm = rpResult.data!.frontmatter;
      if (fm.id !== id) {
        log(`  FAIL: kbReadPage(${id}) frontmatter.id mismatch: got "${fm.id}"`);
        passed = false;
      } else {
        log(`    [OK] ${label}: id=${fm.id}, type=${fm.type}, status=${fm.status}`);
      }
    }
  }

  // 3. Acceptance criteria
  log("\n  Acceptance criteria:");
  const hasSource = typeCounts["source"] !== undefined && typeCounts["source"] >= 1;
  const hasEntity = typeCounts["entity"] !== undefined && typeCounts["entity"] >= 1;
  const hasConcept = typeCounts["concept"] !== undefined && typeCounts["concept"] >= 1;

  log(`    ≥1 source page:  ${hasSource ? "OK" : "FAIL"}`);
  log(`    ≥1 entity page:  ${hasEntity ? "OK" : "FAIL"}`);
  log(`    ≥1 concept page: ${hasConcept ? "OK" : "FAIL"}`);

  if (!hasSource) { log("FAIL: no source pages in index"); passed = false; }
  if (!hasEntity) { log("FAIL: no entity pages in index"); passed = false; }
  if (!hasConcept) { log("FAIL: no concept pages in index"); passed = false; }

  // Check index.md and log.md contain the new entries
  const indexPath = path.resolve(config.kb_root, "wiki/index.md");
  const logPath = path.resolve(config.kb_root, "wiki/log.md");

  if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, "utf8");
    const firstEntity = result.entities[0];
    if (firstEntity && !indexContent.includes(`[[${firstEntity.id}|`)) {
      log(`  FAIL: index.md does not contain entity [[${firstEntity.id}|`);
      passed = false;
    } else {
      log(`    [OK] index.md contains entity entry`);
    }
    const firstConcept = result.concepts[0];
    if (firstConcept && !indexContent.includes(`[[${firstConcept.id}|`)) {
      log(`  FAIL: index.md does not contain concept [[${firstConcept.id}|`);
      passed = false;
    } else {
      log(`    [OK] index.md contains concept entry`);
    }
  } else {
    log(`  FAIL: wiki/index.md not found`);
    passed = false;
  }

  if (fs.existsSync(logPath)) {
    const logContent = fs.readFileSync(logPath, "utf8");
    if (!logContent.includes(result.sourceId)) {
      log(`  FAIL: log.md does not reference source_id ${result.sourceId}`);
      passed = false;
    } else {
      log(`    [OK] log.md contains source_id entry`);
    }
  } else {
    log(`  FAIL: wiki/log.md not found`);
    passed = false;
  }

  return passed;
}

// ── Idempotency check ─────────────────────────────────────────────────────────

function checkIdempotency(run1: RunResult, run2: RunResult): boolean {
  log(`\n${"─".repeat(60)}`);
  log("Idempotency analysis");
  log("─".repeat(60));

  let ok = true;

  // Every ensure_entry on run 2 must be "already_exists" (not "inserted")
  for (const [key, action] of Object.entries(run2.ensureActions)) {
    if (action === "already_exists") {
      log(`  [OK] ${key}: already_exists (idempotent)`);
    } else if (action === "inserted") {
      // This is a failure — means the dedup key was not respected
      log(`  FAIL: ${key}: inserted on run 2 (should have been already_exists — duplicate entry created!)`);
      ok = false;
    } else {
      log(`  [INFO] ${key}: ${action}`);
    }
  }

  // Source IDs should match
  if (run1.sourceId !== run2.sourceId) {
    log(`  FAIL: source_id changed between runs: run1=${run1.sourceId}, run2=${run2.sourceId}`);
    ok = false;
  } else {
    log(`  [OK] source_id consistent across runs: ${run1.sourceId}`);
  }

  return ok;
}

function checkContentIdempotency(
  snapshotAfterRun1: Map<string, string>,
  snapshotAfterRun2: Map<string, string>
): boolean {
  const changedFiles = diffSnapshots(snapshotAfterRun1, snapshotAfterRun2);
  if (changedFiles.length === 0) {
    log("  [OK] Run 2 made no file-content changes relative to Run 1.");
    return true;
  }

  log("  FAIL: Run 2 changed file content relative to Run 1:");
  for (const file of changedFiles.slice(0, 20)) {
    log(`    - ${file}`);
  }
  if (changedFiles.length > 20) {
    log(`    ... and ${changedFiles.length - 20} more files`);
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sourcePath, doCommit, explicitKbRoot } = parseArgs();

  if (!fs.existsSync(sourcePath)) {
    console.error(`[FATAL] Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  const kb = resolveKbRoot(explicitKbRoot, doCommit);
  const kbRoot = kb.kbRoot;
  const config: WorkspaceConfig = { kb_root: kbRoot };

  log(`\nKB root: ${kbRoot}`);
  log(`Mode:    ${kb.mode === "throwaway" ? "throwaway temp copy (safe default)" : "explicit kb root"}`);
  if (kb.mode === "throwaway") {
    log(`Temp WS: ${kb.tempWorkspaceRoot}`);
  }
  log(`Source:  ${sourcePath}`);
  log(`Commit:  ${doCommit}`);
  try {
    // ── Run 1 ────────────────────────────────────────────────────────────
    const run1 = await runIngest(sourcePath, config, "Run 1 — Initial ingest", true);
    const run1OK = await verify(run1, config, "Run 1");

    if (!run1OK) {
      abort("verify (run 1)", "Run 1 verification failed (see above)");
    }
    const snapshotAfterRun1 = snapshotKbContents(config.kb_root);
    log("\nOK");

    // ── Run 2 (idempotency) ───────────────────────────────────────────────
    const run2 = await runIngest(sourcePath, config, "Run 2 — Idempotency re-ingest", false);
    const run2OK = await verify(run2, config, "Run 2");
    const snapshotAfterRun2 = snapshotKbContents(config.kb_root);
    const idempotencyOK = checkIdempotency(run1, run2);
    const contentIdempotencyOK = checkContentIdempotency(snapshotAfterRun1, snapshotAfterRun2);

    if (!run2OK) {
      abort("verify (run 2)", "Run 2 verification failed (see above)");
    }

    if (!idempotencyOK || !contentIdempotencyOK) {
      abort("idempotency", "run 2 violated dedup or content-stability expectations");
    }
    log("\nIDEMPOTENCY OK");

    // ── Optional commit ────────────────────────────────────────────────────
    if (doCommit) {
      log(`\n[Commit] kbCommit — committing kb/ changes...`);
      const commitMsg = `kb: e2e ingest ${run1.sourceId} — ${run1.sourceTitle}`;
      const commitInput = { message: commitMsg };
      const commitResult = await kbCommit(commitInput, config);
      logTool("kbCommit", commitInput, { success: commitResult.success, data: commitResult.data });
      if (!commitResult.success) {
        abort("kbCommit", commitResult.error ?? "unknown");
      }
      log(`  [OK] Committed: ${commitResult.data!.commit_hash} — "${commitResult.data!.message}"`);
    } else {
      log(`\n[Commit] Skipped (pass --commit to enable). KB changes left unstaged.`);
    }

    log(`\n${"=".repeat(70)}`);
    log("E2E V2 ingest driver — DONE");
    log("=".repeat(70));
  } finally {
    if (kb.tempWorkspaceRoot) {
      fs.rmSync(kb.tempWorkspaceRoot, { recursive: true, force: true });
      log(`\n[Cleanup] Removed throwaway workspace: ${kb.tempWorkspaceRoot}`);
    }
  }
}

main().catch((err) => {
  console.error("[UNCAUGHT]", err);
  process.exit(1);
});
