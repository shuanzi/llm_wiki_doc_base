# OpenClaw Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a current-mainline OpenClaw installer that registers the root MCP server, installs OpenClaw-adapted KB skills into the current default agent workspace, bootstraps an external `KB_ROOT`, and supports `install`, `check`, `repair`, and `uninstall`.

**Architecture:** Add a dedicated installer module tree under `src/openclaw-installer/`, keep the current MCP server unchanged as the runtime surface, and verify OpenClaw integration through both saved config inspection and an active stdio MCP probe. Scope the first implementation to the current default agent workspace only, and install host-adapted skill variants instead of copying the repo-local skill files verbatim.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/sdk`, child-process CLI integration with `openclaw`, filesystem-based manifests, temp-directory validation scripts with fake OpenClaw shims, existing `tsconfig.scripts.json`.

---

## File Map

### Create

- `src/openclaw_installer.ts`
- `src/openclaw-installer/args.ts`
- `src/openclaw-installer/types.ts`
- `src/openclaw-installer/workspace.ts`
- `src/openclaw-installer/openclaw-cli.ts`
- `src/openclaw-installer/mcp-probe.ts`
- `src/openclaw-installer/kb-bootstrap.ts`
- `src/openclaw-installer/skills.ts`
- `src/openclaw-installer/manifest.ts`
- `src/openclaw-installer/install.ts`
- `src/openclaw-installer/check.ts`
- `src/openclaw-installer/repair.ts`
- `src/openclaw-installer/uninstall.ts`
- `scripts/validate_openclaw_installer_install.ts`
- `scripts/validate_openclaw_installer_repair_uninstall.ts`

### Modify

- `package.json`
- `README.md`
- `docs/technical.md`
- `docs/progress.md`
- `src/index.ts`

### Reference Only

- `docs/superpowers/specs/2026-04-21-openclaw-installer-design.md`
- `src/mcp_server.ts`
- `src/core/git.ts`
- `skills/kb_ingest/SKILL.md`
- `skills/kb_query/SKILL.md`
- `skills/kb_lint/SKILL.md`
- `scripts/validate_kb_tool_contract_baseline.ts`
- `scripts/validate_kb_rebuild_index.ts`
- `scripts/validate_kb_run_lint.ts`
- `scripts/validate_kb_repair.ts`

## Task 1: Scaffold the Installer Surface

**Files:**
- Create: `src/openclaw_installer.ts`
- Create: `src/openclaw-installer/args.ts`
- Create: `src/openclaw-installer/types.ts`
- Modify: `package.json`
- Modify: `src/index.ts`

- [ ] **Step 1: Add the installer entrypoint and command contract**

Create a dedicated entrypoint at `src/openclaw_installer.ts` that dispatches to `install`, `check`, `repair`, and `uninstall`.
Use a minimal hand-rolled argument parser in `src/openclaw-installer/args.ts`; do not add a new CLI dependency.

Required command surface:

- `install --workspace <path> --kb-root <path> [--mcp-name <name>] [--force]`
- `check [--workspace <path>] [--mcp-name <name>] [--json]`
- `repair --workspace <path> [--kb-root <path>] [--mcp-name <name>] [--force]`
- `uninstall --workspace <path> [--mcp-name <name>] [--force]`

- [ ] **Step 2: Define stable installer types**

Create shared types for:

- parsed CLI arguments
- resolved OpenClaw environment
- manifest shape
- check results / drift items
- repair outcomes
- skill installation metadata

Keep these local to the installer module tree unless a later task needs a narrow export from `src/index.ts`.

- [ ] **Step 3: Wire package scripts and bin entry**

Update `package.json` so the compiled installer is easy to run locally and in production.
Add at least:

- a script such as `start:openclaw-installer`
- a bin such as `kb-openclaw-installer`

Do not disturb the existing `kb-mcp` bin or `start:mcp`.

- [ ] **Step 4: Verify the scaffold builds cleanly**

Run:

```bash
npm run typecheck
npm run build
```

Expected:

- the new installer entry compiles into `dist/`
- existing MCP build still succeeds

## Task 2: Implement OpenClaw Environment Discovery and MCP Probing

**Files:**
- Create: `src/openclaw-installer/workspace.ts`
- Create: `src/openclaw-installer/openclaw-cli.ts`
- Create: `src/openclaw-installer/mcp-probe.ts`

- [ ] **Step 1: Implement default-agent-aware workspace resolution**

In `workspace.ts`, resolve the effective current default agent workspace using the design rules:

1. current default agent from config
2. agent-specific workspace if present
3. `agents.defaults.workspace`
4. `OPENCLAW_PROFILE` fallback to `~/.openclaw/workspace-<profile>`
5. `~/.openclaw/workspace`

The resolver must also validate that an explicit `--workspace` matches the current default agent workspace for the first implementation.
If it does not match, return a `manual config required` error rather than guessing.

- [ ] **Step 2: Implement OpenClaw CLI wrappers**

In `openclaw-cli.ts`, add thin wrappers around:

- config inspection needed for default-agent/workspace resolution
- `openclaw mcp show/set/unset`
- `openclaw skills list --eligible`

Rules:

- no silent shell parsing through `sh -c`
- capture stdout/stderr and return structured errors
- do not mutate unrelated OpenClaw config

- [ ] **Step 3: Implement active MCP probing**

In `mcp-probe.ts`, use the MCP SDK client transport to spawn the target `node dist/mcp_server.js` with `KB_ROOT` and verify:

- initialize succeeds
- `tools/list` succeeds
- the expected `kb_*` tool names are present

This probe must be reusable by `install`, `check`, and `repair`.

- [ ] **Step 4: Add focused validation coverage**

Extend later script coverage or add lightweight local checks to confirm:

- workspace resolution rejects non-default-agent targets
- `openclaw mcp show` config inspection is not treated as sufficient health evidence
- active probing fails cleanly when the server path is wrong

Run:

```bash
npm run typecheck
npm run build
```

## Task 3: Implement KB Bootstrap, Adapted Skills, and Manifest Ownership

**Files:**
- Create: `src/openclaw-installer/kb-bootstrap.ts`
- Create: `src/openclaw-installer/skills.ts`
- Create: `src/openclaw-installer/manifest.ts`

- [ ] **Step 1: Implement external KB bootstrap**

Create helpers that validate and bootstrap the minimum KB tree directly under the provided `KB_ROOT`:

- `raw/inbox`
- `wiki/index.md`
- `wiki/log.md`
- `wiki/{sources,entities,concepts,analyses,reports}`
- `schema/wiki-conventions.md`
- `state/{manifests,cache/page-index.json}`

Bootstrap content should come from the mainline repo conventions, not from `worktree/`.

- [ ] **Step 2: Materialize OpenClaw-adapted skills**

In `skills.ts`, generate the three installed skill variants:

- `kb_ingest`
- `kb_query`
- `kb_lint`

Hard requirements:

- do not direct the agent to raw host file reads under `kb/...`
- do not require automatic `kb_commit`
- preserve the intended ingest/query/lint workflows as much as possible
- keep ownership deterministic through stable rendering and hashing

Do not modify the root `skills/*.md` files in this task.

- [ ] **Step 3: Implement manifest read/write/validation**

In `manifest.ts`, track:

- repo root
- workspace path
- `kb_root`
- mcp name
- installed skill paths + hashes
- expected MCP config
- last successful active probe result

Validation must distinguish:

- healthy
- repairable drift
- unknown ownership

- [ ] **Step 4: Add deterministic unit-style checks**

Add or extend script assertions to cover:

- KB bootstrap on an empty directory
- adapted skills are rendered with the required host-specific changes
- manifest round-trip read/write works
- manifest ownership rejects conflicting repo roots or `kb_root`

Run:

```bash
npm run typecheck
npm run build
```

## Task 4: Implement `install` and `check`

**Files:**
- Create: `src/openclaw-installer/install.ts`
- Create: `src/openclaw-installer/check.ts`
- Create: `scripts/validate_openclaw_installer_install.ts`

- [ ] **Step 1: Implement `check` first**

`check` should be read-only and report:

- missing/invalid OpenClaw CLI
- workspace mismatch vs current default agent
- missing manifest
- missing repo build artifact
- missing skills
- skill hash drift
- saved MCP config drift
- failed active MCP probe
- ineligible default-agent skills
- malformed or missing external `KB_ROOT`

Support `--json`.

- [ ] **Step 2: Implement `install` with rollback**

`install` should:

1. validate repo state
2. resolve and validate the default-agent workspace
3. validate/create `KB_ROOT`
4. ensure build output exists
5. inspect conflicts
6. write adapted skills
7. register OpenClaw MCP config
8. write manifest
9. run `check`

If any step after file writes fails, roll back only the installer-owned artifacts created in that run.

- [ ] **Step 3: Build a fake OpenClaw CLI validation harness**

In `scripts/validate_openclaw_installer_install.ts`, create a temp sandbox with:

- a fake `openclaw` executable on `PATH`
- a fake config file describing the current default agent/workspace
- controllable responses for `mcp show/set/unset` and `skills list --eligible`

Use that harness to validate:

- successful install
- explicit workspace mismatch failure
- conservative conflict failure without `--force`
- post-install active MCP probe success
- ineligible-skill failure even when files are present

- [ ] **Step 4: Run full verification for this milestone**

Run:

```bash
npm run typecheck
npm run build
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_openclaw_installer_install.ts
```

## Task 5: Implement `repair` and `uninstall`

**Files:**
- Create: `src/openclaw-installer/repair.ts`
- Create: `src/openclaw-installer/uninstall.ts`
- Create: `scripts/validate_openclaw_installer_repair_uninstall.ts`

- [ ] **Step 1: Implement `repair` with strict ownership limits**

`repair` may:

- recreate missing adapted skills
- restore drifted MCP config
- rebuild manifest from verified state
- bootstrap missing KB structure

`repair` must not:

- modify KB page content
- widen allowlists or `skills.entries.*`
- overwrite user-modified conflicting skill directories unless `--force`

- [ ] **Step 2: Implement conservative `uninstall`**

`uninstall` should:

- remove the registered MCP definition
- remove installer-owned skill directories if ownership still matches
- remove the manifest
- leave the external `KB_ROOT` untouched

If ownership is uncertain, fail closed unless `--force`.

- [ ] **Step 3: Add lifecycle validation coverage**

In `scripts/validate_openclaw_installer_repair_uninstall.ts`, use the fake OpenClaw harness to validate:

- repair from missing skills
- repair from missing manifest with sufficient surviving state
- repair refusal when state is too ambiguous
- uninstall removes only installer-owned artifacts
- uninstall leaves the external KB tree intact

- [ ] **Step 4: Run lifecycle verification**

Run:

```bash
npm run typecheck
npm run build
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_openclaw_installer_repair_uninstall.ts
```

## Task 6: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/technical.md`
- Modify: `docs/progress.md`

- [ ] **Step 1: Document the new installer path**

Update docs so they state clearly:

- this repo now ships an OpenClaw installer
- the first implementation supports only the current default agent workspace
- `KB_ROOT` is external and explicit
- installed skills are OpenClaw-adapted variants
- `kb_commit` is not part of the default external-KB contract

- [ ] **Step 2: Add operator usage examples**

Document exact commands for:

- install
- check
- repair
- uninstall

Include explicit notes on:

- repo-path coupling
- current default-agent workspace restriction
- conservative failure on conflicts

- [ ] **Step 3: Run final repo verification**

Run:

```bash
npm run typecheck
npm run build
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_openclaw_installer_install.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_openclaw_installer_repair_uninstall.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_tool_contract_baseline.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_rebuild_index.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_run_lint.ts
npx tsx --tsconfig tsconfig.scripts.json scripts/validate_kb_repair.ts
```

Expected:

- installer works as designed
- existing MCP maintenance tooling still passes
- no regression to the current mainline MCP surface
