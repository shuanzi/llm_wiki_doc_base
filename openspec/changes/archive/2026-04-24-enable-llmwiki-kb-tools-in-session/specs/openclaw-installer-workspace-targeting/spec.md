## ADDED Requirements

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
