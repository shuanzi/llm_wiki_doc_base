import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync, execFileSync } from "child_process";
import type {
  Draft,
  DraftFile,
  InProgressRecord,
  CompletedFileRecord,
  RecoveryAction,
  PageIndex,
  PageIndexEntry,
  ToolResult,
  WorkspaceConfig,
} from "../types";
import { resolveKbPath, validateSafeId } from "../utils/path_validator";
import { parseFrontmatter, extractHeadings, extractExcerpt } from "../utils/frontmatter";

export interface KbApplyPatchInput {
  draft: Draft;
  dry_run?: boolean;
  recovery_action?: RecoveryAction;
}

export interface KbApplyPatchOutput {
  applied_files: string[];
  index_updated: boolean;
}

/**
 * kb_apply_patch — Pure executor. Writes draft files to disk deterministically.
 *
 * Pre-checks:
 * - git status --porcelain -- kb/ (excluding kb/state/runs/) must be clean
 * - Writes in_progress.json marker before starting
 *
 * Executes:
 * - create: creates new file, errors if exists
 * - ensure_entry: idempotent insert by dedup_key
 * - overwrite: replaces entire file
 *
 * Post:
 * - Syncs kb/state/cache/page-index.json
 * - Moves draft from drafts/ to applied/
 * - Removes in_progress marker
 *
 * Failure recovery:
 * - On failure: moves draft to failed/, preserves in_progress.json
 * - On next run with residual in_progress: offers resume/rollback/force-clear
 *   - rollback: git checkout for modified files, delete for created files
 */
