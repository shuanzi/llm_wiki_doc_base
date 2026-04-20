# MCP Core Refactor Design

## Context

This repository currently exposes the active V2 KB workflow through the root MCP server in `src/mcp_server.ts`.
The server surface is stable and already used by the repository README, skills, and E2E scripts.

At the same time, business logic is still spread across:

- `src/mcp_server.ts` for tool registration and dispatch
- `src/tools/kb_*.ts` for request handling plus business behavior
- `src/utils/*.ts` for low-level helpers and partial domain rules

There is also a more advanced Phase 2 implementation under `worktree/` that introduces:

- batch page writes
- recovery markers
- deterministic lint and repair
- index rebuild and page move support

The chosen direction is:

1. Keep MCP as the primary runtime surface.
2. Do not adopt the OpenClaw plugin path.
3. Refactor the current implementation into a thinner transport layer plus shared KB core modules.
4. Merge `kb_run_lint`, `kb_repair`, and `kb_rebuild_index` into the mainline implementation.
5. Do not merge `kb_write_pages` or recovery semantics in this round.

## Goals

- Preserve the existing 8 workflow-tool contracts exactly.
- Reduce coupling between transport, file I/O, validation, and KB domain rules.
- Create a clear internal core that can absorb selected Phase 2 features without another structural rewrite.
- Add deterministic maintenance tools (`kb_run_lint`, `kb_repair`, `kb_rebuild_index`) to the main MCP surface.
- Keep repository documentation aligned with the new architecture.

## Non-Goals

- Replacing MCP with OpenClaw plugins.
- Introducing `kb_write_pages` in this round.
- Reworking the ingest/query skills beyond the minimum needed for new tool availability.
- Redesigning KB content semantics or the wiki schema.
- Changing the request/response contract of the current 8 workflow tools unless required for correctness.

## Recommended Architecture

### 1. Thin MCP entrypoint

`src/mcp_server.ts` should become a pure adapter layer responsible for:

- resolving `kb_root`
- startup guard behavior
- tool schema declaration
- tool dispatch
- JSON-RPC response shaping

It should not contain KB-specific branching other than routing to handlers.

### 2. Shared core modules

Introduce `src/core/` and move domain logic into focused modules:

- `core/source-registry.ts`
  - source registration
  - manifest loading
  - source reading
  - source id / content hash workflows
- `core/wiki-pages.ts`
  - full page write
  - section update
  - frontmatter + semantic validation hooks
  - page index maintenance helpers
- `core/wiki-log.ts`
  - idempotent entry insertion
  - index/log update helpers
- `core/wiki-search.ts`
  - page index loading
  - keyword search
  - wikilink resolution
- `core/wiki-maintenance.ts`
  - page index rebuild
  - deterministic lint
  - structural repair
- `core/git.ts`
  - KB commit behavior

The current `src/tools/kb_*.ts` files should depend on these modules and become thin tool adapters.

### 2.5 Package entrypoint remains explicit

`src/index.ts` must remain the package library entrypoint because `package.json` still points `main` and `types` at `dist/index.js` and `dist/index.d.ts`.

In this refactor:

- `src/index.ts` remains a stable export surface for library consumers
- `src/mcp_server.ts` remains the executable MCP entrypoint
- `src/index.ts` must not be repurposed into a plugin entry or transport entry

If a future cleanup wants to retire `src/index.ts`, that must be a separate change with an explicit package-entry migration.

### 3. Utilities remain utilities

Keep generic helpers in `src/utils/`, but reduce domain leakage there.

Expected end state:

- `src/utils/`
  - generic file/path/hash/frontmatter helpers
- `src/core/`
  - KB domain logic
- `src/tools/`
  - MCP-facing request adapters

### 4. Selective Phase 2 absorption

Merge only the maintenance capabilities that provide immediate value with limited interface risk:

- `kb_rebuild_index`
- `kb_run_lint`
- `kb_repair`

Do not merge in this phase:

- `kb_write_pages`
- write recovery markers
- rollback/resume flows
- audit ingest records as mandatory write-time semantics

These can be evaluated later after the core split is complete.

## Why This Design

This is the lowest-risk path that improves maintainability without forcing a workflow rewrite.

It preserves the active root implementation that the repository already documents, while borrowing the strongest ideas from the more advanced `worktree` implementation. It also avoids prematurely adopting the heaviest parts of Phase 2, especially batch writes and recovery semantics, which would expand surface area and test cost significantly.

