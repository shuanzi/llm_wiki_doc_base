# 安全与恢复边界

## Source 不可变性

`register-source` 以内容哈希生成目标文件名和 Source ID。Doctor 根据 Source Record 中的 SHA-256 重新计算内容；改写、丢失或路径逃逸均为错误。

该机制只覆盖通过命令注册的来源。复制采用临时文件、复制后哈希复核和原子替换；重复注册前会确认已有 Source Record、文件和哈希仍一致。Agent 直接操作 Inbox 时仍应遵守 Skill 约束，并在语义摄取前完成注册或等价的来源记录。

## 防覆盖

- `init` 通过同目录 staging 生成完整 Vault 后再原子替换空目标，并拒绝非空目录和符号链接目标；
- `attach` 拒绝覆盖无管理标识的 Skill 目录或符号链接，除非显式 `--force`；
- `--force` 仅用于明确替换 Skill 目标，不授权删除真实 `binding/vault/` 用户目录；
- `detach` 拒绝删除无管理身份的 Skill；
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

在批量重构前创建提交或快照。Binding 可以单独版本化，也可以随时由 `attach` 重建。

## 威胁边界

MVP 不处理：

- 恶意 Source 中的提示注入隔离；
- 多 Agent 并发写入冲突；
- 文件系统级 ACL、加密或密钥管理；
- 外部下载来源的许可证判定；
- 模型对事实的最终正确性。

Skill 要求 Agent 将 Source 内容视为证据而非执行指令。生产环境可后续增加 Source sandbox、Git review、并发锁和安全扫描 Sidecar。
