## Context

The current installer was designed around an external KB runtime:

- OpenClaw stores an MCP server definition pointing at this repository's `dist/mcp_server.js`
- the installer writes OpenClaw-adapted KB skills into the target workspace
- installer `check` verifies saved config plus an active stdio MCP probe

That contract is incomplete for the actual `llmwiki` user journey. A real `openclaw agent --agent llmwiki` turn can complete without ever seeing `kb_read_page`, `kb_search_wiki`, or any other KB tool. The observed failure mode is therefore not "MCP server is broken", but "agent session tool injection does not include the KB surface the skills assume exists".

The design goal of this change is to make session-visible KB tools the primary OpenClaw integration contract for `llmwiki`.

## Goals / Non-Goals

**Goals:**
- Guarantee that `llmwiki` agent sessions can directly invoke the canonical 11 KB tools after a healthy install.
- Reuse the existing KB tool semantics and external `KB_ROOT` behavior instead of inventing a second KB domain model.
- Upgrade installer lifecycle commands so they validate, repair, and report session-visible KB tool availability.
- Define deterministic upgrade behavior for existing installs whose manifests predate session-visible integration metadata.
- Keep documentation and installed skills aligned with the tool surface a real OpenClaw session actually sees.

**Non-Goals:**
- Redesigning KB wiki/raw semantics or changing the external `KB_ROOT` model.
- Generalizing the first implementation to every OpenClaw agent or every plugin format.
- Replacing the standalone MCP server for non-OpenClaw consumers.
- Reworking KB workflows beyond the changes required to make them usable inside `llmwiki` sessions.

## Decisions

### 1. `llmwiki` session usability becomes the primary integration contract

The installer will no longer treat "saved `mcp.servers` entry + successful stdio probe" as the end-state contract. The primary success criterion becomes: the targeted `llmwiki` session-visible runtime surface can see and invoke KB tools, and installer validation must prove that through OpenClaw's own runtime loading path.

This directly matches operator expectations and closes the current gap where skills are present but unusable.

Alternatives considered:
- Keep the existing contract and only document the limitation. Rejected because it preserves a misleading install surface.
- Treat skill file presence as sufficient. Rejected because the observed failure is precisely that skills exist while tools are absent.

### 2. Canonical `kb_*` tools should be exposed through a session-visible OpenClaw-native surface

To preserve canonical tool names such as `kb_read_page` and `kb_search_wiki`, the implementation should add a session-visible OpenClaw integration surface that registers those tools directly for the `llmwiki` agent session while reusing the existing KB business logic.

The required session-visible tool set is the current canonical 11-tool surface:

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

One acceptable implementation direction is a native OpenClaw plugin adapter that:

- registers canonical `kb_*` tools in OpenClaw's runtime tool registry
- resolves the configured external `KB_ROOT`
- reuses the current KB tool/core modules so behavior stays aligned with the MCP server contracts

This keeps session-visible tool names stable and avoids depending on a host runtime that may rename or hide outbound MCP tools. The change does not require a specific packaging mechanism as long as the runtime surface remains installer-owned, session-visible, and preserves the canonical tool names above.

Alternatives considered:
- Keep using only outbound `mcp.servers`. Rejected because current OpenClaw agent sessions do not surface those tools directly.
- Switch to bundle-MCP-only exposure. Rejected because bundle-style exposure does not preserve the canonical `kb_*` naming contract and still shifts the session tool surface.
- Reimplement KB behavior separately inside OpenClaw. Rejected because it would fork the KB logic and increase drift risk.

### 3. The standalone MCP server remains a secondary compatibility surface

The repository should keep `dist/mcp_server.js` and the external MCP registration path for:

- non-OpenClaw consumers
- direct diagnostics
- continuity with the existing installer-managed external KB runtime

However, OpenClaw session success must no longer depend exclusively on that surface.

### 4. Installer lifecycle commands must bind to `llmwiki` explicitly and fail closed

The first implementation of this change is scoped to the OpenClaw agent whose `id` is `llmwiki`.

Lifecycle commands should continue to target an explicit `--workspace`, but the session-visible runtime contract must additionally bind that workspace to the `llmwiki` agent:

- if the `llmwiki` agent resolves to the explicit workspace, continue
- if no `llmwiki` agent exists for that workspace, fail closed
- if multiple conflicting agent bindings would make the session-visible target ambiguous, fail closed

This keeps the contract aligned with the explicit operator goal and avoids silently enabling KB tools for unrelated agents.

### 5. Installer lifecycle commands must manage and validate the session-visible integration

`install`, `check`, `repair`, and `uninstall` must become aware of the OpenClaw-native session tool surface. That includes:

- materializing or enabling the runtime artifact that exposes the canonical 11-tool KB surface
- failing `install` if that session-visible surface cannot be materialized for `llmwiki`
- recording ownership metadata in the installer manifest
- validating that `llmwiki` sees the expected tool names
- treating missing session-visible KB tools as drift even if raw MCP config still exists

