# MCP Core Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the current root MCP implementation into a thin transport layer plus shared KB core modules, and add `kb_run_lint`, `kb_repair`, and `kb_rebuild_index` without changing the existing 8 workflow-tool contracts.

**Architecture:** Keep `src/mcp_server.ts` as the active executable entrypoint and keep `src/index.ts` as the package library entrypoint. Move KB domain behavior into `src/core/`, convert `src/tools/kb_*.ts` into thin adapters, and port only the deterministic maintenance capabilities from the `worktree` implementation into the root codebase.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/sdk`, filesystem-based KB storage, existing repo scripts and tests.

---

## File Map

### Create

- `src/core/source-registry.ts`
- `src/core/wiki-pages.ts`
- `src/core/wiki-log.ts`
- `src/core/wiki-search.ts`
- `src/core/wiki-maintenance.ts`
- `src/core/git.ts`
- `scripts/validate_kb_tool_contract_baseline.ts`
- `scripts/validate_kb_rebuild_index.ts`
- `scripts/validate_kb_run_lint.ts`
- `scripts/validate_kb_repair.ts`

### Modify

- `src/mcp_server.ts`
- `src/index.ts`
- `src/tools/kb_source_add.ts`
- `src/tools/kb_read_source.ts`
- `src/tools/kb_write_page.ts`
- `src/tools/kb_update_section.ts`
- `src/tools/kb_ensure_entry.ts`
- `src/tools/kb_search_wiki.ts`
- `src/tools/kb_read_page.ts`
- `src/tools/kb_commit.ts`
- `src/utils/frontmatter.ts`
- `src/utils/index.ts`
- `src/types/index.ts`
- `README.md`
- `docs/technical.md`

### Reference Only

- `worktree/packages/mcp-server/src/index.ts`
- `worktree/packages/mcp-server/src/lib/kb-utils.ts`
- `worktree/packages/mcp-server/src/tools/kb-run-lint.ts`
- `worktree/packages/mcp-server/src/tools/kb-repair.ts`
- `worktree/packages/mcp-server/src/tools/kb-rebuild-index.ts`
- `scripts/e2e_v2_ingest.ts`

## Task 1: Freeze Current MCP Contract

**Files:**
- Modify: `src/mcp_server.ts`
- Test: existing E2E and tool-level tests if present

- [ ] **Step 1: Inventory the active MCP contract**

Read and record the current public surface from `src/mcp_server.ts`:

- tool names
- descriptions
- input schemas
- current dispatch behavior
- current error wrapping style

Output this inventory into working notes before refactoring so later tasks can compare against it.

- [ ] **Step 2: Capture current tool behavior with focused regression scripts**

Add or extend script-based checks so the following are locked down:

- `kb_write_page` rejects invalid frontmatter
- `kb_write_page` rejects path writes outside `kb/wiki`
- `kb_ensure_entry` is idempotent
- `kb_search_wiki(resolve_link)` behavior remains unchanged
- `kb_read_page` still resolves `page_id` through `page-index.json`

Create `scripts/validate_kb_tool_contract_baseline.ts` to exercise these failure and invariance cases against an isolated temp KB root.

Run:

```bash
npm run typecheck
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_tool_contract_baseline.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_search_wiki_resolve_link.ts
```

Do not assume a generic `npm test` exists. This repository currently validates behavior through `scripts/**/*` with `tsconfig.scripts.json`.

- [ ] **Step 3: Confirm the E2E ingest script is the compatibility baseline**

Run:

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts /absolute/path/to/sample.md
```

Expected:

- run 1 succeeds
- run 2 is idempotent
- source/entity/concept pages remain readable

Do not proceed with structural refactor until this baseline is green.

## Task 2: Introduce Core Module Boundaries

