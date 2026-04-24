import { sha256 } from "../utils/hash";
import { EXPECTED_KB_TOOL_NAMES } from "./mcp-probe";
import {
  INSTALLER_COMMANDS,
  INSTALLER_WORKSPACE_DOC_NAMES,
  type InstallerCommandName,
  type InstallerWorkspaceDocName,
} from "./types";

const KB_TOOL_SUMMARIES: Record<(typeof EXPECTED_KB_TOOL_NAMES)[number], string> = {
  kb_source_add: "登记原始资料到 manifest（仅登记，不改写 raw 内容）。",
  kb_read_source: "按 source_id 读取 raw 材料。",
  kb_write_page: "整页写入/替换 wiki 页面，并校验 frontmatter。",
  kb_update_section: "按标题更新或追加 markdown section。",
  kb_ensure_entry: "以 dedup_key 幂等维护索引/日志条目。",
  kb_search_wiki: "在 wiki 索引中做检索（query/filter/link resolution）。",
  kb_read_page: "按路径或 page id 读取 wiki 页面。",
  kb_commit: "对 `KB_ROOT` 下改动做 git 提交（高风险，需显式用户意图）。",
  kb_rebuild_index: "从 `wiki` 重建 `state/cache/page-index.json`。",
  kb_run_lint: "执行确定性 + 语义 lint（不直接改内容）。",
  kb_repair: "修复 KB 结构性工件，支持 dry_run。",
};

const INSTALLER_COMMAND_SUMMARIES: Record<InstallerCommandName, string> = {
  install:
    "落地 installer-owned 工件，确保 installer-configured OpenClaw agent 会话可见 canonical `kb_*` 工具，并写入 manifest/MCP 状态。",
  check:
    "校验 installer-configured OpenClaw agent 会话可见 `kb_*`、ownership、运行时一致性与漂移。",
  repair:
    "在可识别 ownership 前提下，保守修复 installer-owned 运行时、文档、skills 与 MCP 状态。",
  uninstall:
    "仅在 ownership 可验证时，删除 installer-owned 运行时工件与 MCP 注册。",
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
    "## KB_ROOT 与层级约束",
    "1. `KB_ROOT` 是已安装的 `kb` 目录本体，而不是 `<KB_ROOT>/kb/...` 或 workspace-local `kb/`。",
    "2. 知识树固定在 `<KB_ROOT>/raw`、`<KB_ROOT>/wiki`、`<KB_ROOT>/schema`、`<KB_ROOT>/state`。",
    "3. 工具路径如 `wiki/index.md`、`wiki/log.md` 均相对 `KB_ROOT` 解析。",
    "4. `raw` 是原始材料层（不可改写）；`wiki` 是可编辑知识层；`schema` 是约定/校验层。",
    "5. 这些 workspace docs 与相关 skills 共同构成 `schema/guidance layer`，用于约束 Agent 维护 `wiki` 的运行规则。",
    "",
    "## Wiki-First 工作规则",
    "1. 查询优先读取 `wiki`，仅在缺失证据时回退到 `raw`。",
    "2. 高价值 query 输出应作为 `<KB_ROOT>/wiki/analyses/` 候选，并补充交叉链接。",
    "3. 任意 ingest 或新建页面都要维护 `wiki/index.md`（或父级/index 页面）与 `wiki/log.md`。",
    "4. 多文件 `wiki` 改动必须遵循 plan -> draft -> apply。",
    "5. 不确定性、矛盾、冲突与开放问题必须显式写出，不允许隐式吞掉。",
    "",
    "## 外部边界与 Fail-Closed",
    "1. 所有写入目标必须落在外部 `KB_ROOT` 边界内。",
    "2. Installer 命令仅作用于显式 `--workspace`，并使用显式或默认的 `--agent-id` 选择 installer-configured OpenClaw agent（默认 `llmwiki`）；缺失绑定、歧义绑定或不匹配时 fail-closed。",
    "3. `check` 以 installer-configured OpenClaw agent session-visible canonical `kb_*` 可用性为主判据；仅保存 MCP 配置不足以代表可用。",
    "4. ownership 不明、运行时状态冲突或结构损坏时立即停止，先人工确认再继续。",
    "",
    "## Ownership 记录",
    "1. Installer ownership 以 `.llm-kb/openclaw-install.json` 与相关 hash/state 为准。",
    "2. `--force` 仅在明确覆盖风险并获得显式操作意图时使用。",
  ]);
}

