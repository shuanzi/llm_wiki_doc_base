## Context

The current OpenClaw installer already requires an explicit `--workspace` for lifecycle commands and validates session-visible canonical `kb_*` tool availability. The recent session-runtime work added a workspace binding check, but it hard-coded the target agent as `llmwiki` through `resolveLlmwikiWorkspaceBinding`, `assertLlmwikiWorkspaceBinding`, manifest metadata, drift messages, tool policy updates, generated docs, and operator-facing docs.

That model incorrectly treats `llmwiki` as the only supported OpenClaw agent. The real contract is: the installer connects an operator-provided external `KB_ROOT` to the workspace of the OpenClaw agent selected by installer configuration. `llmwiki` can remain the default `agentId` for compatibility, but it must not be the only valid target.

Existing constraints still apply:

- `install`, `check`, `repair`, and `uninstall` require explicit `--workspace`.
- `KB_ROOT` remains the external `kb` directory itself, with `raw`, `wiki`, `schema`, and `state` directly under it.
- Missing, malformed, ambiguous, or mismatched OpenClaw agent/workspace binding fails closed.
- Session-visible canonical `kb_*` tool availability remains the OpenClaw usability success criterion.
- Saved MCP config alone remains insufficient.

## Goals / Non-Goals

**Goals:**

- Add configurable `--agent-id <id>` support to every installer lifecycle command, defaulting to `llmwiki` for backward compatibility.
- Replace fixed `llmwiki` binding code with a generic resolver that accepts `agentId` and `workspacePath`.
- Validate `--workspace` against OpenClaw `agents.list` entry or entries whose `id` equals the configured `agentId`.
- Record installed `agentId` in manifest/session runtime metadata and fail closed when later CLI arguments disagree with manifest ownership, unless existing `--force` semantics explicitly cover the operation.
- Update the specified agent's tool policy in OpenClaw `agents.list`.
- Make generated workspace docs deterministic and generic, referring to the installer-configured OpenClaw agent instead of injecting a concrete agent id.
- Update repo docs and tests to describe configurable agent binding while preserving the existing KB_ROOT and canonical tool contracts.

**Non-Goals:**

- Changing the external `KB_ROOT` directory model.
- Renaming the existing workspace-local plugin id/path solely because it contains historical `llmwiki` text.
- Introducing a new OpenClaw runtime packaging mechanism.
- Making saved MCP config a sufficient OpenClaw health signal.
- Migrating a healthy install to a different `KB_ROOT`, workspace, or agent id without explicit ownership and force handling.

## Decisions

### 1. `--agent-id` is a lifecycle command option with default `llmwiki`

The CLI will accept `--agent-id <id>` for `install`, `check`, `repair`, and `uninstall`. If omitted, the parsed command args use `llmwiki`.

This keeps current scripts working while making the target explicit in the internal command model. Help output should show the default without describing `llmwiki` as a privileged or only-supported agent.

Alternative considered: require `--agent-id` immediately. Rejected because it would break existing installer calls without adding safety beyond the manifest and binding checks.

### 2. Binding resolution becomes generic

The fixed `llmwiki` resolver will be renamed or replaced with an agent binding resolver whose input is:

- `agentId`
- `workspacePath`
- optional `OpenClawCli`
- optional `homeDir`

The resolver will filter `agents.list` entries by `id === agentId`, normalize workspace paths using existing workspace normalization rules, and return:

- `bound` when exactly one normalized candidate equals the explicit workspace
- `missing_binding` when no matching agent workspace exists or the sole candidate belongs elsewhere
- `ambiguous_binding` when multiple normalized workspaces exist for the agent or malformed workspace entries prevent safe resolution

The result shape should use generic fields such as `agentId`, `agentCount`, `candidateWorkspaces`, and `malformedWorkspaceEntryCount`. Error names and messages should include the configured `agentId`.

Alternative considered: keep the old resolver and pass a constant override. Rejected because fixed type names and messages would continue encoding the wrong domain model.

### 3. Manifest ownership includes `agentId`

Install writes the configured `agentId` into manifest/session runtime metadata. `check`, `repair`, and `uninstall` compare CLI `agentId` with manifest `sessionRuntime.agentId` when metadata exists.

Mismatch is drift and fail-closed by default because the installer must not silently manage another agent's session-visible tool policy. Existing `--force` behavior may be used only where the command already supports force and ownership is otherwise recognizable; `check` has no force path and should report the mismatch as unhealthy.

