import * as fs from "fs";
import * as path from "path";

import { sha256 } from "../utils/hash";
import type {
  InstallerSkillInstallationMetadata,
  InstallerSkillSourceProvenance,
} from "./types";

export const OPENCLAW_SKILL_NAMES = ["kb_ingest", "kb_query", "kb_lint"] as const;
export type OpenClawSkillName = (typeof OPENCLAW_SKILL_NAMES)[number];

const OPENCLAW_SKILL_SOURCE_PATHS: Record<OpenClawSkillName, string> = {
  kb_ingest: "skills/kb_ingest/SKILL.md",
  kb_query: "skills/kb_query/SKILL.md",
  kb_lint: "skills/kb_lint/SKILL.md",
};

export interface RenderOpenClawSkillOptions {
  repoRoot: string;
  skillName: OpenClawSkillName;
}

export interface RenderedOpenClawSkill {
  skillName: OpenClawSkillName;
  sourceRelativePath: string;
  sourceContentHash: string;
  installRelativeDir: string;
  installRelativeFile: string;
  content: string;
  contentHash: string;
}

export interface InstallOpenClawSkillsOptions {
  workspacePath: string;
  repoRoot: string;
  installedAt?: string;
}

export function renderOpenClawSkill(
  options: RenderOpenClawSkillOptions
): RenderedOpenClawSkill {
  const repoRoot = path.resolve(options.repoRoot);
  const sourceRelativePath = OPENCLAW_SKILL_SOURCE_PATHS[options.skillName];
  const sourcePath = path.resolve(repoRoot, sourceRelativePath);
  const sourceContent = fs.readFileSync(sourcePath, "utf8");
  const sourceContentHash = sha256(normalizeTextFile(sourceContent));
  const content = buildAdaptedSkillContent(options.skillName);
  const contentHash = sha256(content);
  assertSkillContentPolicy(content, options.skillName);

  const installRelativeDir = path.posix.join("skills", options.skillName);
  const installRelativeFile = path.posix.join(installRelativeDir, "SKILL.md");

  return {
    skillName: options.skillName,
    sourceRelativePath,
    sourceContentHash,
    installRelativeDir,
    installRelativeFile,
    content,
    contentHash,
  };
}

export function renderAllOpenClawSkills(repoRoot: string): RenderedOpenClawSkill[] {
  return OPENCLAW_SKILL_NAMES.map((skillName) =>
    renderOpenClawSkill({ repoRoot, skillName })
  );
}

export function installOpenClawSkills(
  options: InstallOpenClawSkillsOptions
): InstallerSkillInstallationMetadata[] {
  const workspacePath = path.resolve(options.workspacePath);
  const installedAt = options.installedAt ?? new Date().toISOString();
  const renderedSkills = renderAllOpenClawSkills(options.repoRoot);
  const installedSkills: InstallerSkillInstallationMetadata[] = [];

  for (const rendered of renderedSkills) {
    const installDir = path.resolve(workspacePath, rendered.installRelativeDir);
    const skillFile = path.resolve(workspacePath, rendered.installRelativeFile);
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(skillFile, rendered.content, "utf8");

    const sourceProvenance: InstallerSkillSourceProvenance = {
      sourceKind: "repo-skill-template",
      sourceSkillName: rendered.skillName,
      sourceRelativePath: rendered.sourceRelativePath,
      sourceContentHash: rendered.sourceContentHash,
    };

    installedSkills.push({
      skillName: rendered.skillName,
      installDir,
      skillFile,
      contentHash: rendered.contentHash,
      installedAt,
      variantSet: "openclaw-adapted-v1",
      sourceProvenance,
    });
  }

  installedSkills.sort((left, right) => left.skillName.localeCompare(right.skillName));
  return installedSkills;
}

function buildAdaptedSkillContent(skillName: OpenClawSkillName): string {
  switch (skillName) {
    case "kb_ingest":
      return buildIngestSkillContent();
    case "kb_query":
      return buildQuerySkillContent();
    case "kb_lint":
      return buildLintSkillContent();
  }
}

