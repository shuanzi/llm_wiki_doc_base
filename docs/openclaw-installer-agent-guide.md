# OpenClaw Installer Agent Guide

This document is an execution-oriented guide for an agent that needs to install, verify, repair, or uninstall the current-mainline OpenClaw integration in this repository.

## Scope

This guide applies to the current installer implementation only.

- Installer entrypoint: `dist/openclaw_installer.js`
- Bin name: `kb-openclaw-installer`
- Supported commands:
  - `install`
  - `check`
  - `repair`
  - `uninstall`

This is not a plugin install flow. It installs:

- one MCP registration that points to this repository's `dist/mcp_server.js`
- three OpenClaw-adapted skills under the target workspace
- one installer manifest under the target workspace

It does not move the KB into the OpenClaw workspace. The KB stays external.

## Hard Constraints

The agent must enforce these rules:

1. `--workspace` must match the current OpenClaw default-agent workspace.
2. `install` requires an explicit external `--kb-root`.
3. `uninstall` must not delete the external `KB_ROOT`.
4. Conflict handling is conservative by default. Do not add `--force` unless there is a specific reason.
5. Installed skills are adapted variants, not direct copies of repository-local usage assumptions.
6. `kb_commit` is not part of the default external-KB workflow contract, even though the MCP server still exposes it.

## What The Installer Creates

After a successful install, expect:

- MCP registration name: usually `llm-kb`
- MCP command target: `<repo>/dist/mcp_server.js`
- MCP environment includes `KB_ROOT=<external-kb-root>`
- Workspace skill directories:
  - `<workspace>/skills/kb_ingest`
  - `<workspace>/skills/kb_query`
  - `<workspace>/skills/kb_lint`
- Installer manifest:
  - `<workspace>/.llm-kb/openclaw-install.json`

## Preconditions

Before running installer commands, the agent should verify:

1. It is operating from the correct repository checkout.
2. `npm run typecheck` and `npm run build` have completed successfully.
3. `openclaw` CLI is available on `PATH`.
4. The target workspace path is the current default-agent workspace.
5. The target external `KB_ROOT` path is known.

## Standard Install Procedure

Use this sequence.

### 1. Build

```bash
npm run typecheck
npm run build
```

### 2. Install

```bash
node dist/openclaw_installer.js install \
  --workspace /absolute/path/to/current-default-agent-workspace \
  --kb-root /absolute/path/to/external-kb \
  --mcp-name llm-kb
```

Equivalent bin form:

```bash
kb-openclaw-installer install \
  --workspace /absolute/path/to/current-default-agent-workspace \
  --kb-root /absolute/path/to/external-kb \
  --mcp-name llm-kb
```

### 3. Verify Immediately

```bash
node dist/openclaw_installer.js check \
  --workspace /absolute/path/to/current-default-agent-workspace \
  --mcp-name llm-kb \
  --json
```

Success condition:

- JSON output contains `"ok": true`

## Standard Repair Procedure

Use `repair` when installer-owned state has drifted but ownership is still valid or recoverable.

```bash
node dist/openclaw_installer.js repair \
  --workspace /absolute/path/to/current-default-agent-workspace \
  --kb-root /absolute/path/to/external-kb \
  --mcp-name llm-kb
```

Use cases:

- missing adapted skills
- drifted or missing MCP config
- missing installer manifest with enough surviving installer-owned state
- missing minimum KB structure under the external `KB_ROOT`

Do not use `repair` to migrate a healthy install to a different `KB_ROOT`. That is intentionally fail-closed unless explicitly forced and justified.

## Standard Uninstall Procedure

Use `uninstall` only when removing this installer-owned integration.

```bash
node dist/openclaw_installer.js uninstall \
  --workspace /absolute/path/to/current-default-agent-workspace \
  --mcp-name llm-kb
```

Expected behavior:

- removes installer-owned MCP registration if ownership matches
- removes installer-owned skill directories if ownership matches
- removes installer manifest
- leaves external `KB_ROOT` untouched

## `--force` Policy

The agent should treat `--force` as an exception path.

Use `--force` only when:

- the failure is caused by known installer-owned drift
- ownership is understood but strict checks are blocking recovery
- the operator explicitly wants overwrite/removal behavior

Do not use `--force` by default for:

- unknown workspace mismatch
- unknown or third-party MCP ownership
- unexplained skill-directory drift
- unexplained `KB_ROOT` retargeting

## Common Failure Cases

### Workspace mismatch

Symptom:

- installer reports manual-config-required or workspace mismatch

Action:

- stop
- resolve the actual current default-agent workspace
- rerun with the matching `--workspace`

### Missing build artifact

Symptom:

- installer reports missing `dist/mcp_server.js` or installer build output

Action:

```bash
npm run typecheck
npm run build
```

Then rerun installer command.

### Conflict on skills, manifest, or MCP config

Symptom:

- installer refuses to overwrite or remove existing state

Action:

- inspect whether the state is installer-owned
- prefer `check` first
- use `repair` before `--force`
- use `--force` only with a clear ownership justification

### Existing partial `KB_ROOT`

Symptom:

- install fails because external `KB_ROOT` exists but is malformed/incomplete

Action:

- do not silently repoint to a different KB
- use `repair` if the target root is the intended one
- otherwise stop and clarify intended ownership

## Agent Do / Do Not

Do:

- build before install
- run `check --json` after install or repair
- preserve the external `KB_ROOT`
- assume fail-closed behavior is intentional
- treat manifest + MCP config + skill hashes as ownership signals

Do not:

- assume any workspace is valid
- rewrite raw KB source materials as part of installer operations
- treat `repair` as a normal migration tool
- auto-add `--force` because a command failed once
- assume `kb_commit` should be called by default in the adapted workflow

## Minimal Command Set

```bash
npm run typecheck
npm run build
node dist/openclaw_installer.js install --workspace /abs/workspace --kb-root /abs/external-kb --mcp-name llm-kb
node dist/openclaw_installer.js check --workspace /abs/workspace --mcp-name llm-kb --json
node dist/openclaw_installer.js repair --workspace /abs/workspace --kb-root /abs/external-kb --mcp-name llm-kb
node dist/openclaw_installer.js uninstall --workspace /abs/workspace --mcp-name llm-kb
```

## Source of Truth

If this guide and implementation diverge, trust implementation plus these live documents:

- `src/openclaw_installer.ts`
- `src/openclaw-installer/*.ts`
- `README.md`
- `docs/technical.md`
