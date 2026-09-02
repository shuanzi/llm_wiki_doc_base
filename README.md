# LLM Wiki Agent-First MVP

面向本地 Coding / General Agent 的持续编译型知识库：Agent 读取新资料后持续维护一个用户拥有的 Markdown Wiki，而不是每次查询都从原始文件重新拼装答案。

本实现基于四个边界：

1. **Durable Vault 是产品**：来源、证据、综合知识、领域配置和演进日志均为普通文件。
2. **Agent Skill 是操作协议**：规定 Orient、Ingest、Query、Promote、Reconcile 的语义与完成条件，不建立固定工作流引擎。
3. **Harness Binding 是可替换插头**：Codex、Claude Code、OpenClaw 的技能副本和启动说明位于独立工作区。
4. **Runtime Sidecar 是可删除加速层**：缓存、索引、锁和 Session 状态不进入 Vault。

## 目录

```text
llm-wiki-agent-first-mvp/       # Kit，可独立升级或删除
├── skills/llm-wiki/            # 公共 Agent Skill
├── src/llm_wiki/               # 极薄确定性工具
├── docs/                        # 架构、使用和测试说明
├── examples/demo-vault/         # Obsidian 可直接打开的示例
└── tests/                       # 自动化测试

~/vaults/my-wiki/               # Durable Vault
├── VAULT.md
├── profile/
├── sources/
├── wiki/
├── evidence/
├── logs/
└── .obsidian/

~/agent-workspaces/my-wiki/      # Detachable Binding Workspace
├── AGENTS.md                    # Codex / OpenClaw 薄绑定
├── CLAUDE.md                    # Claude Code 薄绑定
├── .agents/skills/llm-wiki/    # Codex Skill
├── .claude/skills/llm-wiki/    # Claude Code Skill
├── skills/llm-wiki/            # OpenClaw Skill
├── .llm-wiki-binding/          # 绑定元数据与可删除 runtime
└── vault -> ~/vaults/my-wiki   # 默认符号链接
```

## 快速开始

无需安装即可从解压目录运行：

```bash
cd llm-wiki-agent-first-mvp

# 1. 创建完全独立的 Markdown Vault
./bin/llm-wiki init ~/vaults/ai4s-wiki \
  --name "AI for Science Wiki" \
  --language zh-CN

# 2. 可选：确定性地复制并哈希注册来源；语义摄取仍由 Agent 完成
./bin/llm-wiki register-source \
  --vault ~/vaults/ai4s-wiki \
  ~/Downloads/a-paper.md

# 3. 创建独立的 Harness Binding Workspace
./bin/llm-wiki attach \
  --vault ~/vaults/ai4s-wiki \
  --workspace ~/agent-workspaces/ai4s-wiki \
  --harness all

# 4. 检查边界和完整性
./bin/llm-wiki doctor ~/vaults/ai4s-wiki --strict
./bin/llm-wiki doctor ~/agent-workspaces/ai4s-wiki --strict

# Kit 升级后，只刷新已有 Binding Workspace
./bin/llm-wiki update --workspace ~/agent-workspaces/ai4s-wiki
```

需要每 30 分钟扫描一个 drop folder 并自动调起 Codex 执行 Ingest 时，请配置系统调度器运行一次性扫描任务：

```bash
llm-wiki watch /absolute/path/to/drop-folder \
  --workspace /absolute/path/to/binding \
  --harness codex \
  --markdown-only \
  --recursive \
  --settle-seconds 60 \
  --json
```

Watcher 默认只处理大小写不敏感的 `.md` 和 `.markdown` 文件；只有明确需要恢复旧的全文件行为时才传 `--all-files`。

完整的前置条件、恢复语义和 macOS/Linux/Windows 调度示例见 [周期扫描与自动 Ingest](docs/WATCHER.md)。

随后从 Binding Workspace 启动本地 Agent。Skill 发现与 Vault 文件权限是两件事；当 Agent 的 Sandbox 不允许访问工作区外部路径时，需要显式授权真实 Vault 路径：

```bash
cd ~/agent-workspaces/ai4s-wiki

# Codex / Claude Code 在需要时授予外部 Vault 目录权限
codex --add-dir ~/vaults/ai4s-wiki
claude --add-dir ~/vaults/ai4s-wiki

# OpenClaw：在当前 workspace/sandbox 配置中允许或挂载该 Vault 路径
```

可直接使用自然语言：

```text
先了解这个知识库，说明主要范围、最近变化和未解决问题。

将 vault/sources/inbox 中的新资料摄取进 Wiki。不要只生成摘要，检查并更新已有概念、实体、分析、索引和证据关系。

基于 Wiki 比较方案 A 与方案 B，区分来源事实、综合判断和仍未验证的推断。

检查知识库中的冲突、陈旧结论、孤立页面、缺失来源和研究缺口；安全的小修复直接完成，高影响语义裁决先给出选项。
```

## 安装为本地命令

项目无第三方运行依赖：

```bash
python3 -m pip install --no-deps --no-build-isolation .
llm-wiki --version
```

## CLI

| 命令 | 作用 | 是否替代 Agent |
|---|---|---:|
| `init` | 创建标准、Obsidian-compatible Vault | 否 |
| `register-source` | 复制、哈希并生成 Source Record Stub | 否；不做语义摄取 |
| `watch` | 全量扫描文件夹、可靠注册并调起 Codex 完成 Ingest | 通过外部 Agent 执行 |
| `attach` | 安装公共 Skill 和薄 Harness 指令 | 否 |
| `update` | 从当前 Kit 事务式刷新已有 Binding 的托管 Skill 与说明 | 否 |
| `detach` | 移除生成的 Harness 产物，保留 Vault | 否 |
| `doctor` | 检查结构、来源哈希、绑定和边界 | 否 |
| `status` | 查看 Binding 元数据 | 否 |