export async function kbApplyPatch(
  input: KbApplyPatchInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbApplyPatchOutput>> {
  try {
    const { draft, dry_run = false, recovery_action } = input;

    // Validate plan_id before using in file paths
    validateSafeId(draft.plan_id, "plan_id");

    const runsDir = resolveKbPath("state/runs", config.kb_root);
    const inProgressPath = path.join(runsDir, "in_progress.json");

    // --- Check for residual in_progress ---
    let isResume = false;
    let completedPaths = new Set<string>();

    if (fs.existsSync(inProgressPath)) {
      const residual: InProgressRecord = JSON.parse(
        fs.readFileSync(inProgressPath, "utf8")
      );

      if (!recovery_action) {
        return {
          success: false,
          error: `Residual in_progress record found (run_id: ${residual.run_id}, plan_id: ${residual.plan_id}). ` +
            `Provide recovery_action: "resume", "rollback", or "force-clear".`,
        };
      }

      if (recovery_action === "rollback") {
        await rollback(residual, config);
        fs.unlinkSync(inProgressPath);
        return {
          success: true,
          data: { applied_files: [], index_updated: false },
        };
      }

      if (recovery_action === "force-clear") {
        fs.unlinkSync(inProgressPath);
        // Fall through to normal execution
      }

      if (recovery_action === "resume") {
        isResume = true;
        completedPaths = new Set(residual.completed_files.map((f) => f.path));
        // On resume, move draft back from failed/ to drafts/ if needed
        const draftInFailed = resolveKbPath(
          `state/failed/${draft.plan_id}.json`,
          config.kb_root
        );
        if (fs.existsSync(draftInFailed)) {
          moveDraft(draft.plan_id, "failed", "drafts", config);
        }
      }
    }

    // --- Dirty check: git status --porcelain -- kb/ ---
    // Skip dirty check on resume since partial apply left uncommitted changes
    if (!dry_run && !isResume) {
      const gitStatus = checkDirtyState(config.kb_root);
      if (gitStatus.length > 0) {
        return {
          success: false,
          error: `kb/ has uncommitted changes (excluding state/runs/):\n${gitStatus.join("\n")}\nCommit or stash before applying.`,
        };
      }
    }

    // --- Write/reuse in_progress marker ---
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    const inProgress: InProgressRecord = isResume && fs.existsSync(inProgressPath)
      ? JSON.parse(fs.readFileSync(inProgressPath, "utf8"))
      : {
          run_id: `run_${crypto.randomBytes(8).toString("hex")}`,
          plan_id: draft.plan_id,
          started_at: new Date().toISOString(),
          completed_files: [],
        };

    if (!dry_run && !isResume) {
      fs.writeFileSync(inProgressPath, JSON.stringify(inProgress, null, 2), "utf8");
    }

    // --- Execute draft files ---
    const appliedFiles: string[] = [];

    try {
      for (const file of draft.files) {
        if (dry_run) {
          appliedFiles.push(`[dry-run] ${file.action}: ${file.path}`);
          continue;
        }

        // Skip files already completed in a previous run (resume)
        if (completedPaths.has(file.path)) {
          appliedFiles.push(file.path);
          continue;
        }

        const op = await applyFile(file, config);
        appliedFiles.push(file.path);
        inProgress.completed_files.push(op);
        fs.writeFileSync(inProgressPath, JSON.stringify(inProgress, null, 2), "utf8");
      }
    } catch (applyErr: unknown) {
      // Move draft to failed/
      moveDraft(draft.plan_id, "drafts", "failed", config);
      const msg = applyErr instanceof Error ? applyErr.message : String(applyErr);
      return {
        success: false,
        error: `Apply failed at file operation: ${msg}. in_progress.json preserved for recovery.`,
      };
    }

    if (dry_run) {
      return { success: true, data: { applied_files: appliedFiles, index_updated: false } };
    }

    // --- Update page-index.json ---
    const indexUpdated = syncPageIndex(config);

    // --- Move draft from drafts/ to applied/ ---
    moveDraft(draft.plan_id, "drafts", "applied", config);

    // --- Remove in_progress marker ---
    if (fs.existsSync(inProgressPath)) {
      fs.unlinkSync(inProgressPath);
    }

    return {
      success: true,
      data: { applied_files: appliedFiles, index_updated: indexUpdated },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Apply a single draft file operation.
 */
async function applyFile(
  file: DraftFile,
  config: WorkspaceConfig
): Promise<CompletedFileRecord> {
  const absPath = resolveKbPath(file.path, config.kb_root);
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  switch (file.action) {
    case "create": {
      if (fs.existsSync(absPath)) {
        throw new Error(`File already exists: ${file.path} (action=create)`);
      }
      fs.writeFileSync(absPath, file.content, "utf8");
      return { path: file.path, op: "created" };
    }
    case "ensure_entry": {
      if (!fs.existsSync(absPath)) {
        throw new Error(`Target file does not exist: ${file.path} (action=ensure_entry)`);
      }
      let content = fs.readFileSync(absPath, "utf8");

      // Check dedup: if entry already contains dedup_key marker, skip
      const dedupMarker = `<!-- dedup:${file.dedup_key} -->`;
      if (content.includes(dedupMarker)) {
        return { path: file.path, op: "modified" };
      }

      // Find anchor and insert after it
      const anchorIndex = content.indexOf(file.anchor ?? "");
      if (anchorIndex === -1 && file.anchor) {
        throw new Error(
          `Anchor "${file.anchor}" not found in ${file.path}`
        );
      }

      const insertAfter = file.anchor
        ? anchorIndex + file.anchor.length
        : content.length;

      const entryWithMarker = `\n${file.entry} ${dedupMarker}`;
      content =
        content.slice(0, insertAfter) + entryWithMarker + content.slice(insertAfter);

      fs.writeFileSync(absPath, content, "utf8");
      return { path: file.path, op: "modified" };
    }
    case "overwrite": {
      const existed = fs.existsSync(absPath);
      fs.writeFileSync(absPath, file.content, "utf8");
      return { path: file.path, op: existed ? "modified" : "created" };
    }
    default:
      throw new Error(`Unknown draft action: ${(file as DraftFile).action}`);
  }
}

/**
 * Check dirty state of kb/ excluding kb/state/runs/.
 */
function checkDirtyState(kbRoot: string): string[] {
  try {
    const result = execSync("git status --porcelain -- kb/", {
      cwd: path.dirname(kbRoot),
      encoding: "utf8",
    });
    return result
      .split("\n")
      .filter((line) => line.trim() !== "")
      .filter((line) => !line.includes("kb/state/runs/"));
  } catch {
    return [];
  }
}

/**
 * Move a draft JSON file between state subdirectories.
 */
function moveDraft(
  planId: string,
  from: string,
  to: string,
  config: WorkspaceConfig
): void {
  validateSafeId(planId, "plan_id");
  const srcPath = resolveKbPath(`state/${from}/${planId}.json`, config.kb_root);
  const destDir = resolveKbPath(`state/${to}`, config.kb_root);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const destPath = path.join(destDir, `${planId}.json`);
  if (fs.existsSync(srcPath)) {
    fs.renameSync(srcPath, destPath);
  }
}

/**
 * Rollback changes described in an in_progress record.
 */
async function rollback(
  record: InProgressRecord,
  config: WorkspaceConfig
): Promise<void> {
  for (const file of record.completed_files) {
    const absPath = resolveKbPath(file.path, config.kb_root);
    if (file.op === "created" && fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    } else if (file.op === "modified") {
      try {
        execFileSync("git", ["checkout", "--", absPath], {
          cwd: path.dirname(config.kb_root),
          encoding: "utf8",
        });
      } catch {
        // best effort
      }
    }
  }

  // Move draft to failed/
  moveDraft(record.plan_id, "drafts", "failed", config);
}

/**
 * Rebuild page-index.json by scanning all wiki markdown files.
 */
function syncPageIndex(config: WorkspaceConfig): boolean {
  try {
    const wikiDir = resolveKbPath("wiki", config.kb_root);
    const pages: PageIndexEntry[] = [];

    function scanDir(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith(".md")) {
          try {
            const content = fs.readFileSync(fullPath, "utf8");
            const { frontmatter: fm, body } = parseFrontmatter(content);
            const relativePath =
              "wiki/" + path.relative(wikiDir, fullPath).replace(/\\/g, "/");

            if (fm.id) {
              pages.push({
                page_id: fm.id as string,
                path: relativePath,
                type: (fm.type as string) || "unknown",
                title: (fm.title as string) || entry.name,
                aliases: (fm.aliases as string[]) || [],
                tags: (fm.tags as string[]) || [],
                headings: extractHeadings(body),
                body_excerpt: extractExcerpt(body),
              });
            }
          } catch {
            // skip malformed files
          }
        }
      }
    }

    scanDir(wikiDir);

    const indexPath = resolveKbPath("state/cache/page-index.json", config.kb_root);
    const indexDir = path.dirname(indexPath);
    if (!fs.existsSync(indexDir)) {
      fs.mkdirSync(indexDir, { recursive: true });
    }

    const index: PageIndex = { pages };
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}
