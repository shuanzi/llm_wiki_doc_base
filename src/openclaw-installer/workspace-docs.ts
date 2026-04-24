import { sha256 } from "../utils/hash";
import { EXPECTED_KB_TOOL_NAMES } from "./mcp-probe";
import {
  INSTALLER_COMMANDS,
  INSTALLER_WORKSPACE_DOC_NAMES,
  type InstallerCommandName,
  type InstallerWorkspaceDocName,
} from "./types";

const KB_TOOL_SUMMARIES: Record<(typeof EXPECTED_KB_TOOL_NAMES)[number], string> = {
  kb_source_add: "Register a raw source into KB manifests.",
  kb_read_source: "Read raw source content by source_id.",
  kb_write_page: "Create or replace a full wiki page with frontmatter validation.",
  kb_update_section: "Replace or append a named markdown section.",
  kb_ensure_entry: "Idempotently append index/log entries by dedup_key.",
  kb_search_wiki: "Search wiki index by query/filter/link resolution.",
  kb_read_page: "Read a wiki page by path or page id.",
  kb_commit: "Stage kb/ and create a git commit.",
  kb_rebuild_index: "Rebuild page-index.json deterministically from kb/wiki.",
  kb_run_lint: "Run deterministic + semantic lint checks without mutating content.",
  kb_repair: "Repair structural KB artifacts with dry_run support.",
};

const INSTALLER_COMMAND_SUMMARIES: Record<InstallerCommandName, string> = {
  install:
    "Materialize installer-owned workspace artifacts, enable llmwiki session-visible kb_* tools, register MCP config, and write manifest state.",
  check:
    "Validate llmwiki session-visible kb_* availability, installer ownership, runtime consistency, and drift for managed artifacts.",
  repair:
    "Conservatively reconstruct installer-owned llmwiki session runtime, docs, skills, and MCP state when ownership is recognizable.",
  uninstall:
    "Remove installer-owned llmwiki session runtime artifacts and MCP registration when ownership can be verified.",
};

export interface RenderedOpenClawWorkspaceDoc {
  docName: InstallerWorkspaceDocName;
  installRelativeFile: InstallerWorkspaceDocName;
  content: string;
  contentHash: string;
}

export function renderOpenClawWorkspaceDoc(options: {
  docName: InstallerWorkspaceDocName;
}): RenderedOpenClawWorkspaceDoc {
  const content = buildWorkspaceDocContent(options.docName);
  return {
    docName: options.docName,
    installRelativeFile: options.docName,
    content,
    contentHash: sha256(content),
  };
}

export function renderAllOpenClawWorkspaceDocs(): RenderedOpenClawWorkspaceDoc[] {
  return INSTALLER_WORKSPACE_DOC_NAMES.map((docName) =>
    renderOpenClawWorkspaceDoc({ docName })
  );
}

function buildWorkspaceDocContent(docName: InstallerWorkspaceDocName): string {
  switch (docName) {
    case "AGENTS.md":
      return buildAgentsDocContent();
    case "HEARTBEAT.md":
      return buildHeartbeatDocContent();
    case "TOOLS.md":
      return buildToolsDocContent();
    case "SOUL.md":
      return buildSoulDocContent();
  }
}

function buildAgentsDocContent(): string {
  return renderMarkdown([
    "# AGENTS.md",
    "",
    "## Project Rules",
    "1. Query `kb/wiki` first, then fall back to `kb/raw` only when needed.",
    "2. Treat `kb/raw` as immutable source-of-truth; write derived knowledge into `kb/wiki`.",
    "3. Every multi-file `kb/wiki` change should follow plan -> draft -> apply discipline.",
    "4. Every new wiki page must be linked from an index or parent page.",
    "5. Record uncertainty explicitly as conflict or open question.",
    "6. Keep all write targets inside `kb/`.",
    "",
    "## Workspace Constraints",
    "1. Installer commands target only the explicit path provided by `--workspace`.",
    "2. The explicit workspace must resolve to the OpenClaw agent whose `id` is `llmwiki`; missing or ambiguous binding is fail-closed.",
    "3. Respect installer ownership tracked by `.llm-kb/openclaw-install.json`.",
    "",
    "## Fail-Closed Discipline",
    "1. Stop on ownership ambiguity, malformed state, or conflicting runtime config.",
    "2. Prefer `check` before mutation when llmwiki session-visible `kb_*` tools are uncertain.",
    "3. Use `--force` only when intentional overwrite risk is understood.",
  ]);
}

function buildHeartbeatDocContent(): string {
  return renderMarkdown([
    "# HEARTBEAT.md",
    "",
    "## Startup",
    "- [ ] Confirm OpenClaw CLI is available and config is readable.",
    "- [ ] Confirm every installer command includes explicit `--workspace` targeting bound to `llmwiki`.",
    "- [ ] Confirm MCP server `KB_ROOT` resolves to the intended external knowledge base.",
    "- [ ] Confirm llmwiki session-visible canonical `kb_*` tools are the primary success condition.",
    "",
    "## Execution",
    "- [ ] Query wiki pages first before reading raw sources.",
    "- [ ] Keep edits constrained to installer-owned paths and `kb/` write scope.",
    "- [ ] Treat standalone MCP reachability as secondary compatibility/debugging evidence, not the success contract.",
    "- [ ] Keep index/log linkage and uncertainty annotations explicit.",
    "",
    "## Wrap-Up",
    "- [ ] Re-run `check` when installer-managed artifacts were touched.",
    "- [ ] Report drift, unresolved risks, and any manual follow-up needed.",
    "- [ ] Preserve fail-closed posture instead of speculative auto-fixes.",
  ]);
}

function buildToolsDocContent(): string {
  const lines: string[] = [
    "# TOOLS.md",
    "",
    "## KB MCP Tools (11)",
  ];

  EXPECTED_KB_TOOL_NAMES.forEach((toolName, index) => {
    lines.push(`${index + 1}. \`${toolName}\` - ${KB_TOOL_SUMMARIES[toolName]}`);
  });

  lines.push("", "## Installer Commands (4)");

  INSTALLER_COMMANDS.forEach((commandName, index) => {
    lines.push(
      `${index + 1}. \`${commandName}\` - ${INSTALLER_COMMAND_SUMMARIES[commandName]}`
    );
  });

  return renderMarkdown(lines);
}

function buildSoulDocContent(): string {
  return renderMarkdown([
    "# SOUL.md",
    "",
    "## Core Principles",
    "1. Wiki-first operation: read and reason from `kb/wiki` before touching raw source files.",
    "2. External `KB_ROOT` is the runtime knowledge location; healthy install means `llmwiki` sessions can directly use canonical `kb_*` tools.",
    "3. Preserve conservative ownership boundaries for installer-managed artifacts.",
    "",
    "## Overwrite Principles",
    "1. `install` deterministically overwrites workspace-root docs (`AGENTS.md`, `HEARTBEAT.md`, `TOOLS.md`, `SOUL.md`).",
    "2. Skill, session-runtime, and MCP ownership conflicts remain fail-closed by default unless `--force` is explicit.",
    "",
    "## Repair Principles",
    "1. `repair` should rebuild only installer-owned state, including llmwiki session-visible runtime artifacts, and avoid speculative migration.",
    "2. Unknown ownership or ambiguous state should result in manual follow-up, not silent mutation.",
    "3. Re-homing to a new `KB_ROOT` is conservative and should require explicit operator intent.",
  ]);
}

function renderMarkdown(lines: readonly string[]): string {
  const raw = lines.join("\n").replace(/\r\n/g, "\n");
  return raw.endsWith("\n") ? raw : `${raw}\n`;
}
