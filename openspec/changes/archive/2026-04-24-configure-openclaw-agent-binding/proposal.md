## Why

当前 OpenClaw installer 将 external `KB_ROOT` 的 session-visible 集成固定绑定到 OpenClaw agent `id=llmwiki`，并在错误信息、manifest/runtime metadata、workspace docs 和 repo docs 中把 `llmwiki` 当成唯一合法目标。这与真实需求不一致：installer 应该把指定的 external `KB_ROOT` 接入到 operator 指定的 OpenClaw agent workspace，而不是写死到 `llmwiki`。

现在需要把这层绑定模型改为 configurable agent binding，同时保留默认 `--agent-id llmwiki` 的兼容行为，并继续坚持显式 `--workspace`、binding 一致性校验、manifest ownership 与 fail-closed 原则。

## What Changes

- 为 `install`、`check`、`repair`、`uninstall` 增加 `--agent-id <id>` 参数，并保留默认值 `llmwiki` 以兼容现有调用。
- 将 installer 的 workspace binding 解析与断言逻辑从固定 `llmwiki` 重构为通用 agent binding resolver，输入包含 `agentId` 与 `workspacePath`。
- 将 lifecycle commands、session runtime tool policy 更新、manifest/session runtime metadata、drift items 与错误信息统一切换为使用指定 `agentId`，不再把 `llmwiki` 当成唯一支持对象。
- 要求后续 `check`、`repair`、`uninstall` 对 CLI `--agent-id`、manifest recorded `agentId` 与 OpenClaw `agents.list` 中对应 workspace binding 做一致性校验；不一致时 fail-closed，除非已有明确 `--force` 语义允许覆盖。
- 更新生成文档与 repo docs，使其描述“installer-configured OpenClaw agent”这一通用语义；可说明默认值是 `llmwiki`，但不得再表述为唯一合法 agent。
- 更新测试覆盖 configurable agent binding、manifest agent ownership、tool policy 更新目标，以及生成文档不再写死 `llmwiki` 的断言。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openclaw-installer-workspace-targeting`: installer lifecycle commands 在显式 `--workspace` 之外，还必须校验指定 `--agent-id` 与 OpenClaw `agents.list` 中的 workspace binding 一致，缺失、歧义或不匹配时 fail-closed。
- `openclaw-agent-kb-tool-availability`: session-visible canonical `kb_*` tools、manifest ownership、tool policy 更新与 operator-facing docs 改为面向 installer-configured OpenClaw agent，而不是固定 `llmwiki`。

## Impact

- Affected code: `src/openclaw-installer/args.ts`, `src/openclaw-installer/check.ts`, `src/openclaw-installer/install.ts`, `src/openclaw-installer/repair.ts`, `src/openclaw-installer/uninstall.ts`, `src/openclaw-installer/manifest.ts`, `src/openclaw-installer/session-runtime-agent-policy.ts`, `src/openclaw-installer/session-runtime-artifact.ts`, `src/openclaw-installer/workspace-docs.ts`, `src/openclaw-installer/skills.ts`, `src/openclaw-installer/types.ts`, `src/openclaw-installer/llmwiki-binding.ts` (rename/generalize expected).
- Affected docs: `README.md`, `docs/openclaw-installer-agent-guide.md`, `docs/technical.md`.
- Affected tests: `tests/openclaw-installer-substrate.test.ts` and related installer validation coverage.
- No new runtime dependency is expected; this is a contract and ownership-model change within the existing OpenClaw installer surface.
