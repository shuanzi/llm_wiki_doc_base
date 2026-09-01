# Harness 兼容与 Attach 语义

## 1. 公共 Skill

公共 Skill 遵循 Agent Skills 的最小共同格式：技能目录包含带 YAML frontmatter 的 `SKILL.md`，必需字段仅使用 `name` 与 `description`；详细内容放在 `references/`，避免使用某一 Harness 专属 Frontmatter。

这使同一份 Skill 可被三个工具加载，而不会维护三套会漂移的流程说明。

## 2. 绑定路径

| Harness | Skill 目标 | 启动说明 | 本实现方式 |
|---|---|---|---|
| Codex | `.agents/skills/llm-wiki/` | `AGENTS.md` | 项目级 Skill + 托管块 |
| Claude Code | `.claude/skills/llm-wiki/` | `CLAUDE.md` | 项目级 Skill + 托管块 |
| OpenClaw | `skills/llm-wiki/` | `AGENTS.md` | Workspace Skill + 托管块 |

OpenClaw 也能发现 `.agents/skills`，但本实现使用其优先级更高、语义更明确的 Workspace `skills/` 位置。

## 3. 托管块

CLI 不覆盖已有 `AGENTS.md`、`CLAUDE.md`、`BINDING.md` 或 `.gitignore`。它只维护：

```markdown
<!-- llm-wiki:begin -->
...
<!-- llm-wiki:end -->
```

重复 attach 先替换旧块；detach 只移除该块。用户自有内容保持原样。若发现起止标记不配对，attach 会在改动 Skill、Vault 链接或绑定元数据前停止，避免把已损坏的文件进一步改写。

## 4. Skill copy 与 symlink

### Copy（默认）

- 优点：Binding 在 Kit 移动/删除后仍可工作；ZIP 解压和跨磁盘更可靠。
- 代价：Skill 升级需要重新 attach。
- 管理身份：Skill 目录内保存 `.llm-wiki-managed.json`。
- Doctor：对比已安装 Skill 与 Kit 中的 canonical fingerprint。

### Symlink

- 优点：Skill 修改实时生效；适合开发。
- 代价：移动 Kit 后链接失效；某些 Sandbox/Windows 环境不支持。
- 管理身份：只有 Binding 元数据中已记录为 `skill_mode=symlink` 的对应 Harness 链接才视为托管。
- 安全性：未知符号链接不会被默认覆盖或 detach；只有显式 `--force` 才能在 attach 时替换未知 Skill 目标。
- Doctor：检查链接存在、模式一致和 Skill 结构。

## 5. Vault symlink 与 pointer

### Symlink（默认）

Binding 中创建 `vault -> /real/vault`。Agent 从工作区即可使用稳定相对路径 `vault/`。该链接本身是 Harness 产物，完整解绑会删除它。

CLI 只会替换 Binding 元数据可证明由本工具创建的符号链接。即使旧 `binding.json` 声称曾使用链接，只要 `binding/vault` 当前已变成真实目录，attach 也会拒绝继续，绝不会递归删除该目录。

### Pointer

`binding.json` 和托管说明保存 Vault 绝对路径，不创建链接。适用于不支持符号链接的环境。为避免 Agent 在发现阶段误入错误目录，pointer 模式要求 Binding 根目录下不存在名为 `vault` 的其他文件、目录或未知链接。

## 6. Skill 发现与文件权限是两个层次

三类 Harness 能发现 Skill，并不意味着其 Sandbox 一定允许读写位于工作区之外的 Durable Vault。符号链接也不会自动绕过文件系统授权。

建议：

```bash
cd /path/to/binding

# 当 Vault 在默认可写根之外时
codex --add-dir /path/to/vault
claude --add-dir /path/to/vault
```

OpenClaw 应通过当前 Agent 的 workspace/sandbox 配置允许该路径，或将 Vault 以受控挂载方式暴露到允许的工作区。权限、认证和 Session 状态始终属于 Harness 配置，不应写入 Vault。

## 7. 工作区路径安全

attach 在任何写入前检查：

- Vault 与 Binding 不是同一目录，也不互相包含；
- 生成文件的父目录没有逃逸 Binding；
- `AGENTS.md` 等生成文件若为符号链接，目标仍位于 Binding 内；
- Skill 目标父目录和 `.llm-wiki-binding/` 没有通过符号链接逃逸；
- 未知 Skill 目录/链接、未知 `vault` 别名不会被隐式覆盖。

这些约束只保护持久资产和用户文件，不规定 Agent 如何组织知识内容。

## 8. 兼容性测试范围

自动化测试验证：

- 三个发现目录存在；
- Skill Frontmatter 与引用文件完整；
- 托管块可发现、可更新、可删除；
- Binding 指针/符号链接解析正确；
- 安装 Skill 与 canonical Skill 一致；
- 未知符号链接、真实用户目录和路径逃逸受到保护；
- Detach 不影响 Vault 和用户内容。

当前测试环境未预装并认证 Codex、Claude Code、OpenClaw，因此未执行真实模型调用。项目提供 [Agent 手工/CI Eval 场景](../evals/README.md)，可在各工具具备账号和权限的环境中运行；确定性功能和目录契约已自动化验证。
