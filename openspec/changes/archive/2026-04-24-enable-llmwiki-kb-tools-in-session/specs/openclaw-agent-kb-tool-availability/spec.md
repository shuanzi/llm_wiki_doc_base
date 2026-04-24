## ADDED Requirements

### Requirement: `llmwiki` agent sessions expose canonical KB tools
After a healthy OpenClaw KB install, the targeted `llmwiki` agent session SHALL expose the canonical 11-tool KB surface directly:

- `kb_source_add`
- `kb_read_source`
- `kb_write_page`
- `kb_update_section`
- `kb_ensure_entry`
- `kb_search_wiki`
- `kb_read_page`
- `kb_commit`
- `kb_rebuild_index`
- `kb_run_lint`
- `kb_repair`

#### Scenario: Healthy install exposes expected KB tools through the official runtime harness
- **WHEN** an operator installs the OpenClaw KB integration for the `llmwiki` agent successfully
- **THEN** the official OpenClaw runtime/internal harness for the targeted `llmwiki` workspace can see the canonical 11-tool KB surface

#### Scenario: Install fails when session-visible KB tools cannot be materialized
- **WHEN** installer setup reaches the point where `llmwiki` should receive the canonical 11 KB tools
- **AND** the installer cannot materialize or enable that session-visible surface
- **THEN** `install` fails with a non-success result
- **AND** the failure explains that `llmwiki` does not have the canonical KB tools in-session

#### Scenario: Read-only KB tool call succeeds through the official runtime harness
- **WHEN** the healthy `llmwiki` session-visible runtime resolved through the official OpenClaw runtime/internal harness invokes `kb_read_page` against `wiki/index.md` under the configured external `KB_ROOT`
- **THEN** the tool call succeeds
- **AND** the returned content comes from the configured external KB rather than the OpenClaw workspace

### Requirement: Installer health MUST validate session-visible KB tools
Installer health evaluation SHALL treat session-visible KB tool availability as a required success condition for OpenClaw integration, not merely the presence of saved MCP config or on-disk skills.

Installer `install` and `check` SHALL validate both:

- visibility of the canonical 11-tool KB surface through the official OpenClaw runtime/internal harness for the targeted `llmwiki` workspace
- successful invocation of `kb_read_page` against `wiki/index.md`

#### Scenario: Saved MCP config exists but session tools are absent
- **WHEN** the installer-owned MCP registration exists and the standalone KB server can still be probed
- **AND** the official OpenClaw runtime/internal harness for the targeted `llmwiki` workspace does not receive the canonical `kb_*` tools
- **THEN** installer `check` reports the integration as unhealthy
- **AND** the reported drift explains that session-visible KB tools are missing

#### Scenario: Tool names are visible but live invocation fails
- **WHEN** the official OpenClaw runtime/internal harness for the targeted `llmwiki` workspace can see the canonical 11 KB tools
- **AND** `kb_read_page("wiki/index.md")` does not succeed against the configured external `KB_ROOT`
- **THEN** installer `install` and `check` report the integration as unhealthy
- **AND** the failure explains that session-visible KB tooling is present but not operational

#### Scenario: Repair restores missing session-visible KB tools
- **WHEN** installer-owned session integration state has drifted but ownership is still recognizable
- **THEN** `repair` restores the session-visible KB tool surface conservatively
- **AND** a follow-up health check confirms the official OpenClaw runtime/internal harness for `llmwiki` can see the expected KB tools again

#### Scenario: Legacy install is upgraded to include session integration metadata
- **WHEN** the installer encounters a pre-existing OpenClaw KB install whose manifest predates the session-visible runtime metadata
- **AND** installer ownership is still recognizable
- **THEN** install or repair upgrades the install in place
- **AND** subsequent health checks validate the canonical 11-tool KB surface through the official OpenClaw runtime/internal harness

### Requirement: Repair and uninstall act only on recognizable installer-owned session integration
Repair and uninstall SHALL mutate session-visible runtime artifacts only when installer ownership is recognizable from explicit metadata or an exact legacy artifact match for the explicit workspace.

Ownership is recognizable when either:

- the installer manifest records the session-visible runtime artifact metadata for the explicit workspace, or
- legacy installer state matches the explicit workspace and `mcpName` through the exact runtime artifact path plus exact content hash/build fingerprint, together with the installer-owned compatibility MCP registration and the installer-owned skill/workspace-doc hashes

#### Scenario: Uninstall removes only recognizable installer-owned artifacts
- **WHEN** uninstall runs against a workspace whose session-visible KB integration ownership is recognizable
- **THEN** uninstall removes only the installer-owned session runtime artifacts and installer-owned compatibility MCP registration
- **AND** uninstall does not remove unrelated user-managed runtime artifacts

#### Scenario: Uninstall fails closed on unrecognized ownership
- **WHEN** uninstall runs against a workspace whose session-visible KB integration ownership is not recognizable
- **THEN** uninstall fails closed
- **AND** the failure explains that installer ownership could not be established

### Requirement: Installed OpenClaw guidance matches the real session tool contract
The installed OpenClaw skills, generated workspace-root docs, and repository operator docs SHALL primarily describe the KB tool surface that a real `llmwiki` session can use, and MAY note the installer-owned standalone MCP surface as a secondary compatibility/debugging path.

#### Scenario: Installed skills reference session-visible canonical tools
- **WHEN** the installer writes OpenClaw-adapted KB skills into the target workspace
- **THEN** those skills reference the canonical `kb_*` tool names that are actually visible in `llmwiki` sessions

#### Scenario: Workspace docs do not treat saved MCP config as sufficient
- **WHEN** the installer writes generated workspace-root docs for the target workspace
- **THEN** the docs describe session-visible KB tool availability as the success criterion
- **AND** they do not imply that saved outbound MCP config alone guarantees OpenClaw agent usability

#### Scenario: Repository docs follow the same contract wording
- **WHEN** repository operator-facing docs describe the OpenClaw installation contract
- **THEN** they describe session-visible KB tool availability as the success criterion
- **AND** they do not describe saved outbound MCP config alone as sufficient OpenClaw usability evidence