## External Behavior After Refactor

### Preserved

- Existing MCP startup method
- Existing 8 workflow tool names, schemas, payload shapes, and semantics
- Current ingest/query scripts keep working
- Current KB path safety constraints
- Current wiki-first query model

### Added

- 3 additive maintenance tools:
  - `kb_rebuild_index`
  - `kb_run_lint`
  - `kb_repair`

### Deferred

- batch multi-page writes
- transactional write recovery
- page move tooling

## Data and Flow Implications

### Existing single-page workflow remains

The repository keeps the current workflow shape:

1. register source
2. read source
3. search wiki
4. read page(s)
5. write/update page(s)
6. update index/log entries
7. commit

### New maintenance workflow

The repository gains a dedicated maintenance path:

1. run lint
2. inspect deterministic vs semantic findings
3. optionally repair structural issues
4. rebuild page index when needed
5. rerun lint for verification

This closes a known gap in the current root implementation: index drift and structural inconsistency can be detected and fixed through tools instead of only through conventions and scripts.

## Maintenance Tool Contracts

The maintenance tools are additive. They do not alter the behavior of the 8 existing workflow tools.

| Tool | Mutates KB | Allowed write scope | Dry run | Logging behavior | Output expectation |
| --- | --- | --- | --- | --- | --- |
| `kb_rebuild_index` | Yes | `kb/state/cache/page-index.json` only | No | Does not append a run log entry to `kb/wiki/log.md` | Deterministic summary including version, page count, and written path |
| `kb_run_lint` | No | None | Not applicable | Does not append a run log entry to `kb/wiki/log.md` | Structured report separating deterministic issues from semantic issues |
| `kb_repair` | Yes | Structural artifacts only: `kb/wiki/index.md`, `kb/wiki/log.md`, `kb/state/cache/page-index.json` | Yes | May rewrite `kb/wiki/log.md` only when restoring a missing or malformed structural artifact; it must not append a repair-run log entry | Structured fix summary plus post-repair lint report |

Additional constraints:

- `kb_repair` in this phase must not modify source, concept, entity, analysis, or report page content.
- `kb_repair` in this phase must not depend on `kb/state/audit/*`.
- `kb_rebuild_index` must be deterministic for the same wiki tree.
- `kb_run_lint` must include semantic checks by default. The root MCP surface may optionally support `include_semantic: false` to suppress them, but the default behavior must be stable and include them.
- Logging of lint passes remains a workflow concern in skills or higher-level automation, not an automatic side effect of the tools introduced in this refactor.

## Risks

### 1. Contract drift between current tools and new core

Risk:
Thin adapters accidentally change current error messages, return payloads, or validation timing.

Mitigation:

- treat current tool behavior as the contract
- add regression tests around current tool outputs before moving code

### 2. Partial cherry-picking from `worktree`

Risk:
Copying selected maintenance features without the surrounding write model can create inconsistent assumptions.

Mitigation:

- merge only code paths that are independent of batch write/recovery
- keep maintenance functions behind dedicated modules and tests

### 3. Documentation divergence

Risk:
README and technical docs continue describing the old internal structure.

Mitigation:

- update docs in the same milestone as code refactor

## Testing Strategy

### Regression coverage for current behavior

- existing E2E ingest flow must continue to pass
- search and read behavior must remain compatible
- path safety and symlink constraints must stay enforced

### New maintenance coverage

- rebuild index from wiki tree
- lint detects duplicate ids, stale cache, broken wikilinks, missing meta pages
- repair restores structural artifacts and rebuilds cache
- maintenance outputs are asserted for exact shape where practical

### Scope boundary

No new semantic authoring workflow should be introduced in this phase.
Testing should focus on preserving current behavior plus validating the three new maintenance tools.

## Rollout Plan

### Phase 1

- split logic into `core/`
- keep existing 8 MCP tools unchanged

### Phase 2

- merge `kb_rebuild_index`, `kb_run_lint`, `kb_repair`
- wire them into the root MCP server
- keep maintenance semantics limited to the contract table above

### Phase 3

- update docs and scripts where needed
- decide later whether `kb_write_pages` is justified

## Open Questions

No blocking product question remains for the selected scope.

Implementation-level choices should be resolved during the plan:

- how much current tool error text must be preserved exactly
- whether to import selected `worktree` code directly or port behavior into new `src/core/` modules
