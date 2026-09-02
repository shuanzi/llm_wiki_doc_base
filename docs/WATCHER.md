# 周期扫描与自动 Ingest

`llm-wiki watch` 是一次性（one-shot）任务：每次启动都全量扫描一个输入目录，默认注册稳定的 Markdown 新文件，并串行调用 Codex 完成语义 Ingest。它不是常驻 daemon，也不依赖可能丢失的文件系统事件。

请由操作系统调度器每 **30 分钟**运行一次。调度漏跑、进程异常退出或 Runtime 队列丢失后，下一次全量扫描会继续发现仍保留在输入目录中的文件，并可从 `registered` Source Record 恢复待办任务。

## 前置条件

v1 只支持 Codex Binding。先创建 Vault 和 Codex Binding，并在运行调度任务的同一用户账户下完成 Codex 登录：

```bash
llm-wiki attach \
  --vault /absolute/path/to/vault \
  --workspace /absolute/path/to/binding \
  --harness codex
```

调度环境通常没有交互式 Shell 的完整环境变量。`llm-wiki`、`codex` 和 Python 运行环境必须可通过设置后的 `PATH` 找到；若平时设置了 `CODEX_HOME`，调度器也必须设置为同一绝对路径。请先在该用户账户的交互终端中完成 Codex 认证，不要把 token、cookie 或其他凭据写进 plist、unit 文件或任务参数。

输入目录、Binding 和 Vault 都必须使用绝对路径。v1 要求一个 Vault 只有一个负责自动 Ingest 的 Binding/调度任务；Watcher 运行期间，其他 Binding、普通 Agent 和人工编辑进程都不得修改该 Vault。需要人工编辑时，先暂停系统 timer 并确认没有 active watcher，完成后再恢复调度。

## 运行一次

```bash
llm-wiki watch /absolute/path/to/drop-folder \
  --workspace /absolute/path/to/binding \
  --harness codex \
  --markdown-only \
  --recursive \
  --settle-seconds 60 \
  --json
```

默认模式只处理大小写不敏感的 `.md` 和 `.markdown`；`--markdown-only` 可显式记录这一策略，只有确实需要处理其他普通文件时才使用互斥的 `--all-files`。被过滤的文件不会注册或入队，JSON 结果通过 `details.ignored` 和 `ignored-non-markdown` 事件报告。`--settle-seconds 60` 要求候选文件在两次检查之间保持相同的大小和修改时间，才会注册。扫描器不会移动或删除输入文件。

为避免读取半写入内容，推荐生产者先写入同一文件系统上的临时文件，写完并关闭后再原子 `rename` 到 drop folder。文件必须保留到至少一次扫描成功；在两次扫描之间写入又删除的文件无法被发现，不属于“不漏文件”保证范围。

Watcher 拒绝监听 Vault 根目录、`sources/library/`、Binding 内部目录、符号链接根，以及会与 Vault 或 Binding 重叠的路径，以避免递归反馈和路径逃逸；唯一允许的 Vault 内输入目录是 `sources/inbox/`。Inbox 内容按不可信待注册材料处理，不参与 Durable Wiki 的 Doctor 检查，注册后的 `sources/library/` 副本和 Source Record 才进入 closure 校验。目录不可访问、挂载消失或权限异常会作为扫描失败报告，绝不视为空目录。

## 处理与结果

每轮执行以下恢复型流程：

1. 获取当前 Binding 的跨进程 OS lock 和 SQLite lease，恢复未完成的发布事务，再校验 Binding、Vault、输入目录和 Codex 可用性。v1 依赖“一个 Vault 只由一个 Binding/调度任务负责”的部署约束来实现 Vault 级单写者。
2. 全量扫描稳定且符合当前格式策略的文件，复用 `register_source()` 复制、哈希注册 Source Record 与日志；相同 SHA-256 不会重复注册。
3. 将新注册的 Source 和符合当前格式策略的 `status: registered` Source Record 放入 Binding Runtime 队列：`.llm-wiki-binding/runtime/watch/queue.sqlite3`；默认模式会从 disposable queue 移除非 Markdown job，但不删除其 Durable Source Record。
4. 每个 Source 独立、串行启动一个 ephemeral Codex 进程，避免某个 `needs-review` 或不支持的文件暂停其他 Source。Agent 只得到当前 Source ID/Record 路径和已安装 Skill 的绝对路径。
5. Agent 只写临时 Vault 副本；真实 Binding Runtime、队列和 Vault 不授予 Agent 写权限。Agent 结束后，Watcher 在副本中检查 Source Record 的 `status: ingested`、来源 SHA-256、对应的 Ingest operation log、结构化结果，以及 `llm-wiki doctor <vault> --strict`。全部满足后，才通过可恢复的发布事务写回真实 Vault 并再次校验。

生产 Adapter 直接用 argv 启动，不经过 Shell。等价命令如下，其中 `<staged-vault>` 是本轮隔离副本，不是 Durable Vault：

```bash
codex exec \
  --ephemeral \
  --cd <isolated-temp-dir> \
  --skip-git-repo-check \
  --add-dir <staged-vault> \
  --approve-for-me \
  --json \
  --output-schema <runtime-result-schema> \
  --output-last-message <runtime-result-json> \
  -
```

当前 Codex CLI 的 `--approve-for-me` 已使用 workspace-write sandbox，不得再与显式 `--sandbox workspace-write` 同时传入，否则 Codex 会在启动前以参数错误退出。

