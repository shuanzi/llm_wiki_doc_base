# 设计裁决

## D-001：Markdown Vault 而非知识库服务

**决定**：普通文件是唯一持久知识源。

**理由**：用户可直接阅读、Git 审查、Obsidian 维护、离线使用和跨工具迁移。数据库可作为索引 Sidecar，但不能成为唯一存储。

## D-002：Skill-first，暂不把 MCP 作为基础设施

**决定**：三类 Harness 共享 Agent Skill；MCP 只作为未来搜索/外部工具扩展。

**理由**：当前核心工作依赖 Agent 已具备的文件读写和搜索能力。先引入 MCP 会增加常驻服务、配置和迁移成本，而没有改变知识维护的核心语义。

## D-003：Vault Profile 跟随知识，Harness Binding 独立

**决定**：领域范围、分类、来源策略和持久化权限位于 `profile/`；Agent 发现路径和 Session/Runtime 位于 Binding。

**理由**：Profile 描述“这个库是什么”，应随 Vault 迁移；Harness 描述“哪个工具如何连接”，应可替换。

## D-004：完成条件而非固定步骤

**决定**：Skill 定义每类能力的 closure conditions，Agent 自主选择工具和步骤。

**理由**：不同资料、领域和 Vault 规模需要不同处理方式。固定脚本容易把语义任务错误地简化为文件流水线。

## D-005：注册来源使用确定性哈希

**决定**：Source 注册是少数硬约束之一。

**理由**：原始证据被静默改写会破坏整个 Wiki 的可追溯性；哈希验证成本低、收益高，不限制 Agent 的知识综合方式。

## D-006：Binding Workspace 与 Vault 不允许父子嵌套

**决定**：两者必须为独立兄弟根或完全不同位置。

**理由**：从物理上避免 Harness、缓存和 Session 状态混入持久知识，也避免删除 Binding 时误删 Vault。

## D-007：自动写入按语义风险分级，不按文件数分级

**决定**：低风险增量由 Agent 自动完成；核心结论、范围、批量结构和不可逆删除由用户决定。

**理由**：一次修改 15 个交叉引用可能比改写一个中心结论风险更低，固定数量阈值不能反映真实影响。

## D-008：Skill 发现与 Vault 文件授权分离

**决定**：attach 负责让 Harness 发现 Skill 和定位 Vault，但不假设符号链接能绕过 Agent Sandbox。外部 Vault 的读写权限由 Codex/Claude 的 `--add-dir` 或 OpenClaw workspace/sandbox 配置授予。

**理由**：发现协议和操作系统/Agent 权限属于不同安全边界。把权限状态写入 Vault 会降低可迁移性，也可能泄漏本地环境信息。

## D-009：管理身份必须可证明，陈旧元数据不得授权删除真实目录

**决定**：复制 Skill 通过目录内 marker 证明所有权；Skill 符号链接必须同时有 Binding 记录。`binding/vault` 只有当前仍为已记录符号链接时才可替换或删除，真实目录始终拒绝。

**理由**：仅凭路径名称或“以前曾托管”推断所有权，可能覆盖用户 Skill 或递归删除用户文件。安全失败优先于自动修复。

## D-010：来源关系以显式双向集合闭环

**决定**：普通 Wiki 页 `frontmatter.sources` 的 block-list 是 canonical forward set F，Source Record 的精确 `## Affected pages` 段落是 reverse set R；Doctor 与 Watcher 都要求 F == R。正文导航、读取或触碰不会隐式产生关系。

**理由**：显式集合既能识别漏回填，也能识别已失效的反向链接；把 Index/Map 导航或 Agent 读取范围当成消费者会污染 provenance。Watcher 允许为新消费者回填旧 Source Record，但以 Affected-pages-only byte preimage 比较限制副作用。
