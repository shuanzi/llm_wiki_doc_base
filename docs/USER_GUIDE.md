# 使用手册

## 1. 创建 Vault

```bash
./bin/llm-wiki init ~/vaults/my-wiki --name "My Wiki" --language zh-CN
```

目标目录必须为空，工具不会覆盖已有文件。创建后可立即用 Obsidian 打开。

首次使用建议编辑：

- `profile/VAULT_PROFILE.md`：范围、排除项、领域语义；
- `profile/CONVENTIONS.md`：语言、链接和来源偏好；
- `profile/PERSISTENCE_POLICY.md`：自动写入与确认边界。

## 2. 加入资料

### 方式 A：Inbox

将资料复制到 `sources/inbox/`，然后告诉 Agent 摄取。Agent 应先确认来源身份，必要时调用注册命令。

### 方式 B：注册命令

```bash
./bin/llm-wiki register-source \
  --vault ~/vaults/my-wiki \
  ~/Downloads/article.pdf \
  --title "文章标题"
```

结果：

- 原文件复制到 `sources/library/YYYY/name--hash.ext`；
- 创建 `wiki/sources/src-<hash>.md`；
- 写入 SHA-256、媒体类型和 Source ID；
- 在 `logs/operations.md` 追加 `source-register`；
- **不会**自动总结或更新概念页。

重复注册同一内容是幂等的。Doctor 会发现注册后被改写的文件。

### 方式 C：注册代码仓库

先完成 Attach，再从 Binding Workspace 调用当前 Skill 自带的脚本：

```bash
cd ~/knowledge/my-wiki-agent
python3 .agents/skills/llm-wiki/scripts/register_repository.py \
  https://github.com/owner/project \
  --json
```

Claude Code 使用 `.claude/skills/llm-wiki/`，OpenClaw 使用 `skills/llm-wiki/`。脚本从 Binding metadata 自动发现 Vault，只保存项目名称、规范化链接和根 README。README 被当作不可信来源证据；脚本不会 checkout、保存或分析源码。注册完成后，要求 Agent 继续执行 Ingest closure。

### 方式 D：周期扫描文件夹

需要自动处理 drop folder 时，可让系统调度器每 30 分钟运行一次 `llm-wiki watch`。该命令默认只处理 `.md` / `.markdown`，每次进行全量扫描，先完成确定性注册，再启动 ephemeral Codex Agent 执行语义 Ingest；仅在明确需要其他文件类型时使用 `--all-files`。完整前置条件、恢复语义和跨平台调度示例见 [周期扫描与自动 Ingest](WATCHER.md)。

## 3. Attach Agent

建议让 Vault 和 Binding 成为同一父目录下的兄弟目录：

```text
~/knowledge/
├── my-wiki/           # Durable Vault
└── my-wiki-agent/     # Binding Workspace
```

绑定全部工具：

```bash
./bin/llm-wiki attach \
  --vault ~/knowledge/my-wiki \
  --workspace ~/knowledge/my-wiki-agent \
  --harness all
```

也可多次增量绑定：

```bash
./bin/llm-wiki attach --vault ~/knowledge/my-wiki --workspace ~/knowledge/my-wiki-agent --harness codex
./bin/llm-wiki attach --vault ~/knowledge/my-wiki --workspace ~/knowledge/my-wiki-agent --harness claude
```

默认 `--skill-mode copy`，因此移动或删除 Kit 后 Binding 仍可使用已复制 Skill。Kit 升级后使用 `update` 刷新已有 Workspace：

```bash
./bin/llm-wiki update --workspace ~/knowledge/my-wiki-agent
```

`update` 保持 Vault、Harness、copy/symlink 模式和用户文本不变。检测到本地 Skill 漂移或旧 marker 时会先写入 runtime backup；全部产物一致时返回 `already-current`。

默认 `--vault-mode symlink`。Windows、受限 Sandbox 或不允许符号链接的文件系统可使用：

```bash
./bin/llm-wiki attach ... --vault-mode pointer
```

Pointer 模式在指令中写入绝对路径。无论 symlink 还是 pointer，Agent 工具仍需获得真实 Vault 的读写权限；链接本身不会绕过 Sandbox。

常见启动方式：

```bash
cd ~/knowledge/my-wiki-agent
codex --add-dir ~/knowledge/my-wiki
# 或
claude --add-dir ~/knowledge/my-wiki
```

OpenClaw 需要在当前 Agent 的 workspace/sandbox 配置中允许或挂载 Vault。attach 后生成的 `BINDING.md` 会保留这类启动提示，但不会把权限状态写入 Vault。

## 4. 日常 Agent 交互

### Orient

```text
使用 llm-wiki skill 进入这个知识库。只读取必要的入口、地图、索引和近期日志，说明范围、核心主题、最近变化与未决问题。
```

### Ingest

```text
摄取 src-xxxxxxxxxxxx 对应来源。识别核心主张和限制，检查已有页面；优先增量维护，不要只新建来源摘要。显式处理冲突并完成索引、地图、来源记录和日志收尾。
```

### Query

```text
基于 Wiki 回答“……”。先使用已有综合页，不足时回溯来源。区分来源事实、跨来源综合、推断和未知，并给出可复查链接。
```

### Promote

```text
评估刚才的分析是否值得长期保存。仅持久化可复用、稳定、有证据且属于本 Vault 范围的内容；说明更新了哪些已有页或为什么新建页面。
```

### Reconcile

```text
对 Wiki 做维护检查：冲突、陈旧结论、复制状态、缺少来源、孤立页、断链、重复页和研究缺口。安全小修复直接做；语义裁决给出证据、选项和推荐方案。
```

## 5. Doctor

```bash
./bin/llm-wiki doctor ~/knowledge/my-wiki --strict
./bin/llm-wiki doctor ~/knowledge/my-wiki-agent --strict
```

Doctor 的错误包括：

- 必需入口缺失；
- Harness/Runtime 泄漏到 Vault 根目录；
- Source Record 路径逃逸、文件缺失或哈希变化；
- Skill 缺失、Frontmatter 无效、安装模式不一致或复制内容漂移；
- Binding JSON 损坏、指向不存在的 Vault或生成文件托管块缺失；
- Vault 与 Binding 形成父子目录；
- Obsidian JSON 不可解析；
- 必需路径、Source、Skill 或生成文件通过符号链接逃逸边界。

Doctor 不对知识结论真伪、页面最佳粒度或本体分类作确定性裁决，这些属于 Agent Lint。

## 6. 移动 Vault

1. 复制/移动整个 Vault；
2. 在新位置运行 `doctor --kind vault`；
3. 对原 Binding 重新运行 `attach --vault <new-path>`；
4. 再运行 Binding Doctor。

Source Record 使用 Vault 内相对路径，因此移动后无需重写来源引用。

## 7. Detach

```bash
./bin/llm-wiki detach --workspace ~/knowledge/my-wiki-agent --harness claude
./bin/llm-wiki detach --workspace ~/knowledge/my-wiki-agent --harness all
```

完整解绑后可安全删除 Binding 目录。Vault 不会被删除或修改。