### 分别绑定

```bash
./bin/llm-wiki attach --vault /vault --workspace /binding --harness codex
./bin/llm-wiki attach --vault /vault --workspace /binding --harness claude
./bin/llm-wiki attach --vault /vault --workspace /binding --harness openclaw
```

`attach` 用于首次绑定或显式改变绑定选项。默认复制 Skill，便于 Kit 与 Binding 独立移动；可用 `--skill-mode symlink` 让 Binding 跟随当前 Kit。默认通过 `binding/vault` 符号链接暴露 Vault；不适合符号链接的环境可用 `--vault-mode pointer`。符号链接和绝对指针都不会绕过 Agent 自身的 Sandbox，必要时仍需通过 `--add-dir` 或相应 workspace/sandbox 配置授权真实 Vault 路径。

### 更新已有 Workspace

```bash
./bin/llm-wiki update --workspace /binding
```

`update` 只读取既有 Binding，不接受 Vault、Harness 或模式变更。它刷新所有已记录 Harness 的 Skill 和托管说明，保留用户文本与 Vault 链接；copy Skill 有本地漂移或旧 marker 无 fingerprint 时，先备份到 `.llm-wiki-binding/runtime/update-backups/`。重复运行且无差异时返回 `already-current`，不改时间戳。

### 导入代码仓库

从 Binding Workspace 调用 attached Skill 内脚本，例如 Codex：

```bash
python3 .agents/skills/llm-wiki/scripts/register_repository.py \
  https://github.com/owner/project \
  --json
```

脚本只把项目名称、规范化链接与根 README 合成为 Source，不保存或分析源码、目录树、commit 或 Git metadata。注册后仍由 Agent 按 `llm-wiki` Skill 完成 Entity、Concept、限制、交叉引用、Index、Knowledge Map、Source Record 和日志的语义摄取。

### 解绑

```bash
./bin/llm-wiki detach --workspace /binding --harness claude
./bin/llm-wiki detach --workspace /binding --harness all
```

解绑只删除带有 Kit 管理标识的 Skill、托管说明、绑定元数据和 Vault 链接。已有 `AGENTS.md`、`CLAUDE.md` 和 `.gitignore` 中的用户内容会保留。

## Agent-first 与硬约束边界

代码只保护少量安全不变量：

- Vault 与 Binding 不能是同一路径或父子目录；
- 已注册 Source 通过 SHA-256 检测静默改写；
- Skill 安装目标不会在无 `--force` 时覆盖非托管目录或符号链接；
- 失效 Binding 元数据不会导致真实 `binding/vault/` 用户目录被递归删除；
- 生成文件、Skill 父目录、Source 和必需 Vault 路径均检查符号链接逃逸；
- 解绑不会删除非托管 Skill 或 Durable Vault；
- Doctor 检查路径逃逸、配置可解析性、来源哈希和 Harness 泄漏。

以下内容不由脚本硬编码：页面粒度、主题分类、一次 Ingest 修改多少页、标签数量、分析结构、冲突语义裁决。它们由 Agent 按 [Skill](skills/llm-wiki/SKILL.md)、Vault Profile 和用户反馈共同演进。

## Obsidian

直接用 Obsidian 打开 Vault 根目录。初始配置将新文件放入 `sources/inbox/`、附件放入 `sources/assets/`、模板放在 `wiki/_templates/`。核心内容使用 UTF-8 Markdown、YAML frontmatter 和相对链接；不依赖社区插件、Dataview 数据库或 Obsidian 才能读取。

## 测试

```bash
./scripts/run-tests.sh
```

测试覆盖：

- Vault 初始化、UTF-8 和 Obsidian 配置；
- Source 注册、幂等、哈希篡改检测；
- 仓库 URL 归一、根 README 注册、离线幂等与无源码持久化；
- Codex / Claude Code / OpenClaw 三种目录绑定；
- 托管块幂等、用户指令保留、部分与完整解绑；
- Workspace update 的 drift 备份、symlink 重指向、事务回滚与幂等；
- Pointer / Symlink 两种 Vault 暴露方式；
- Vault 独立复制迁移和 Binding 重新指向；
- 非托管目录/符号链接防覆盖、陈旧绑定下的用户目录保护；
- 异常 JSON、非 UTF-8、路径逃逸和模式漂移的容错检测；
- Kit/Skill 一致性、CLI 子进程、无运行依赖安装和端到端验收。

详细结果见 [docs/TEST_REPORT.md](docs/TEST_REPORT.md)。

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [使用手册](docs/USER_GUIDE.md)
- [Harness 兼容与 Attach 语义](docs/HARNESS_COMPATIBILITY.md)
- [测试策略](docs/TESTING.md)
- [安全与恢复边界](docs/SAFETY_AND_RECOVERY.md)
- [设计裁决](docs/DESIGN_DECISIONS.md)
- [参考资料](docs/REFERENCES.md)

## 当前范围

这是一个本地、文件系统优先的 MVP。它没有内置模型调用、向量数据库、后台 Watcher、Web UI 或 MCP Server；这些都可作为可删除 Sidecar 后续加入，而不改变 Vault 作为唯一持久知识源的原则。
