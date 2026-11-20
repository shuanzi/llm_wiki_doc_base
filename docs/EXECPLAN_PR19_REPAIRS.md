# 修复 PR #19 的八项审查反馈

本计划遵循用户级 `~/.codex/PLANS.md`。目标是在保持 watcher 和同步命令接口的情况下，保护既有知识、文件扫描和发布事务，使 GitHub 上发布的提交包含完整证据。代码起点是 PR #19 的 `995dcb1`，检出分支为 `codex/watch-auto-ingest`，开始时工作树干净。

## Progress

- [x] (2026-11-20) 确认仓库、PR 头提交和分支一致。
- [x] (2026-11-20) 发布删除和队列终态写入后崩溃已复现并修复。事务日志先记录 committed，再完成队列。
- [x] (2026-11-20) 队列按 Vault ID 隔离，旧格式的外部记录行清理，同一 Vault 缺失记录的 retry 保持可见。
- [x] (2026-11-20) 枚举时文件消失、POSIX staging 根替换、reparse 属性和代码/注释内链接误诊断均有先失败再通过的回归。
- [x] (2026-11-20) 受管任务登记被忽略来源的双 clone 回归先复现 synced 后缺证据，再验证候选树阻断发布，显式暂存原文后恢复成功。
- [x] (2026-11-20) 185 项单元/集成测试、Kit strict Doctor、端到端与干净安装包 smoke、git diff --check 通过。
- [ ] 提交推送并回报八项反馈的状态。

## Context and Orientation

`src/llm_wiki/watch.py` 负责扫描、来源队列、staging 和事务发布。`doctor.py` 与 `source_relations.py` 提供持久 Vault 校验和来源关系诊断。`git_sync.py` 在临时 Git 工作树执行合并和发布。回归测试分别落入 `tests/test_watch.py`、`tests/test_doctor.py` 和 `tests/test_git_sync.py`。

## Plan of Work

先在既有测试 fixture 中复现 Agent 删除已有页和事务提交前后崩溃，确认修复后旧知识保留、已完成修复可以恢复。再复现 Binding 切换 Vault、扫描中条目消失、POSIX 目录替换、Windows reparse intake 以及代码示例误诊断。最后让受管任务登记被 Git 忽略的来源，检查确切候选树的校验能阻止不完整的提交发布。

## Validation and Acceptance

每项回归先在旧实现失败，再在最小修复后通过。使用 Python 3.12 运行聚焦测试，最终运行 `./scripts/run-tests.sh`、`git diff --check`，并确认推送后的 PR head 等于本次提交。Windows junction 使用可控文件属性模拟，实际 Windows 主机覆盖作为验证限制。

## Decision Log

复用现有扫描、路径检测、事务日志和 Git 校验入口。把判断聚焦到实际发布的内容，保持全部运行依赖为标准库和系统 Git。仅修改代码、针对性测试及本次验证记录。

## Surprises & Discoveries

开始核查时，来源队列已经按当前 Source ID 过滤待运行集合，但旧行残留且暂停状态可传播到不同 Vault。新增 Vault ID 作用域，并仅清理旧格式中指向外部 Vault 的失效行，保留同一 Vault 的孤立 retry。候选树通过独立 Git index 与 checkout-index 建立干净视图，避免 ignored 文件掩盖缺失原文。Windows reparse 检测复用从 watcher 移到 utils 的现有实现。

## Idempotence and Recovery

测试使用临时 Vault 和本地 bare 远端。保留生产部署和知识库数据，本次交付为 PR 修复提交。失败的候选树与冲突 worktree 延续现有恢复机制。

## Outcomes & Retrospective

八项反馈均有可执行修复。其中既有页面与证据的删除被 staging 检查阻断，跨 Vault 队列清理保持同一 Vault 的孤立 retry 可见，扫描竞态通过入口测试，恢复测试验证终态队列写入后崩溃不会丢失修复。候选树验证只使用独立 Git index materialize 出的跟踪内容，忽略来源的缺失在推送前被发现，现场保留且显式加入 Git 后恢复成功。Windows junction 的检测通过属性模拟，真实 Windows 主机尚未执行。

## Artifacts and Notes

在 PR 分支执行完整项目检查得到以下结果。

    ALL TESTS PASSED (185 unittest cases)
    Summary: 0 error(s), 0 warning(s)
    acceptance-smoke: PASS
    installed-smoke: PASS

2026-11-20 修订，记录八项回归的先失败再通过证据和完整验证结果。
