## 1. CLI and Binding Resolver

- [x] 1.1 Add `agentId` to installer command arg types and resolved environment, with default `llmwiki`.
- [x] 1.2 Update CLI parsing, unknown flag validation, and usage output for `--agent-id <id>` on `install`, `check`, `repair`, and `uninstall`.
- [x] 1.3 Replace fixed `llmwiki` workspace binding types/functions with generic agent workspace binding types/functions that accept `agentId` and `workspacePath`.
- [x] 1.4 Ensure resolver results, thrown errors, and messages expose generic fields such as `agentId`, `agentCount`, `candidateWorkspaces`, and `malformedWorkspaceEntryCount`.
- [x] 1.5 Preserve fail-closed behavior for missing agent binding, malformed workspace entries, multiple workspace candidates, and workspace bound to another agent.

## 2. Installer Lifecycle Plumbing

- [x] 2.1 Thread `agentId` through `install`, `check`, `repair`, and `uninstall` command execution.
- [x] 2.2 Require successful configured agent/workspace binding before session-visible runtime probing or OpenClaw config mutation.
- [x] 2.3 Record configured `agentId` in manifest/session runtime metadata during install and session-runtime metadata backfill.
- [x] 2.4 Validate CLI `agentId` against manifest session runtime `agentId` during `check`, `repair`, and `uninstall`; report drift or fail closed on mismatch according to command semantics.
- [x] 2.5 Update drift item messages and manual follow-up guidance to use the configured `agentId` rather than fixed `llmwiki` wording.
- [x] 2.6 Update session runtime probe context so health checks target the configured OpenClaw agent.

## 3. Tool Policy and Runtime Metadata

- [x] 3.1 Update session runtime agent policy helpers to select the OpenClaw `agents.list` entry for the configured `agentId` and bound workspace.
- [x] 3.2 Ensure install/repair add the installer-owned KB plugin group to the configured agent tool policy while preserving existing `tools.profile` and avoiding invalid `tools.allow` plus `tools.alsoAllow` conflicts.
- [x] 3.3 Ensure uninstall removes the installer-owned KB plugin group from the configured agent tool policy only when installer ownership is recognizable.
- [x] 3.4 Keep existing plugin id/path compatibility unless implementation discovers a required OpenClaw constraint that forces a rename, and document any such change explicitly.

## 4. Documentation Updates

- [x] 4.1 Update generated `AGENTS.md`, `SOUL.md`, `TOOLS.md`, and `HEARTBEAT.md` templates to describe the installer-configured OpenClaw agent and avoid fixed `llmwiki` target semantics.
- [x] 4.2 Keep generated workspace docs deterministic by using generic wording instead of injecting the concrete installation `agentId`.
- [x] 4.3 Update generated skills wording so canonical `kb_*` availability is tied to the configured OpenClaw agent session.
- [x] 4.4 Update `README.md`, `docs/openclaw-installer-agent-guide.md`, and `docs/technical.md` to document `--agent-id`, default `llmwiki` compatibility, configured-agent binding, and session-visible `kb_*` success criteria.
- [x] 4.5 Preserve documentation statements that `KB_ROOT` is the external `kb` directory itself and that saved MCP config alone is insufficient OpenClaw usability evidence.

## 5. Tests and Verification

- [x] 5.1 Add resolver tests for explicit non-`llmwiki` `agentId` plus matching workspace success.
- [x] 5.2 Add resolver tests for missing configured agent, malformed workspace entry, multiple workspace candidates for the same `agentId`, and workspace belonging to a different agent.
- [x] 5.3 Add CLI parsing tests for explicit `--agent-id` and default `llmwiki` compatibility.
- [x] 5.4 Update installer substrate tests for manifest `agentId`, manifest/CLI mismatch drift, session runtime metadata, and tool policy updates targeting the configured agent.
- [x] 5.5 Update workspace doc rendering assertions so generated docs use installer-configured agent semantics and do not hard-code `llmwiki` as target.
- [x] 5.6 Preserve existing assertions for external `KB_ROOT`, saved MCP config alone insufficient, standalone MCP debug-only, and canonical 11 `kb_*` tools.
- [x] 5.7 Run targeted installer tests and `npm run typecheck`; run broader tests if targeted coverage reveals cross-module regressions.
