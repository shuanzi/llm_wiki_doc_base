# Wiki Contract

## 1. 产品边界

LLM Wiki 不是聊天记录、向量数据库或某个 Agent 的私有记忆。它是用户拥有的、可离线读取和迁移的 Markdown 知识库。

逻辑分层：

| 层 | 典型位置 | 可否删除重建 | 是否知识源 |
|---|---|---:|---:|
| Raw / Registered Sources | `sources/` | 否 | 是 |
| Synthesized Wiki | `wiki/` | 否 | 是 |
| Evidence / Derivations | `evidence/` | 视内容而定 | 是 |
| Vault Profile | `profile/` | 否 | 是，定义本库语义 |
| Operation Log | `logs/` | 否 | 是，记录演进历史 |
| Agent Skill | Binding 的技能目录 | 是 | 否 |
| Harness Instructions | `AGENTS.md` / `CLAUDE.md` 等 | 是 | 否 |
| Runtime Sidecar | Binding 的 runtime/cache/index | 是 | 否 |

## 2. Source of truth

- 事实证据的源头是已注册 Source、Evidence 和可追溯的外部引用。
- 当前综合结论的源头是 Wiki 页面，而不是某次聊天回复。
- Agent 的会话状态、模型记忆、数据库索引和搜索缓存都不能成为唯一事实来源。
- 移动 Binding、替换 Agent 或删除 Runtime 后，Vault 仍应完整可读。

## 3. Agent-first 原则

Contract 规定目标、边界和完成条件，不规定唯一执行序列。Agent 可以按任务需要选择文件搜索、全文检索、脚本或其他工具，但不能把某一工具的派生状态写成唯一知识。

## 4. 可恢复性

- 所有大规模重构应可通过 Git、快照或文件级备份恢复。
- 不静默删除来源、证据或承载主结论的页面。
- 重命名页面时同步更新入链和索引。
- 冲突不应通过覆盖旧观点“解决”；保留来源、时间和裁决依据。

## 5. 最小硬约束

确定性工具只保护以下边界：

- 初始化出完整、可发现的 Vault；
- Source 注册后可用哈希检查是否被改写；
- Harness 与 Vault 的物理边界；
- Skill 绑定路径与可卸载性；
- 关键配置可解析、引用路径不逃逸。
- 普通 Wiki 页的 `frontmatter.sources` 与 Source Record 的精确 `## Affected pages` 段落构成完全对称、且不逃逸 Vault 的关系集合。

主题分类、页面粒度、链接密度和综合方式由 Agent 与用户共同演进。