function buildHeartbeatDocContent(): string {
  return renderMarkdown([
    "# HEARTBEAT.md",
    "",
    "## 启动",
    "- [ ] 确认 OpenClaw CLI 可用且配置可读。",
    "- [ ] 确认命令包含显式 `--workspace` 与目标 `--agent-id`（默认 `llmwiki`）。",
    "- [ ] 确认 `KB_ROOT` 指向已安装 `kb` 目录本体（`<KB_ROOT>/raw|wiki|schema|state`）。",
    "- [ ] 明确本次成功标准是 installer-configured OpenClaw agent session-visible canonical `kb_*`，不是“配置文件里有 MCP”。",
    "",
    "## 执行",
    "- [ ] 严格 wiki-first：先查 `wiki`，再按需读 `raw`。",
    "- [ ] ingest/写入时同步维护 `wiki/index.md`（或父级/index）与 `wiki/log.md`。",
    "- [ ] 执行 `kb_run_lint` 做质量检查；必要时再 `kb_rebuild_index` / `kb_repair`，并保留审计记录。",
    "- [ ] 仅在外部 `KB_ROOT` 与 installer-owned 路径写入，禁止写到 workspace-local `kb/`。",
    "- [ ] standalone MCP 连通性只作为兼容/调试信号，不是 OpenClaw 可用性成功契约。",
    "- [ ] 对不确定、矛盾、冲突或待确认项做显式标注。",
    "",
    "## 收尾",
    "- [ ] 变更 installer-managed 工件后重新执行 `check`。",
    "- [ ] 记录 drift、未决风险与人工 follow-up。",
    "- [ ] 出现 ownership 歧义或运行时状态异常时 fail-closed，禁止猜测性修复。",
  ]);
}

function buildToolsDocContent(): string {
  const lines: string[] = [
    "# TOOLS.md",
    "",
    "## KB MCP Tools (11)",
    "所有 canonical `kb_*` tools 都读写当前安装绑定的 external `KB_ROOT`，工具路径相对该目录解析。",
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

  lines.push(
    "",
    "## 实战工作流",
    "1. 查询：优先 `kb_search_wiki` + `kb_read_page`；证据不足时再 `kb_read_source`。",
    "2. ingest/写入：`kb_source_add` -> `kb_read_source` -> `kb_write_page`/`kb_update_section`。",
    "3. 索引与日志：完成页面落盘后，用 `kb_ensure_entry` 维护 `wiki/index.md` 与 `wiki/log.md`。",
    "4. 质量与修复：先 `kb_run_lint`，必要时 `kb_rebuild_index` 或 `kb_repair`，并保留 dry_run 审核。",
    "5. installer 生命周期：`install/check/repair/uninstall` 的主判据是 installer-configured OpenClaw agent 会话可见 canonical `kb_*`。",
    "6. `kb_commit` 属于高风险动作：仅在用户显式要求提交、且当前 workflow 明确需要时执行。",
    "7. 仅保存 MCP 配置不足以证明 OpenClaw 可用；standalone MCP 只用于兼容性/调试排障。",
  );

  return renderMarkdown(lines);
}

function buildSoulDocContent(): string {
  return renderMarkdown([
    "# SOUL.md",
    "",
    "## 持续使命",
    "1. 使命是长期维护可演化 wiki：在同一 `KB_ROOT` 中持续沉淀、复用并校验知识。",
    "2. 分工：人类负责目标与裁决，Agent 负责检索、编译、交叉链接与一致性维护。",
    "3. 对 raw 材料与高价值 query 输出进行增量编译，优先补到 `wiki` 并建立可追溯链接。",
    "4. 外部 `KB_ROOT` 是唯一知识写入边界，成功安装以 installer-configured OpenClaw agent session-visible canonical `kb_*` 为准。",
    "",
    "## 一致性与保守所有权",
    "1. `install` 会确定性覆盖 workspace-root 文档（`AGENTS.md`、`HEARTBEAT.md`、`TOOLS.md`、`SOUL.md`）。",
    "2. skill、session runtime、MCP 的 ownership 冲突默认 fail-closed，除非显式 `--force`。",
    "3. 仅保存 MCP 配置不能证明可用性；standalone MCP 连通性只是兼容/调试路径。",
    "",
    "## 修复原则",
    "1. `repair` 只重建 installer-owned 状态（含 installer-configured OpenClaw agent session-visible 运行时工件），不做猜测性迁移。",
    "2. ownership 未知、状态歧义、运行时冲突时失败即停并升级人工处理。",
    "3. 迁移到新的 `KB_ROOT` 属于保守操作，必须有显式操作者意图。",
  ]);
}

function renderMarkdown(lines: readonly string[]): string {
  const raw = lines.join("\n").replace(/\r\n/g, "\n");
  return raw.endsWith("\n") ? raw : `${raw}\n`;
}
