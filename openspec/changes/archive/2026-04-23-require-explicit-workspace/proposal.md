## Why

The installer currently mixes two different concerns: resolving the current OpenClaw default-agent workspace and validating the workspace the operator explicitly wants to manage. That makes `install`, `repair`, and `uninstall` reject a valid explicit `--workspace` value when it does not match the current default agent, which is operationally incorrect and makes error handling misleading.

## What Changes

- Make `--workspace` a required argument for all installer commands, including `check`.
- Treat `--workspace` as the only target workspace for installer operations.
- Validate the explicit workspace path directly and fail when the path does not exist or is not a directory.
- Remove the current default-agent workspace match requirement from installer command execution.
- Allow explicit workspace targeting to proceed even when current default-agent selection is ambiguous.
- Remove default-agent-specific eligibility checks from installer status evaluation when they do not describe the explicitly targeted workspace.
- Update CLI help text, repository docs, generated workspace docs, and validation coverage to reflect the explicit-workspace contract.

## Capabilities

### New Capabilities
- `openclaw-installer-workspace-targeting`: Defines explicit workspace targeting requirements for installer CLI commands and workspace validation behavior.

### Modified Capabilities

## Impact

- Affected code: `src/openclaw-installer/{args,workspace,check,install,repair,uninstall}.ts`, `src/openclaw_installer.ts`
- Affected docs: `README.md`, `docs/openclaw-installer-agent-guide.md`, and generated workspace docs from `src/openclaw-installer/workspace-docs.ts`
- Affected validation: installer install/check/repair/uninstall validation scripts
- Breaking surface: `check` now requires `--workspace`, and `install` no longer creates a missing workspace directory
