# 将共享 Obsidian Vault 迁移到本地并通过 Git 同步

本计划按全局 `/Users/xiquandai/.codex/PLANS.md` 维护。Obsidian 打开常用目录，watcher 在临时 Git 工作树处理一个已保存的版本，验证后发布。最终用 GitHub 私有仓库在设备间交接。

## Progress

- [x] (2026-11-11) 确认本机部署基线为 `00962de`，严格 Doctor 通过，目标目录和私有仓库尚未创建。
- [x] (2026-11-11) 双 clone 验证快进、冲突恢复、日志追加、断网、push 失败和并发保存。
- [x] (2026-11-11) 验证 watcher 与受管 Agent 集成。Kit strict Doctor、端到端和安装包 smoke 通过。回归用例覆盖忽略文件保护、进程中断和远端已登记原文保护。
- [x] (2026-11-11) 迁移 370 个文件并逐项核对哈希。独立 clone 的 368 个跟踪文件哈希一致，strict Doctor 通过。Obsidian 已打开本地 Vault，iCloud 原件移入本地备份。
- [x] (2026-11-11) 真实保存的同步说明已提交至 GitHub 私有仓库，受管读取成功。
- [x] (2026-11-11) 最终运行版本 `45f166c` 已安装，175 项测试、严格 Doctor 和安装包 smoke 通过。LaunchAgent 已加载并核对 27 个时间点。
- [x] (2026-11-11 12:10 +08:00) 12:00 计划任务按时启动，实际 fetch、全量扫描和 Codex 摄取交接已观测。首批任务仍在处理，一条运行、七条排队。

## Surprises & Discoveries

现有 watcher 的事务发布会复制整个知识目录。将它限制在临时 Git 工作树，才能让普通 Obsidian 编辑与摄取分开。现有队列行保存绝对路径，来源 ID、哈希和 Source Record 可用于在每轮重新关联路径。

## Decision Log

2026-11-11：从部署提交建独立开发 worktree。同步从正常 Git checkout 捕获稳定文件快照，Git 不参与 Agent 语义决策。对检测到的新保存延迟更新共享目录，已验证的候选提交继续保留。

## Outcomes & Retrospective

临时工作树能在共享目录仍有新保存时推送已验证的导入提交。双 clone 测试证实下一次同步仍会保存新编辑。文本可合并的历史日志改写也进入冲突恢复流程。真实迁移使用 `/Users/xiquandai/Knowledge/.llm-wiki-migrations/20261111.i4QZZ8` 保存文件清单、旧配置、SQLite 队列和 iCloud 原件。已保存的同步说明由实际同步命令提交到私有远端，本机和远端均在 `edddcfa`。12:00 首轮的整批摄取推送要等任务结束后才能核对。

## Context and Orientation

`src/llm_wiki/watch.py` 处理稳定性、登记、队列和 Codex 摄取。`src/llm_wiki/git_sync.py` 管理快照、Git 锁和工作树。CLI 通过 `sync`、`run` 和 `watch --git-sync` 进入同步流程。生产 Binding 位于 `/Users/xiquandai/Documents/llm_wiki_workspace`。

## Plan of Work

通过两个真实 clone 固化 Git 同步行为，再接入已有 watcher。工作树保存在用户约定的开发 worktree 父目录下。同步、日志合并和冲突恢复使用系统 Git 与 Python 标准库。验证通过后，安装版本化 venv。关闭目标 Obsidian Vault 并暂停 watcher，备份并复制到 `/Users/xiquandai/Knowledge/llm-wiki-vault`，验证私有远端 `shuanzi/llm-wiki-vault` 的独立 clone 后切换 Binding 和调度。移出已验证的 iCloud 原件，保留本地备份。最终 LaunchAgent 直接调用 `venv-45f166c/bin/llm-wiki watch`，参数包含 `--git-sync --markdown-only --settle-seconds 60`。

## Validation and Acceptance

在代码工作树中执行 `PYTHONPATH=src python3 -m unittest tests.test_git_sync -v` 和 `./scripts/run-tests.sh`。检查 Obsidian 新目录、GitHub 私有属性、队列和下一轮 LaunchAgent JSON。同步后共享目录和远端提交一致，遇到并发改动则明确显示待同步。

## Idempotence and Recovery

保留待推送提交及冲突工作树。使用 `llm-wiki sync --workspace <binding> --resume <id>` 继续已处理冲突。迁移失败时从备份恢复原 Vault 路径、Binding、队列和 plist。旧 venv 保留供回滚。

## Interfaces and Dependencies

`llm-wiki sync --workspace <binding> [--resume <id>] [--json]` 执行同步。`llm-wiki sync-status --workspace <binding> --json` 查询本地状态。`llm-wiki run --workspace <binding> --mode read|write -- <command>` 以临时 Binding 运行命令。`llm-wiki watch … --git-sync` 保留现有摄取接口并启用 Git 同步。

2026-11-11 更新：记录真实迁移、最终部署提交及预定运行验收。
