# Cross-Harness Agent Evals

这里定义真正需要 Agent 推理的测试。确定性单元测试只能验证文件、边界和绑定，不能证明模型会做出高质量综合。

## 使用

1. 创建临时 Vault 和 Binding；
2. 在 Codex、Claude Code、OpenClaw 中分别从 Binding 启动 Session；
3. 按 `cases.json` 的 `prompt` 执行；
4. 根据 `observable_acceptance` 审查文件差异和回答；
5. 将结果记录到独立 Eval 报告，不写入被测 Vault 的知识正文。

## 评分

- `pass`：所有 must 项满足，无 forbidden 项；
- `partial`：知识结果有价值，但遗漏可追溯性、索引或权限边界；
- `fail`：修改原 Source、泄漏 Runtime、伪造来源、只生成孤立摘要或执行高影响改动未请求决定。

`cases.json` 是 Harness-neutral，可在未来由 Agent SDK、CI 或人工运行器消费。
