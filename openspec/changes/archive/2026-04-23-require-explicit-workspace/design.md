## Context

The current installer command flow uses `resolveOpenClawWorkspace()` to both discover the current OpenClaw default-agent workspace and validate the operator-supplied `--workspace` argument. That couples installer execution to mutable OpenClaw agent state and causes explicit workspace operations to fail when the requested path does not match the currently selected default agent.

The change touches command-line parsing, workspace validation, runtime command behavior, status reporting, and validation scripts. It also changes two operator-visible behaviors: `check` must now receive `--workspace`, and `install` must stop auto-creating a missing workspace directory.

## Goals / Non-Goals

**Goals:**
- Enforce `--workspace` as a required explicit target for all installer commands.
- Validate the explicit workspace path directly and fail when the path does not exist or is not a directory.
- Remove default-agent workspace matching from installer command execution.
- Remove default-agent-specific eligibility checks that no longer describe the explicitly targeted workspace.
- Keep current ownership and drift protections based on manifest, MCP config, and on-disk artifacts.

**Non-Goals:**
- Changing OpenClaw's own default-agent semantics.
- Redesigning installer manifest ownership rules.
- Adding support for creating brand-new workspaces from installer commands.

## Decisions

### 1. Explicit workspace becomes the only installer target
The installer will treat `--workspace` as authoritative input for `install`, `check`, `repair`, and `uninstall`. This removes the current ambiguity between "requested target" and "current OpenClaw default workspace".

Alternatives considered:
- Keep current default-agent matching for mutating commands only. Rejected because it still makes explicit workspace operations depend on unrelated UI/config state.
- Infer workspace when `--workspace` is omitted. Rejected because the new contract explicitly requires operators to name the target.

### 2. Workspace validation becomes direct path validation
Command flows will use a narrow helper that normalizes the requested path and asserts that it exists and is a directory. Installer commands will no longer call the current default-agent workspace resolver as part of workspace targeting.

Alternatives considered:
- Keep the current resolver and add a flag to disable matching. Rejected because the resolver still carries unrelated default-agent semantics and error modes.
- Validate existence separately in each command. Rejected because the behavior needs to stay uniform across four commands.

### 3. `check` becomes explicit-target diagnostics
`check` will still report structured drift for installer state, but invalid or missing explicit workspace input becomes an immediate command error. In plain mode that means a direct stderr failure with non-zero exit status rather than a drift report. The existing `--json` failure path remains responsible for rendering structured output on command failure.

Alternatives considered:
- Preserve the old "workspace mismatch" drift item behavior. Rejected because the new contract says the command must target the explicit path, not compare it to the default agent.

### 4. Remove default-agent-specific eligibility checks from installer status
The current eligibility check is phrased in terms of the "current default agent", which no longer describes the target of `check`. That check will be removed or reduced to generic CLI availability checks so that installer status stays scoped to the explicit workspace target.

### 5. Update all shipped guidance surfaces together
The change must update both repository docs and installer-generated workspace-root docs in the same patch. Otherwise the runtime-generated instructions will continue to tell operators that commands only work against the current default-agent workspace.

## Risks / Trade-offs

- [Breaking CLI behavior] Existing callers that omit `check --workspace` will fail at argument parsing. → Mitigation: update usage text, README, generated workspace docs, and validation coverage in the same change.
- [Breaking install behavior] Existing workflows that rely on installer-created workspace directories will fail. → Mitigation: make the failure message explicit and update test helpers to pre-create workspace directories.
- [Behavior drift in `check`] Removing default-agent eligibility checks reduces one diagnostic surface. → Mitigation: retain manifest, MCP config, build artifact, probe, and on-disk ownership checks, which are the signals that actually describe the targeted workspace.
- [Partial migration risk] Code changes could land while runtime-generated guidance still documents the old contract. → Mitigation: treat `README.md`, `docs/openclaw-installer-agent-guide.md`, and `src/openclaw-installer/workspace-docs.ts` as required update surfaces in the same task group.
- [Refactor risk] Workspace handling is duplicated across install/repair/uninstall/check. → Mitigation: introduce one shared explicit-workspace validation helper and convert all four callers in the same patch.

## Migration Plan

1. Update CLI argument contracts and usage text so every command requires `--workspace`.
2. Introduce shared explicit workspace validation and switch installer commands to use it.
3. Remove default-agent workspace matching and default-agent-specific eligibility checks from installer flows.
4. Update `README.md`, `docs/openclaw-installer-agent-guide.md`, and installer-generated workspace docs to reflect the new operator contract.
5. Update validation scripts for the new required argument, invalid-path behavior, and ambiguous default-agent configurations.

Rollback strategy: revert the command contract and helper changes together. The change is code-only and does not require data migration.

## Open Questions

None at proposal time. The desired workspace contract is explicit and fully specified by the change request.
