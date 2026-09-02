# 架构设计

## 1. 目标

构建一套面向本地 Agent 的 LLM Wiki，使知识处理从“查询时临时检索”转为“持续摄取、综合和维护”。系统应在不依赖特定 Agent Runtime 的前提下支持 Codex、Claude Code、OpenClaw，并允许用户用 Obsidian 直接浏览和修改全部持久知识。

## 2. 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Codex / Claude Code / OpenClaw                              │
│ 原生文件读取、搜索、编辑、Shell 和可选 Web/MCP 能力          │
└──────────────────────────┬──────────────────────────────────┘
                           │ Harness-specific discovery
┌──────────────────────────▼──────────────────────────────────┐
│ Detachable Binding Workspace                               │
│ AGENTS.md / CLAUDE.md / skill copies / binding.json         │
│ runtime cache / optional search index / vault reference     │
└──────────────────────────┬──────────────────────────────────┘
                           │ reads shared Agent Skill
┌──────────────────────────▼──────────────────────────────────┐
│ llm-wiki Agent Skill                                       │
│ Orient / Ingest / Query / Promote / Reconcile               │
│ 目标、语义、不变量、完成条件、变更权限                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ file operations
┌──────────────────────────▼──────────────────────────────────┐
│ Durable Markdown Vault                                     │
│ Sources / Evidence / Wiki / Profile / Operations Log        │
│ Obsidian-compatible, user-owned, independently portable     │
└─────────────────────────────────────────────────────────────┘
```

核心表达：**Vault 是产品，Skill 是协议，Harness 是插头，Runtime 是加速器。**

## 3. 物理边界

### 3.1 Kit

Kit 是本 ZIP 解压后的项目，包含公共 Skill、模板、CLI 和测试。它不保存某个 Vault 的知识，也不保存 Agent Session。

### 3.2 Durable Vault

Vault 是可长期版本化、备份、复制和离线读取的资产：

```text
vault/
├── VAULT.md                  # Agent / 人的共同入口
├── profile/                  # 本库语义、约定、持久化权限
├── sources/
│   ├── inbox/                # 待处理
│   ├── library/              # 已注册、不可静默覆盖
│   └── assets/
├── wiki/
│   ├── INDEX.md
│   ├── OVERVIEW.md
│   ├── maps/
│   ├── sources/
│   ├── concepts/
│   ├── entities/
│   ├── analyses/
│   ├── questions/
│   ├── decisions/
│   └── _templates/
├── evidence/                 # 有长期复查价值的衍生证据
├── logs/operations.md        # Append-oriented 演进史
└── .obsidian/                # 可删除的编辑器配置
```

`profile/` 跟随 Vault，因为它描述的是“这个知识库的领域语义和授权”，不是某个 Agent 的配置。

### 3.3 Binding Workspace

绑定工作区只承载工具接入：

```text
binding/
├── AGENTS.md
├── CLAUDE.md
├── .agents/skills/llm-wiki/
├── .claude/skills/llm-wiki/
├── skills/llm-wiki/
├── .llm-wiki-binding/
│   ├── binding.json
│   └── runtime/
└── vault -> /absolute/path/to/vault
```

Binding 与 Vault 必须是不同且互不包含的根目录。这样可以删除、重建或切换 Binding，而无需修改知识资产。Binding 中的 `vault` 链接只提供稳定入口，不授予 Sandbox 权限；真实 Vault 位于 Agent 默认可写根之外时，应通过 Harness 的目录授权或挂载配置开放。

## 4. Agent 工作链路

```text
用户任务
  │
  ├─ 普通聊天且无 Vault 工作 ───────────────► 不触发 llm-wiki
  │
  └─ Vault 相关任务
       │
       ▼
  Harness 发现 skill 名称和描述
       │
       ▼
  Skill 定位 binding.json / vault/VAULT.md
       │
       ▼
  Orient：Profile → Overview → Index → Map → Recent Log
       │
       ├─ Ingest：Source → Claims → Existing pages → Conflict → Index/Log
       ├─ Query：Wiki → Source Record/Evidence → Raw Source → Answer
       ├─ Promote：Conversation result → Existing/new durable page
       └─ Reconcile：Findings → safe fixes / user semantic decisions
```

Skill 不要求唯一执行步骤，只要求 closure conditions。Agent 可以根据 Vault 规模使用原生搜索、`grep`、可选全文检索或未来 MCP，但搜索结果始终是派生信息。

## 5. 持久化判定

默认可持久化：

- 新注册来源及来源身份；
- 对现有知识的有证据增量；
- 可复用、稳定、有结构价值的分析；
- 冲突、未知和研究问题；
- 用户作出的语义/结构裁决。

默认不持久化：

- Session 计划、工具输出和缓存；
- 一次性格式转换；
- 未标注且无证据的猜测；
- 与 Vault 范围无关的聊天。

高影响变更由 Agent 先给出影响、选项和恢复方式，再请求用户决定。

## 6. 确定性工具职责

`llm-wiki` CLI 不执行知识综合。它仅提供：

- `init`：模板实例化和机器可发现 Profile；
- `register-source`：复制、内容哈希、Source Record Stub 和日志；
- `watch`：执行一次全量目录扫描、维护 Binding Runtime 队列，并通过 Codex Adapter 按 Source 串行调起独立 Agent；Agent 只写临时 Vault 副本，通过 closure probe 后由 CLI 事务性发布，知识综合仍由 Agent 按 Skill 完成；
- `attach`：Skill 复制/链接、薄指令和 Vault 引用；
- `update`：按既有 Binding 事务式刷新托管 Skill/说明并备份 copy drift；
- `detach`：安全移除托管 Harness；
- `doctor`：检查可恢复性和边界；
- `status`：读取 Binding 元数据。

这让系统既 Agent-first，又对不可逆边界保持最小确定性保护。

## 7. 后续扩展位

可插拔但不纳入 MVP 核心：

- `runtime/search/`：ripgrep、SQLite FTS、BM25、QMD、Vector Index；
- MCP Search Server；
- 原生文件事件 watcher（当前实现采用调度器驱动、默认 Markdown-only 的全量扫描）；
- Git-based review UI；
- 多 Agent 并发编辑的锁/claim sidecar；
- 页面图谱、LSP、rename-aware 工具；
- Agent eval runner。

所有扩展只能引用 Vault，不得成为唯一知识源。
