## ADDED Requirements

### Requirement: Installer commands accept a configurable agent id
The installer CLI SHALL accept `--agent-id <id>` for `install`, `check`, `repair`, and `uninstall`. When `--agent-id` is omitted, the installer SHALL use `llmwiki` as the default value for compatibility with existing invocations.

#### Scenario: Install uses explicit agent id
- **WHEN** an operator runs `install --workspace <path> --kb-root <kb> --agent-id research`
- **THEN** the installer evaluates OpenClaw workspace binding and session integration for agent `research`

#### Scenario: Check preserves default agent id compatibility
- **WHEN** an operator runs `check --workspace <path>` without `--agent-id`
- **THEN** the installer evaluates OpenClaw workspace binding and session integration for agent `llmwiki`
- **AND** the default is treated as a compatibility default rather than the only supported agent

### Requirement: Session-visible KB integration binds the explicit workspace to the configured agent
For session-visible KB tool availability, the installer SHALL treat the explicit `--workspace` target as the workspace of the OpenClaw agent whose `id` equals the installer-configured `agentId`.

The binding comparison SHALL use the normalized explicit workspace path after installer workspace validation. Runtime states are ambiguous when more than one plausible workspace binding remains for the configured `agentId` after normalization, or when OpenClaw config/runtime sources disagree about which normalized workspace belongs to that `agentId`.

#### Scenario: Explicit workspace matches configured agent
- **WHEN** an operator runs an installer lifecycle command with `--workspace <path> --agent-id research`
- **AND** the OpenClaw agent `research` resolves to `<path>`
- **THEN** session-visible KB integration evaluation continues for that workspace and agent

#### Scenario: Missing configured agent binding fails closed
- **WHEN** an operator runs an installer lifecycle command with `--workspace <path> --agent-id research`
- **AND** no OpenClaw agent with `id` `research` resolves to `<path>`
- **THEN** the command fails closed
- **AND** the error explains that the explicit workspace is not bound to agent `research`

#### Scenario: Ambiguous configured agent target fails closed
- **WHEN** an operator runs an installer lifecycle command with `--workspace <path> --agent-id research`
- **AND** OpenClaw agent/runtime state makes the session-visible KB target ambiguous for agent `research`
- **THEN** the command fails closed instead of guessing which session-visible runtime surface to manage

#### Scenario: Workspace bound to a different agent fails closed
- **WHEN** an operator runs an installer lifecycle command with `--workspace <path> --agent-id research`
- **AND** `<path>` is bound to an OpenClaw agent whose `id` is not `research`
- **THEN** the command fails closed
- **AND** it does not update the other agent's session-visible tool policy

## REMOVED Requirements

### Requirement: Session-visible KB integration binds the explicit workspace to `llmwiki`
**Reason**: The installer no longer treats `llmwiki` as the only valid OpenClaw agent target. The binding target is now the installer-configured `agentId`.

**Migration**: Use `--agent-id <id>` to select the OpenClaw agent. Existing invocations that omit `--agent-id` keep the compatibility default `llmwiki`.