Legacy manifests that lack session runtime metadata may be upgraded in place when existing installer-owned state is recognizable, using the CLI `agentId` as the target only after the OpenClaw binding resolver confirms the explicit workspace belongs to that agent.

Alternative considered: infer `agentId` from `agents.list` during every command and omit it from the manifest. Rejected because later commands need a stable ownership record to detect accidental retargeting.

### 4. Tool policy update targets the configured agent

Session runtime plugin/tool policy logic will update the OpenClaw `agents.list` entry whose `id` equals the configured `agentId` and whose workspace binding matches the explicit workspace. It must not update a default agent or a fixed `llmwiki` entry.

If multiple entries for the same `agentId` remain ambiguous after workspace normalization, the lifecycle command fails before mutation.

The existing plugin id/group can remain stable for compatibility in this change. It is treated as an installer-owned runtime artifact identifier, not as the semantic target agent id.

Alternative considered: derive a unique plugin id from each `agentId`. Rejected for this change because it would expand migration and uninstall complexity, change manifest hashes, and require re-home semantics that are not needed to make agent targeting correct.

### 5. Generated workspace docs stay deterministic and generic

`AGENTS.md`, `SOUL.md`, `TOOLS.md`, and `HEARTBEAT.md` will not inject the concrete installation `agentId`. They will say the KB is bound to the installer-configured OpenClaw agent and keep English code identifiers such as `agentId`, `--agent-id`, `--workspace`, and `KB_ROOT`.

This preserves deterministic template hashes and avoids turning agent retargeting into workspace-doc hash drift.

Alternative considered: inject the concrete `agentId` into docs. Rejected because it increases manifest hash drift, repair, and re-home complexity without improving the generic operational contract.

### 6. Tests cover both resolver behavior and installer substrate behavior

Focused tests should cover:

- resolver success for a non-`llmwiki` `agentId` with matching workspace
- fail-closed missing agent id
- fail-closed malformed workspace entries
- fail-closed multiple workspace bindings for the same `agentId`
- fail-closed workspace belonging to another agent
- CLI parsing and defaults for `--agent-id`
- manifest metadata records configured `agentId`
- later command args mismatch with manifest `agentId` creates drift/failure
- tool policy update mutates the configured agent, not a fixed `llmwiki`
- generated workspace docs use generic installer-configured agent wording and do not assert `llmwiki` as target

Existing tests for external `KB_ROOT`, saved MCP config alone being insufficient, standalone MCP as debug-only, and canonical 11 `kb_*` tools should remain.

## Risks / Trade-offs

- [Legacy plugin id still contains `llmwiki`] -> Mitigation: keep it as an internal compatibility identifier for this change and remove target-agent semantics from code paths, docs, and tests.
- [Agent retargeting can mutate the wrong policy if binding checks are weak] -> Mitigation: require successful generic binding resolution before any OpenClaw `agents.list` mutation.
- [Manifest mismatch handling could block legitimate recovery] -> Mitigation: preserve existing `--force` escape hatches only where ownership is otherwise recognizable and document the failure reason clearly.
- [Generated docs lose concrete agent context] -> Mitigation: refer to the installer-configured agent and the exact `--agent-id` / `--workspace` inputs; keep deterministic hashes stable.
- [Many tests currently assert `llmwiki` text] -> Mitigation: update tests to assert generic semantics while preserving the explicit default value only in CLI/help/repo docs where appropriate.

## Migration Plan

1. Add `agentId` to parsed CLI args and resolved installer environment, defaulting to `llmwiki`.
2. Replace fixed binding resolver with generic agent binding resolver and update lifecycle commands to call it.
3. Thread `agentId` through install/check/repair/uninstall, session runtime metadata, manifest validation, drift reporting, and session runtime probes.
4. Update tool policy helpers to select the bound configured agent.
5. Update generated workspace docs and operator-facing repo docs.
6. Update focused tests and run targeted installer tests plus typecheck.

Rollback strategy: revert to the archived fixed-`llmwiki` binding behavior together with the CLI/manifest changes. No KB data migration is required because `KB_ROOT` layout remains unchanged.

## Open Questions

None for the initial implementation. The plugin id/group rename can be considered later as a separate compatibility and migration change.