**Files:**
- Create: `src/core/source-registry.ts`
- Create: `src/core/wiki-pages.ts`
- Create: `src/core/wiki-log.ts`
- Create: `src/core/wiki-search.ts`
- Create: `src/core/git.ts`
- Modify: `src/index.ts`
- Modify: `src/utils/index.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Create `src/core/source-registry.ts`**

Move shared logic for:

- source registration
- manifest loading
- raw source reading

The module should expose plain functions that take `kb_root` or `WorkspaceConfig`, not MCP request objects.

- [ ] **Step 2: Create `src/core/wiki-pages.ts`**

Move shared logic for:

- page write
- section update
- page index update for changed pages

Keep current frontmatter validation behavior intact.

- [ ] **Step 3: Create `src/core/wiki-log.ts`**

Move shared logic for:

- idempotent entry insertion
- anchor-section insertion logic
- optional `updated_at` bump behavior for index/log writes

- [ ] **Step 4: Create `src/core/wiki-search.ts`**

Move shared logic for:

- page index loading
- keyword scoring
- wikilink resolution
- page lookup by id/path

- [ ] **Step 5: Create `src/core/git.ts`**

Move `kb_commit` git behavior into a core module with a narrow API.

- [ ] **Step 6: Export core modules from `src/index.ts` only if needed**

Do not over-export by default. Preserve `src/index.ts` as the package public API and only add exports that are intentionally part of the library surface.

## Task 3: Convert Existing Tools into Thin Adapters

**Files:**
- Modify: `src/tools/kb_source_add.ts`
- Modify: `src/tools/kb_read_source.ts`
- Modify: `src/tools/kb_write_page.ts`
- Modify: `src/tools/kb_update_section.ts`
- Modify: `src/tools/kb_ensure_entry.ts`
- Modify: `src/tools/kb_search_wiki.ts`
- Modify: `src/tools/kb_read_page.ts`
- Modify: `src/tools/kb_commit.ts`

- [ ] **Step 1: Refactor `kb_source_add` and `kb_read_source`**

Keep the same tool inputs and return payloads.
Replace inline business logic with calls into `core/source-registry.ts`.

- [ ] **Step 2: Refactor `kb_write_page` and `kb_update_section`**

Keep path safety, symlink checks, frontmatter validation, and index refresh behavior unchanged.
Move file/domain behavior into `core/wiki-pages.ts`.

- [ ] **Step 3: Refactor `kb_ensure_entry`**

Keep the current dedup marker format and insertion semantics unchanged.
Move entry insertion behavior into `core/wiki-log.ts`.

- [ ] **Step 4: Refactor `kb_search_wiki` and `kb_read_page`**

Preserve current search contract and `page_id` lookup behavior.
Move shared lookup/search logic into `core/wiki-search.ts`.

- [ ] **Step 5: Refactor `kb_commit`**

Move git behavior into `core/git.ts`.
Keep current caveat behavior unchanged in this phase.

- [ ] **Step 6: Re-run regression tests**

Run the targeted tests from Task 1 plus:

```bash
npm run typecheck
npm run build
```

Expected:

- no type regressions
- MCP build still succeeds
- tool behavior remains compatible

## Task 4: Thin the MCP Server

**Files:**
- Modify: `src/mcp_server.ts`

- [ ] **Step 1: Keep `kb_root` resolution and startup guard in place**

Preserve current behavior from the top of `src/mcp_server.ts`:

- `KB_ROOT`
- `WORKSPACE_ROOT/kb`
- fallback `./kb`
- fatal exit when root is missing

- [ ] **Step 2: Leave tool schema definitions in the server**

The server remains the authoritative place for MCP-visible schemas and descriptions.
Do not move JSON Schema declarations into business modules.

- [ ] **Step 3: Make dispatch strictly adapter-based**

Each `dispatchTool` branch should call a thin tool adapter with no extra KB logic in the server.
After this task, `src/mcp_server.ts` should contain:

- configuration
- tool definitions
- dispatch map
- MCP transport connection

and nothing domain-specific beyond routing.

- [ ] **Step 4: Re-run build and smoke start**

Run:

```bash
npm run typecheck
npm run build
node dist/mcp_server.js
```

Expected:

- server starts
- startup log prints resolved `kb_root`
- no fatal import/runtime errors
- the dynamic SDK import workaround with explicit `.js` suffix is still intact after the refactor

## Task 5: Port `kb_rebuild_index`

**Files:**
- Create: `scripts/validate_kb_rebuild_index.ts`
- Modify: `src/core/wiki-maintenance.ts`
- Modify: `src/mcp_server.ts`
- Modify: `src/types/index.ts` if needed

- [ ] **Step 1: Port index rebuild logic into `src/core/wiki-maintenance.ts`**

Bring over the deterministic rebuild behavior from the `worktree` implementation:

- scan `kb/wiki/**/*.md`
- parse frontmatter
- rebuild `kb/state/cache/page-index.json`

Avoid unrelated search/lint code in this task.

- [ ] **Step 2: Add `kb_rebuild_index` tool registration to the root MCP server**

Expose a zero-argument tool matching the current `worktree` behavior closely enough to support future skill use.

- [ ] **Step 3: Add validation script for rebuild behavior**

Test cases:

- rebuild creates cache from wiki files
- rebuild ignores non-markdown files
- rebuild output is deterministic
- validation runs against an isolated temp KB root, not the repository KB

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_rebuild_index.ts
```

Expected:

- all rebuild-index tests pass

## Task 6: Port `kb_run_lint`

**Files:**
- Create: `scripts/validate_kb_run_lint.ts`
- Modify: `src/core/wiki-maintenance.ts`
- Modify: `src/mcp_server.ts`
- Modify: `src/types/index.ts` if needed

- [ ] **Step 1: Port deterministic lint checks first**

Bring over the checks with the highest immediate value:

- duplicate page ids
- cache missing/stale/drift
- missing meta pages
- invalid frontmatter
- broken wikilinks

