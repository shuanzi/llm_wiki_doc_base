## Why

The current OpenClaw installer proves only that:

- an external MCP server definition exists under `mcp.servers`
- the built `dist/mcp_server.js` process can boot and list the expected `kb_*` tools
- OpenClaw-adapted KB skills were written into the target workspace

That is not sufficient for the actual operator goal. In a real `openclaw agent --agent llmwiki ...` turn, the `llmwiki` agent session does not receive `kb_*` tools at all, which makes the installed KB skills operationally misleading. The integration therefore succeeds at config registration but fails at the user-facing workflow contract.

## What Changes

- Redefine the OpenClaw integration contract so a successful install means `llmwiki` agent sessions can directly call the canonical 11-tool KB surface: `kb_source_add`, `kb_read_source`, `kb_write_page`, `kb_update_section`, `kb_ensure_entry`, `kb_search_wiki`, `kb_read_page`, `kb_commit`, `kb_rebuild_index`, `kb_run_lint`, and `kb_repair`.
- Introduce a session-visible OpenClaw runtime surface for KB tools instead of treating saved outbound MCP config as sufficient evidence.
- Make `install` fail closed when the installer cannot materialize that session-visible KB tool surface for the targeted `llmwiki` agent.
- Keep the standalone MCP server as a secondary compatibility/debugging surface, but stop using it as the only success criterion for OpenClaw agent usability.
- Extend installer ownership, `check`, `repair`, and `uninstall` behavior to manage and validate the session-visible KB tool surface.
- Define how the explicit `--workspace` target binds to the `llmwiki` agent and how existing pre-session-surface installs are upgraded in place.
- Update installed skills, generated workspace docs, and repository docs so they describe the actual session-visible contract.
- Add end-to-end validation that proves the official OpenClaw runtime/internal harness for the targeted `llmwiki` workspace can see and invoke the KB tools using the deterministic fixture path `wiki/index.md`.

## Capabilities

### New Capabilities
- `openclaw-agent-kb-tool-availability`: Defines the requirement that `llmwiki` agent sessions expose usable KB tools, not only saved MCP config.

### Modified Capabilities
- `openclaw-installer-workspace-targeting`: Installer status and lifecycle behavior now need to validate the explicitly targeted workspace all the way through session-visible tool availability.

## Impact

- Affected code: installer lifecycle modules under `src/openclaw-installer/`, runtime integration surfaces, tool registration, manifests, and validation scripts
- Affected docs: `README.md`, `docs/openclaw-installer-agent-guide.md`, generated workspace docs, and implementation notes/specs
- Affected validation: installer `install`/`check`/`repair`/`uninstall` validation, legacy-install migration coverage, and a new OpenClaw session smoke-test path
- Contract change: "install succeeded" will now mean "`llmwiki` can directly use the canonical 11 KB tools in-session", not merely "OpenClaw saved an MCP server definition"