function buildIngestSkillContent(): string {
  return renderSkillDocument(
    "kb_ingest",
    "将新源文件整合到知识库中，创建/更新多个 wiki 页面（OpenClaw 外部 KB 适配）",
    [
      "当用户要求添加新源、更新知识库、或将新材料整合到 wiki 时：",
      "",
      "### 第 1 步：注册与阅读",
      "",
      "1. `kb_source_add(file_path)` 获取 source_id、file_name",
      "2. `kb_read_source(source_id)` 读取原文",
      "3. 理解核心内容、关键实体和概念",
      "",
      "### 第 2 步：分析与规划（先向用户报告）",
      "",
      "- 文档概述（2-3 句话）",
      "- 将创建的新页面（sources/entity/concept）",
      "- 将更新的已有页面（通过 `kb_search_wiki` 找到并说明原因）",
      "- 发现的矛盾或待确认点",
      "",
      "等用户确认后继续。",
      "",
      "### 第 3 步：写入源摘要页",
      "",
      "使用 `kb_write_page` 创建 `wiki/sources/{source_id}.md`，并遵守 frontmatter 约定。",
      "内容包含：文档概述、关键要点、核心论断、关联页面和 `[[wikilinks]]`。",
      "",
      "### 第 4 步：创建/更新 Entity 页面",
      "",
      "1. `kb_search_wiki(query)` 检查是否已有页面",
      "2. 已有页面：`kb_read_page` + `kb_update_section(append: true)` 追加新信息",
      "3. 新实体：`kb_write_page` 创建 `wiki/entities/{id}.md`（active 或 stub）",
      "4. 检查 `kb_write_page` 返回的 warnings 并向用户说明",
      "",
      "### 第 5 步：创建/更新 Concept 页面",
      "",
      "流程同 Entity：搜索、读取、追加更新或创建 `wiki/concepts/{id}.md`。",
      "",
      "### 第 6 步：更新索引和日志",
      "",
      "1. 使用 `kb_ensure_entry` 维护 `wiki/index.md` 的 Sources/Entities/Concepts 条目",
      "2. 使用 `kb_ensure_entry` 在 `wiki/log.md` 追加本次 ingest 日志",
      "",
      "### 约束",
      "",
      "- 当前 OpenClaw 成功契约是 `llmwiki` 会话内可直接使用 canonical `kb_*` 工具；若工具缺失，先运行 installer `check`/`repair`，不要把仅有 MCP 配置视为可用。",
      "- 仅通过 KB MCP 工具读写知识库，不使用宿主机文件读取 `kb/...` 路径。",
      "- 默认不执行 Git 提交步骤；如需提交由用户在其仓库流程中显式触发。",
      "- 遵守 `schema/wiki-conventions.md` 的内容与链接约定。",
    ]
  );
}

function buildQuerySkillContent(): string {
  return renderSkillDocument(
    "kb_query",
    "基于 wiki 知识层回答问题，高价值回答可沉淀为分析页（OpenClaw 外部 KB 适配）",
    [
      "当用户基于知识库提问时：",
      "",
      "### 回答问题",
      "",
      "1. `kb_search_wiki(query)` 搜索相关页面（可组合关键词与过滤条件）",
      "2. `kb_read_page` 精读关键页面（通常 3-5 篇）",
      "3. 综合回答并引用具体页面：`[[页面名]]`",
      "4. 缺少关键信息时明确说明，不推测",
      "",
      "### 回答原则",
      "",
      "- wiki 优先：先用 wiki 层整合知识，再引用必要 source 页",
      "- 明确溯源：指出依据页面",
      "- 诚实缺失：信息不足时建议后续 ingest",
      "- 结构化输出：对比问题优先表格或分项结论",
      "",
      "### 查询日志（meaningful query）",
      "",
      "满足以下条件时写 `wiki/log.md`：",
      "- 使用过 `kb_search_wiki`",
      "- 使用 `kb_read_page` 精读至少 2 个不同页面",
      "- 产出综合性结论并给出引用",
      "",
      "记录方式：`kb_ensure_entry` 追加 query 日志，并使用唯一 `run_id` 防重。",
      "",
      "### 结果回写（可选）",
      "",
      "当回答具备长期价值时，可在用户同意后：",
      "1. `kb_write_page` 写入 `wiki/analyses/{topic_id}.md`",
      "2. `kb_ensure_entry` 更新 `wiki/index.md` 的 Analyses 条目",
      "3. `kb_ensure_entry` 记录同一 run_id 的 query 日志",
      "",
      "### 约束",
      "",
      "- 当前 OpenClaw 成功契约是 `llmwiki` 会话内可直接使用 canonical `kb_*` 工具；若工具缺失，先运行 installer `check`/`repair`，不要把仅有 MCP 配置视为可用。",
      "- 仅通过 KB MCP 工具访问知识库内容，不使用宿主机文件读取 `kb/...` 路径。",
      "- 默认不执行 Git 提交步骤；如需提交由用户显式决定。",
      "- 遵守 `schema/wiki-conventions.md`。",
    ]
  );
}