`repair` should restore installer-owned session integration conservatively, and `uninstall` should remove only installer-owned OpenClaw KB runtime artifacts together with any installer-owned compatibility MCP registration.

Ownership must be considered recognizable when either:

- the installer manifest already records the session-visible runtime artifact metadata, or
- legacy install state can be matched deterministically through the exact installer-owned artifact set for the explicit workspace:
  - the runtime artifact path
  - the runtime artifact content hash or equivalent exact build fingerprint
  - the installer-owned compatibility MCP registration identified by `mcpName`
  - the installer-owned skill/workspace-doc hashes already tracked by the manifest model

If recognizability cannot be established, `repair` and `uninstall` must fail closed rather than guessing.

### 6. Existing installs must be upgraded in place

Current installs already have manifests that track MCP registration and workspace skills but not any future session-visible runtime artifact metadata.

This change should support in-place upgrade for those installs:

- `install` should backfill the new manifest/runtime metadata when upgrading a healthy existing install
- `repair` should be able to reconstruct the new metadata from recognizable legacy installer state
- `uninstall` should remain able to remove both legacy installer-owned state and the new session-visible runtime artifact after upgrade

### 7. Validation must include an official runtime smoke test

The current active MCP probe proves that the server process boots and lists tools. It does not prove that OpenClaw agent sessions can use those tools.

This change will add a higher-level validation step that proves session visibility. Because OpenClaw does not currently expose a deterministic, non-model session-test harness for a literal `openclaw agent --agent llmwiki` turn, the acceptance path for this change will use the official OpenClaw runtime/internal harness that resolves the same plugin-backed session-visible surface. The minimum acceptance path should:

- target the installed `llmwiki` agent
- confirm the session-visible tool list includes the canonical 11-tool KB surface through the official runtime/internal harness
- invoke at least one read-only KB tool such as `kb_read_page` against the deterministic fixture path `wiki/index.md` through that same harness

This smoke test should be part of installer validation coverage and the operator-facing success criteria. `install` and `check` should not report success on tool-name visibility alone.

### 8. Installed skills and docs must bind to the real session tool contract

The installed skill variants already assume direct access to `kb_*` tools. After this change, that assumption becomes a guaranteed installer contract rather than a best-effort artifact write.

Generated workspace docs and repo docs should be updated to explain:

- which surface makes the tools available in `llmwiki` sessions
- that installer health requires session-visible KB tools
- that standalone MCP config alone is not enough for OpenClaw usability
- that the standalone MCP surface remains available as a secondary compatibility/debugging path

## Risks / Trade-offs

- [Broader integration scope] Introducing an OpenClaw-native tool surface is a larger change than tweaking `check`.
  Mitigation: keep the adapter thin and reuse existing KB tool/core modules.

- [Dual-surface drift] Session-visible OpenClaw tools and standalone MCP tools could diverge.
  Mitigation: treat the existing KB tool modules as the shared source of truth and keep schemas/contracts aligned.

- [Installer ownership complexity] The manifest must now track more than MCP registration and skill files.
  Mitigation: add explicit plugin/session metadata to the manifest and extend ownership checks consistently across install/check/repair/uninstall.

- [Validation fragility] A literal agent-turn smoke test would be slower and more environment-sensitive than a stdio probe, and OpenClaw does not currently expose a deterministic test harness for it.
  Mitigation: use the official runtime/internal harness that resolves the same session-visible plugin surface, keep the smoke test read-only and deterministic by targeting `wiki/index.md`, and preserve lower-level probes for fast diagnostics.

- [Runtime packaging ambiguity] The session-visible tool surface may require new runtime packaging or build artifacts.
  Mitigation: treat runtime artifact packaging/build/preflight as explicit implementation work, and keep the packaging mechanism open as long as the canonical tool contract is preserved.

- [Revisiting an earlier design boundary] The prior installer work intentionally avoided the native plugin path.
  Mitigation: scope the new session-visible runtime surface only to the session-visibility requirement and keep MCP support for external compatibility.

## Migration Plan

1. Add the session-visible OpenClaw KB tool surface with canonical `kb_*` registration.
2. Update installer lifecycle code and manifest schema to manage the new artifact, agent binding, and validation path.
3. Backfill legacy installs so pre-existing manifests can be upgraded in place without losing ownership safety.
4. Update installed skills and docs so their instructions match the actual OpenClaw runtime contract.
5. Add validation that proves the official OpenClaw runtime/internal harness for `llmwiki` can see and invoke KB tools, including upgrade, repair, and uninstall scenarios.
6. Keep the standalone MCP server path operational, but demote it to a secondary health signal for OpenClaw installs.

Rollback strategy: revert the session-visible runtime surface and restore the prior installer contract together. This is a code/config change and does not require KB data migration.

## Open Questions

None at proposal time. The contract change is clear: `llmwiki` session usability is the required outcome, and any implementation that preserves the canonical 11-tool KB surface while making it session-visible is acceptable.
