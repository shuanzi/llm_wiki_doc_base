# 安全与恢复边界

## Source 不可变性

`register-source` 以内容哈希生成目标文件名和 Source ID。Doctor 根据 Source Record 中的 SHA-256 重新计算内容；改写、丢失或路径逃逸均为错误。

该机制只覆盖通过命令注册的来源。复制采用临时文件、复制后哈希复核和原子替换；重复注册前会确认已有 Source Record、文件和哈希仍一致。Agent 直接操作 Inbox 时仍应遵守 Skill 约束，并在语义摄取前完成注册或等价的来源记录。

仓库注册以规范化 `host/path` 作为永久 identity。首次只在临时目录浅层、blob-filtered、no-checkout 获取根 README，Vault 内仅保存“项目名称 + 规范化链接 + README”合成 Source。同一 identity 重复注册不联网；README 不刷新，仓库副本、源码、目录树、commit 与 Git metadata 不持久化。

## 防覆盖

- `init` 通过同目录 staging 生成完整 Vault 后再原子替换空目标，并拒绝非空目录和符号链接目标；
- `attach` 拒绝覆盖无管理标识的 Skill 目录或符号链接，除非显式 `--force`；
- `--force` 仅用于明确替换 Skill 目标，不授权删除真实 `binding/vault/` 用户目录；
- `detach` 拒绝删除无管理身份的 Skill；
- `update` 在完整预检和 staging 后才替换托管产物；copy drift 与旧 marker 先备份，任一提交步骤失败则恢复 Skill、文档与 Binding metadata；
- `watch` 每次全量重扫输入目录，默认只注册并恢复 `.md` / `.markdown`；`--all-files` 才恢复旧的全文件行为。Vault 内仅允许根级 `Clippings/` 和 `sources/inbox/` 作为只读、不可信 intake root，其原始内容不进入 Agent staging 或 Doctor，发布事务也永不写回这些目录。队列、lease 和 Agent 输出只进入 Binding Runtime。Agent 按 Source 独立操作临时 Vault 副本，只有允许范围、Source/Hash/Log/Doctor/结构化结果全部通过才以带 Vault identity 的可恢复事务发布；`retry`、`needs-review`、`permanent-error` 或崩溃不会把临时修改留在 Durable Vault。队列丢失后从符合当前格式策略且仍为 `registered` 的 Source Record 恢复，不把 Agent 退出码当作 Ingest 成功；
- 旧 Binding 元数据不能把已经变成真实目录的 `binding/vault/` 误判为可删除链接；
- Managed Block 不重写用户文件其余部分，起止标记损坏时在其他写入前失败；
- 生成文件、Skill 父目录、Source 和必需 Vault 路径检查符号链接逃逸；
- Vault 与 Binding 不能相互包含。

## 恢复

建议 Vault 独立 Git 版本化：

```bash
cd /path/to/vault
git init
git add .
git commit -m "Initialize LLM Wiki vault"
```

在批量重构前创建提交或快照。Binding 可以单独版本化，也可以由 `attach` 重建；`update` 备份位于可删除的 `.llm-wiki-binding/runtime/update-backups/`。

## 威胁边界

MVP 不处理：

- 恶意 Source 中的提示注入隔离；
- 多 Agent 并发写入冲突；
- 文件系统级 ACL、加密或密钥管理；
- 外部下载来源的许可证判定；
- 模型对事实的最终正确性。

Skill 要求 Agent 将 Source 内容视为证据而非执行指令。生产环境可后续增加 Source sandbox、Git review、并发锁和安全扫描 Sidecar。