Prompt 通过临时文件接入 stdin，只包含 Skill 路径、当前 Source ID/Record 路径和闭环约束，不包含来源正文。每个 Agent 最长运行 25 分钟；超时或 lease control loss 时终止整个进程树。结构化结果和 JSONL/stderr 留在 `.llm-wiki-binding/runtime/watch/` 供排查。

队列状态为 `discovered`、`registered`、`queued`、`ingesting`、`ingested`、`retry`、`needs-review` 或 `permanent-error`。Codex 非零退出、超时、认证或网络故障、无效结果以及 completion probe 失败都会保留任务为 `retry`；不会因 Agent 的退出码或文本声称完成就静默成功。

命令在全部任务完成或没有待办时返回 `0`；若扫描注册失败，或仍有 `retry`、`needs-review`、`permanent-error`，则返回 `1`；路径、Binding、参数或 Runtime 损坏等启动错误返回 `2`。调度器应保留 stdout/stderr，并对非零退出告警；`--json` 的 `details.ignored` 给出本轮过滤数量，`details.jobs` 给出各状态数量，`details.job_errors` 最多返回 100 条 Source 级状态和原因，`details.runtime` 指向完整 Agent 日志所在目录。

Agent 遇到需要推翻核心结论、不可裁决冲突或其他高影响语义变更时会返回 `needs-review`。这类任务的临时副本会被丢弃，Durable Vault 仅保留注册结果，任务暂停等待人工交互式 Agent 裁决。开始人工裁决前必须暂停 30 分钟 timer，并确认当前 watcher 已退出；完成并关闭交互式 Agent 后再恢复 timer。下一轮若发现其 Source Record 已由人工完成为 `ingested`，会自动关闭任务。

在机器在线、输入目录可访问、文件未提前删除、Codex 已认证、没有人工裁决且队列未过载的条件下，稳定文件会在下一次 30 分钟扫描中发现，并目标在写入后 1 小时内完成语义 Ingest。该目标不覆盖机器休眠、外部服务故障或 `needs-review` 停顿。

## 安装 30 分钟调度

以下均是示例配置；`llm-wiki` 不会替你安装或修改系统任务。将其中的用户、绝对路径和可执行文件路径替换为实际值，并确保日志目录已经存在且仅当前用户可写。

### macOS：launchd

保存为 `~/Library/LaunchAgents/com.example.llm-wiki-watch.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.example.llm-wiki-watch</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/llm-wiki</string>
      <string>watch</string>
      <string>/Users/alice/Drop</string>
      <string>--workspace</string><string>/Users/alice/WikiBinding</string>
      <string>--harness</string><string>codex</string>
      <string>--markdown-only</string>
      <string>--recursive</string>
      <string>--settle-seconds</string><string>60</string>
      <string>--json</string>
    </array>
    <key>StartInterval</key><integer>1800</integer>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
      <key>CODEX_HOME</key><string>/Users/alice/.codex</string>
    </dict>
    <key>StandardOutPath</key><string>/Users/alice/Library/Logs/llm-wiki-watch.log</string>
    <key>StandardErrorPath</key><string>/Users/alice/Library/Logs/llm-wiki-watch-error.log</string>
  </dict>
</plist>
```

由用户自行加载或卸载该 LaunchAgent；加载后先手动触发一次并检查日志与 `--json` 结果。`CODEX_HOME` 仅在你已使用它时设置；它必须指向拥有已认证 Codex 状态的目录。

### Linux：systemd timer

保存以下 service 为 `/etc/systemd/system/llm-wiki-watch.service`：

```ini
[Unit]
Description=LLM Wiki watch scan

[Service]
Type=oneshot
User=alice
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="CODEX_HOME=/home/alice/.codex"
ExecStart=/usr/local/bin/llm-wiki watch /home/alice/Drop --workspace /home/alice/WikiBinding --harness codex --markdown-only --recursive --settle-seconds 60 --json
```

保存 timer 为 `/etc/systemd/system/llm-wiki-watch.timer`：

```ini
[Unit]
Description=Run LLM Wiki watch every 30 minutes

[Timer]
OnCalendar=*-*-* *:00,30:00
Persistent=true
Unit=llm-wiki-watch.service

[Install]
WantedBy=timers.target
```

由管理员或该服务的维护者执行 `systemctl daemon-reload` 并启用 timer。`Persistent=true` 会在错过日历时间后于系统恢复时补跑一次；同样只在你平时使用该变量时设置 `CODEX_HOME`。

### Windows：Task Scheduler

在“任务计划程序”创建任务，使用运行 Codex 的同一 Windows 用户：

- 触发器：每天，重复任务间隔 **30 分钟**，持续时间“无限期”。
- 操作的“程序或脚本”：`C:\\Users\\Alice\\AppData\\Local\\Programs\\Python\\Python313\\Scripts\\llm-wiki.exe`（替换为实际绝对路径）。
- “添加参数”：`watch "C:\\Users\\Alice\\Drop" --workspace "C:\\Users\\Alice\\WikiBinding" --harness codex --markdown-only --recursive --settle-seconds 60 --json`。
- “起始于”：包含 `llm-wiki.exe` 的目录；在任务的环境设置中确保 `PATH` 可找到 `codex.exe`，并保留交互环境所用的 `CODEX_HOME`。

不要选择会阻止访问该用户 Codex 认证状态或 Vault 的账户/权限模式。首次运行后检查任务历史、输出日志和队列状态；认证失效时修复认证后，后续扫描会从 `retry` 恢复。
