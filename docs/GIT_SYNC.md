# 本地 Vault 的 Git 同步

Obsidian 直接打开本地 Vault。使用私有 Git 远端在电脑之间交接。以 `main` 为工作分支，Git `origin` 指向已核实的私有仓库。用系统 Git 和 Python 3.10 或以上版本。

## 日常使用

手动同步并查看结果：

```bash
llm-wiki sync --workspace /absolute/binding --json
llm-wiki sync-status --workspace /absolute/binding --json
```

定时任务使用 `llm-wiki watch /absolute/vault/Clippings --workspace /absolute/binding --harness codex --git-sync --markdown-only --settle-seconds 60 --json`。同步程序取得稳定快照并保存已落盘的本地编辑。合并和摄取在临时 Git 工作树进行。后台 Codex 只接触摄取 staging。共享目录再次发生保存时，保留已生成提交，并延后更新共享目录。锁协调 watcher 与受管命令。Obsidian 的保存可以发生在任何时刻，检查与快进之间仍有竞态。

通过 `llm-wiki run --workspace /absolute/binding --mode read -- <command>` 运行查询，通过 `--mode write` 运行写任务。命令在临时 Binding 目录执行，可以用 `LLM_WIKI_WORKSPACE` 和 `LLM_WIKI_VAULT` 定位本轮路径。任务输出写到终端，写任务的 Vault 成果由同步程序验证并提交。需要长期保留的非 Vault 输出应写到调用者指定的外部路径。

## 离线和冲突

`offline-pending` 保留已完成的提交并报告远端错误，之后重新同步即可。`local-update-pending` 表示已推送，共享目录仍有新保存或尚未快进。`local-changed` 表示两次文件快照不同，下一轮重新采集。用 `sync-status` 查看提交 ID、远端引用、工作树状态和上次在线时间。

冲突时查看结果里的 `worktree` 和 `session`。在该工作树中对比两边，编辑冲突文件并用 `git add -- <文件>` 确认解决。运行：

```bash
llm-wiki sync --workspace /absolute/binding --resume <session> --json
```

程序会检查未解决条目、来源原文及 strict Doctor，再合并远端的新进度并普通推送。中断而留下的工作树也可通过同一入口恢复。处理期间保留双方历史。日常同步避免手动预先暂存，已经暂存的改动应先由操作者提交。

## 另一台电脑

将私有仓库 clone 到本机非云盘目录。配置自己的 Git 身份和认证。用 `llm-wiki attach --vault <本地目录> --workspace <独立绑定目录> --harness codex` 建立绑定，首次同步后把该目录作为 Obsidian Vault 打开。临时工作树默认在 `~/Documents/code/.worktree`，可用仓库本地配置 `git config llmwiki.worktreeRoot /absolute/path` 指定位置。用 `git config llmwiki.origin <已验证的远端 URL>` 固定远端。

版本库保留笔记、来源、附件、剪藏及共享 Obsidian 配置。窗口布局和机器私有配置通过忽略规则留在设备上。源文件的哈希依赖原始字节，应将 `* -text` 写入 Vault 的 `.gitattributes`。本机 Runtime 和队列位于 Binding 外置目录。迁移期间保留旧目录及调度备份。
