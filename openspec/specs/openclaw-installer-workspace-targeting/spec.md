## Purpose

Define how the OpenClaw installer targets and validates workspace paths for installer operations.
## Requirements
### Requirement: Installer commands require an explicit workspace target
The installer CLI SHALL require `--workspace` for `install`, `check`, `repair`, and `uninstall`.

#### Scenario: Check without workspace is rejected
- **WHEN** an operator runs `check` without `--workspace`
- **THEN** the CLI rejects the invocation as invalid usage

#### Scenario: Repair without workspace is rejected
- **WHEN** an operator runs `repair` without `--workspace`
- **THEN** the CLI rejects the invocation as invalid usage

### Requirement: Installer commands target the explicit workspace path only
The installer SHALL normalize the operator-provided `--workspace` path and use that path as the only workspace target for command execution. The installer MUST NOT require the explicit path to match the current OpenClaw default-agent workspace.

#### Scenario: Explicit non-default workspace is accepted
- **WHEN** an operator runs an installer command with a valid workspace path that does not match the current OpenClaw default-agent workspace
- **THEN** the installer continues to operate on the explicit workspace path

#### Scenario: Default-agent ambiguity does not block explicit workspace targeting
- **WHEN** OpenClaw default-agent configuration is ambiguous but the operator provides a valid explicit workspace path
- **THEN** installer workspace targeting still resolves to the explicit workspace path

### Requirement: Installer commands fail on invalid explicit workspace paths
The installer SHALL fail when the explicit `--workspace` path does not exist or is not a directory.

#### Scenario: Missing workspace path fails
- **WHEN** an operator runs an installer command with a `--workspace` path that does not exist
- **THEN** the command fails with an error indicating that the workspace path does not exist

#### Scenario: Non-directory workspace path fails
- **WHEN** an operator runs an installer command with a `--workspace` path that resolves to a regular file
- **THEN** the command fails with an error indicating that the workspace path is not a directory

#### Scenario: Plain check with missing workspace fails immediately
- **WHEN** an operator runs `check --workspace <missing-path>` without `--json`
- **THEN** the command exits with a non-zero status
- **AND** the command reports the invalid workspace path directly instead of returning a drift report

### Requirement: Check status MUST NOT depend on default-agent-only eligibility logic
The installer `check` command SHALL evaluate the explicitly targeted workspace without requiring the current default agent to include installer-specific skills or other default-agent-only eligibility signals.

#### Scenario: Default-agent skill restrictions do not block explicit workspace check
- **WHEN** the current default agent excludes installer skills but the operator runs `check` against a valid explicit workspace
- **THEN** the check result is determined by the targeted workspace state rather than default-agent-only skill restrictions

#### Scenario: Ambiguous default-agent selection does not block explicit workspace check
- **WHEN** OpenClaw default-agent selection is ambiguous and the operator runs `check` against a valid explicit workspace
- **THEN** the check continues to evaluate the explicit workspace target

### Requirement: Check JSON preserves structured failure output for invalid workspace paths
When `check --json` is used, the installer SHALL return structured failure output even if the explicit workspace path is invalid.

#### Scenario: Check JSON with missing workspace returns structured failure
- **WHEN** an operator runs `check --workspace <missing-path> --json`
- **THEN** the command emits structured JSON with `ok` set to `false`
- **AND** the failure message explains that the workspace path is invalid

### Requirement: Session-visible KB integration binds the explicit workspace to `llmwiki`
For this change, the installer SHALL treat the explicit `--workspace` target as the workspace of the OpenClaw agent whose `id` is `llmwiki` when evaluating session-visible KB tool availability.

The binding comparison SHALL use the normalized explicit workspace path after installer workspace validation. Runtime states are ambiguous when more than one plausible `llmwiki` workspace binding remains after normalization, or when OpenClaw config/runtime sources disagree about which normalized workspace belongs to `llmwiki`.

#### Scenario: Explicit workspace matches `llmwiki`
- **WHEN** an operator runs an installer lifecycle command with `--workspace <path>`
- **AND** the OpenClaw agent `llmwiki` resolves to `<path>`
- **THEN** session-visible KB integration evaluation continues for that workspace

#### Scenario: Missing `llmwiki` binding fails closed
- **WHEN** an operator runs an installer lifecycle command with `--workspace <path>`
- **AND** no OpenClaw agent with `id` `llmwiki` resolves to `<path>`
- **THEN** the command fails closed
- **AND** the error explains that the explicit workspace is not bound to `llmwiki`

#### Scenario: Ambiguous session-visible target fails closed
- **WHEN** an operator runs an installer lifecycle command with `--workspace <path>`
- **AND** OpenClaw agent/runtime state makes the session-visible KB target ambiguous for `llmwiki`
- **THEN** the command fails closed instead of guessing which session-visible runtime surface to manage