- [ ] **Step 2: Port semantic warnings second**

Bring over the lightweight semantic checks only if they do not alter current write behavior:

- source pages exist but no concept/entity pages
- missing related links
- stale pages
- analysis pages missing uncertainties/open questions

- [ ] **Step 3: Register `kb_run_lint` in the root MCP server**

Expose:

- default full report with semantic checks enabled
- optional semantic disable flag if you keep parity with `worktree`
- no mutation of KB files
- no implicit `kb/wiki/log.md` write

- [ ] **Step 4: Add lint validation script**

Test cases:

- duplicate ids produce deterministic errors
- broken wikilinks are reported
- stale cache is reported
- semantic warnings are separated from deterministic findings
- validation runs against an isolated temp KB root
- report shape is asserted, not just issue presence

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_run_lint.ts
```

Expected:

- lint tests pass
- report shape is stable and machine-readable

## Task 7: Port `kb_repair`

**Files:**
- Create: `scripts/validate_kb_repair.ts`
- Modify: `src/core/wiki-maintenance.ts`
- Modify: `src/mcp_server.ts`

- [ ] **Step 1: Port structural repair behavior only**

Bring over repair logic for:

- creating missing `kb/wiki/index.md`
- creating missing `kb/wiki/log.md`
- rebuilding page index

Do not include audit restoration in this phase. The root design for this refactor does not introduce `kb/state/audit/*`, so `kb_repair` must not depend on audit records or mention them in its response contract.

- [ ] **Step 2: Keep `kb_repair` write scope narrow**

In this phase, `kb_repair` may write only:

- `kb/wiki/index.md`
- `kb/wiki/log.md`
- `kb/state/cache/page-index.json`

It must not modify source, concept, entity, analysis, or report page content.

- [ ] **Step 3: Register `kb_repair` in the root MCP server**

Expose a tool with:

- `dry_run` support
- structured response with applied fixes and lint summary

- [ ] **Step 4: Add repair validation script**

Test cases:

- dry run reports intended fixes without mutating files
- apply mode restores missing meta pages
- apply mode rebuilds the index
- validation runs against an isolated temp KB root
- validation asserts no page-content files were modified

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_repair.ts
```

Expected:

- repair tests pass

## Task 8: Integrate With Existing Scripts and Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/technical.md`
- Modify: `scripts/e2e_v2_ingest.ts` only if required

- [ ] **Step 1: Update README**

Document:

- new internal architecture (`src/core/`, thin MCP server)
- new maintenance tools
- unchanged active MCP entrypoint

- [ ] **Step 2: Update `docs/technical.md`**

Replace outdated claims about lint being only a skill-layer concern if `kb_run_lint` now exists as a tool.
Document the separation between:

- core business modules
- tool adapters
- MCP transport layer

- [ ] **Step 3: Review E2E script references**

If the E2E script or surrounding docs assume only 8 tools exist, update wording to reflect:

- the original 8 workflow tools remain
- maintenance tools are additive

Do not rewrite the ingest flow unless required.

## Task 9: Full Verification

**Files:**
- Test: all touched paths above

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

- exit code 0

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected:

- exit code 0

- [ ] **Step 3: Run targeted maintenance tests**

Run:

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_rebuild_index.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_run_lint.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_repair.ts
```

Expected:

- all pass

- [ ] **Step 4: Run ingest E2E**

Run:

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts /absolute/path/to/sample.md
```

Expected:

- ingest still succeeds
- second run is idempotent
- `page-index.json` remains readable and coherent

- [ ] **Step 5: Manual MCP smoke test**

Run:

```bash
npm run start:mcp
```

Expected:

- server starts successfully
- tools list includes the original 8 tools plus `kb_rebuild_index`, `kb_run_lint`, `kb_repair`

## Task 10: Cleanup and Decision Gate

**Files:**
- Review only

- [ ] **Step 1: Compare root maintenance behavior against `worktree`**

Confirm the ported features are aligned enough for future convergence, but do not merge extra functionality opportunistically.

- [ ] **Step 2: Decide whether `kb_write_pages` is still needed**

After the refactor lands, evaluate based on actual pain points:

- repeated multi-file write failures
- need for stronger write atomicity
- need for audit/recovery semantics

If these are not present, keep the current single-page tool model.

- [ ] **Step 3: Commit in focused slices**

Recommended commit sequence:

```bash
git add src/core src/tools src/utils src/types src/mcp_server.ts
git commit -m "refactor: split kb mcp logic into core modules"

git add src/core/wiki-maintenance.ts src/mcp_server.ts scripts/validate_kb_tool_contract_baseline.ts scripts/validate_kb_rebuild_index.ts scripts/validate_kb_run_lint.ts scripts/validate_kb_repair.ts
git commit -m "feat: add kb maintenance tools"

git add README.md docs/technical.md
git commit -m "docs: update kb mcp architecture and maintenance tools"
```
