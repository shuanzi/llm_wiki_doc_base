## 1. Contract And Documentation

- [x] 1.1 Add a new OpenSpec capability that defines session-visible KB tool availability for `llmwiki`
- [x] 1.2 Add a delta spec for workspace-targeting that defines how explicit `--workspace` binds to the `llmwiki` agent and when ambiguity fails closed
- [x] 1.3 Update `README.md`, `docs/openclaw-installer-agent-guide.md`, generated workspace docs, and installed OpenClaw skill variants so the OpenClaw success contract is "agent session can use the canonical 11 KB tools", not merely "MCP config exists"
- [x] 1.4 Update installer/user-facing status text so drift explicitly reports missing session-visible KB tools and legacy-install upgrade states

## 2. Session-Visible Runtime Surface

- [x] 2.1 Add an installer-owned session-visible runtime adapter that exposes the canonical 11 KB tools inside `llmwiki` sessions
- [x] 2.2 Reuse the existing KB tool/core modules so the OpenClaw session tool behavior matches current MCP contracts and external `KB_ROOT` semantics
- [x] 2.3 Make the runtime artifact packaging/build/install/enablement path explicit, including any new build outputs and installer preflight checks required to materialize the session-visible surface
- [x] 2.4 Ensure the session-visible tool surface preserves the exact canonical tool names from the current 11-tool KB contract

## 3. Installer Lifecycle Integration

- [x] 3.1 Extend installer `install` to materialize and/or enable the session-visible KB tool surface for the `llmwiki` agent bound to the explicit workspace, and fail closed if that surface cannot be made available
- [x] 3.2 Extend installer manifest, `check`, `repair`, and `uninstall` logic to track and manage the new session-visible integration artifacts and ownership metadata
- [x] 3.3 Add upgrade/backfill behavior for pre-existing installs whose manifests predate the session-visible runtime metadata
- [x] 3.4 Define conservative ownership rules for `repair` and `uninstall`, including when legacy state is recognizable and whether installer-owned compatibility MCP config is removed
- [x] 3.5 Keep the standalone MCP server path explicitly scoped as a secondary compatibility/debugging surface

## 4. Validation Coverage

- [x] 4.1 Add validation coverage that detects the current failure mode where `mcp.servers` looks healthy but `llmwiki` sessions do not receive the canonical 11 KB tools
- [x] 4.2 Add an end-to-end smoke test that proves the official OpenClaw runtime/internal harness for `llmwiki` can invoke `kb_read_page` against the deterministic fixture path `wiki/index.md`
- [x] 4.3 Add upgrade validation for pre-existing installs and manifest backfill behavior
- [x] 4.4 Add lifecycle validation that `repair` restores the session-visible surface, `uninstall` removes only installer-owned artifacts, and ownership ambiguity still fails closed
- [x] 4.5 Run the targeted validation suite and confirm the installer reports success only when session-visible KB tools are actually available