function buildLintSkillContent(): string {
  return renderSkillDocument(
    "kb_lint",
    "检查知识库健康度并给出可执行修复建议（OpenClaw 外部 KB 适配）",
    [
      "当用户要求检查知识库质量、健康度或查找问题时：",
      "",
      "### 第 1 步：运行内置 lint",
      "",
      "1. 先执行 `kb_rebuild_index`，确保索引与 wiki 同步",
      "2. 执行 `kb_run_lint({ include_semantic: true })` 获取结构化报告",
      "3. 按严重性整理结果：error / warning / suggestion",
      "",
      "### 第 2 步：针对问题做证据复核",
      "",
      "根据 lint 报告中的页面线索，使用：",
      "- `kb_search_wiki` 定位相关页面",
      "- `kb_read_page` 复核页面内容和链接",
      "- `kb_ensure_entry` / `kb_update_section` / `kb_write_page` 执行经用户确认的修复",
      "",
      "### 第 3 步：结构修复（仅在用户同意时）",
      "",
      "1. 先运行 `kb_repair({ dry_run: true })` 预览改动",
      "2. 用户确认后运行 `kb_repair({ dry_run: false })`",
      "3. 说明其仅修复结构性工件，不直接改写业务内容页",
      "",
      "### 第 4 步：记录 lint 日志",
      "",
      "完成完整 lint pass 后，用 `kb_ensure_entry` 追加 `wiki/log.md`：",
      "- 记录 run_id、一句话结论、错误/警告/建议数量",
      "- 若产出 report 页面，一并记录 report 链接",
      "",
      "### 约束",
      "",
      "- 当前 OpenClaw 成功契约是 `llmwiki` 会话内可直接使用 canonical `kb_*` 工具；若工具缺失，先运行 installer `check`/`repair`，不要把仅有 MCP 配置视为可用。",
      "- 不使用宿主机文件读取工具直接访问知识库目录内容。",
      "- 默认不执行 Git 提交步骤；如需提交由用户显式决定。",
      "- 修复策略保持保守：优先标注与建议，不擅自改写结论。",
    ]
  );
}

function renderSkillDocument(
  name: OpenClawSkillName,
  description: string,
  bodyLines: readonly string[]
): string {
  return normalizeTextFile(
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "user-invocable: true",
      "---",
      "",
      ...bodyLines,
      "",
    ].join("\n")
  );
}

function assertSkillContentPolicy(content: string, skillName: OpenClawSkillName): void {
  if (/\bkb_commit\b/u.test(content)) {
    throw new Error(
      `Adapted skill "${skillName}" violates policy: automatic kb_commit instructions are not allowed.`
    );
  }

  if (/Read\s+工具[^\n]*\bkb\//u.test(content) || /host\s+file\s+read[^\n]*\bkb\//iu.test(content)) {
    throw new Error(
      `Adapted skill "${skillName}" violates policy: host file reads under kb/... are not allowed.`
    );
  }
}

function normalizeTextFile(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}
