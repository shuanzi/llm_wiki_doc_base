# OpenClaw Installer Design

## Context

This repository now treats the root MCP server in `src/mcp_server.ts` as the active runtime surface.
The repository also ships three operator-facing skills under `skills/`:

- `kb_ingest`
- `kb_query`
- `kb_lint`

The current mainline can be built and started manually, but it does not provide a supported installation path for a real OpenClaw environment.
That leaves four manual tasks to the operator:

1. build this repository
2. choose an external `KB_ROOT`
3. register a usable MCP server definition with OpenClaw
4. place OpenClaw-usable KB skills into the explicitly targeted OpenClaw workspace

The user requirement for this round is explicit:

1. keep the current mainline MCP design
2. do not adopt the OpenClaw plugin path
3. install into a real OpenClaw user environment
4. support an external `KB_ROOT` chosen at install time
5. auto-create the standard `kb/` structure if the external path is missing
6. fail conservatively on conflicts unless `--force` is provided
7. provide `install`, `check`, `uninstall`, and `repair`

This design should align with current OpenClaw behavior documented by OpenClaw:

- `openclaw mcp set/show/list/unset` manages OpenClaw-owned outbound MCP definitions under `mcp.servers`
- those MCP registry commands do not connect to the target MCP server or validate the live tool surface
- workspace skills load from `<workspace>/skills`
- workspace skills have higher precedence than managed/local skills
- skill location and skill visibility are separate controls
- agents may use different workspaces, and `agents.defaults.workspace` is only the default
- sandboxed file reads are workspace-rooted rather than automatically rooted at `env.KB_ROOT`

Sources:

- OpenClaw MCP CLI: https://docs.openclaw.ai/cli/mcp
- OpenClaw Skills: https://docs.openclaw.ai/skills
- OpenClaw Agent Runtime / skill precedence: https://docs.openclaw.ai/concepts/agent
- OpenClaw Agent Workspace: https://docs.openclaw.ai/concepts/agent-workspace
- OpenClaw Agents CLI: https://docs.openclaw.ai/cli/agents
- OpenClaw Creating Skills: https://docs.openclaw.ai/tools/creating-skills
- OpenClaw Skills Config: https://docs.openclaw.ai/tools/skills-config
- OpenClaw Sandboxing: https://docs.openclaw.ai/sandboxing

## Goals

- Provide a supported installation flow for real OpenClaw environments using the current mainline MCP server.
- Let the operator choose an external `KB_ROOT` at install time.
- Install OpenClaw-usable KB skills into the current default agent's workspace.
- Register an MCP server definition in OpenClaw that launches this repository's built MCP server with the chosen `KB_ROOT`.
- Provide deterministic lifecycle commands:
  - `install`
  - `check`
  - `repair`
  - `uninstall`
- Record enough local metadata to make uninstall and repair safe.

## Non-Goals

- Reintroducing the OpenClaw plugin path.
- Reusing `worktree/packages/create-kb` as the production installer surface.
- Moving KB data into the OpenClaw workspace.
- Changing the MCP tool contract.
- Redesigning the KB workflows beyond the minimum host-specific adaptations required for OpenClaw + external `KB_ROOT`.
- Managing third-party OpenClaw config outside the MCP registry and skill installation scope.
- Automatically deleting user KB content during uninstall.

## Recommended Approach

### 1. CLI-first, current-mainline installer

The installer should use OpenClaw's supported CLI surfaces where they exist, and direct filesystem writes only where OpenClaw expects ordinary workspace content.

That means:

- use `openclaw mcp set/show/list/unset` for MCP registry management
- write skills into `<workspace>/skills/<skill_name>/SKILL.md`
- keep installer-owned metadata in a repository-defined manifest file under the target workspace

This is preferable to directly mutating `~/.openclaw/openclaw.json` for three reasons:

1. it follows OpenClaw's supported MCP management path
2. it reduces coupling to raw config structure
3. it lets the installer combine config verification with an active MCP probe instead of relying only on raw file inspection

### 2. External `KB_ROOT` is mandatory input

The mainline MCP server already resolves `KB_ROOT` at runtime.
The installer should not infer an external KB location from the repository.
Instead, `install` requires `--kb-root <path>`, where the provided path is the KB root itself.
In other words, after installation the MCP server should read and write directly under:

- `<KB_ROOT>/raw`
- `<KB_ROOT>/wiki`
- `<KB_ROOT>/schema`
- `<KB_ROOT>/state`

Behavior:

- if `--kb-root` does not exist, create the standard KB tree directly under that path
- if the path exists but is not a directory, fail
- if the path exists and contains a partial or malformed KB structure, fail unless `repair` or `--force` is used explicitly

The MCP registration written into OpenClaw must pass this path through `env.KB_ROOT`.

### 3. OpenClaw-installed skills must be host-adapted, not raw copies

OpenClaw loads workspace skills from `<workspace>/skills`.
However, the repository's checked-in root skills are written for a repo-local operator environment and are not directly correct for an OpenClaw host with an external `KB_ROOT`.
Two current incompatibilities are already visible in mainline:

- `kb_lint` tells the agent to use the host file Read tool on `kb/state/...`, which resolves in the OpenClaw workspace or sandbox, not the external `KB_ROOT`
- `kb_ingest`, `kb_query`, and `kb_lint` still mention `kb_commit`, but the current `kb_commit` implementation assumes `KB_ROOT == <git-top-level>/kb`

So this installer effort must install OpenClaw-specific skill variants derived from the mainline workflows, not blindly copy the root `skills/*.md` files byte-for-byte.

Required installed skills:

- `<workspace>/skills/kb_ingest/SKILL.md`
- `<workspace>/skills/kb_query/SKILL.md`
- `<workspace>/skills/kb_lint/SKILL.md`

Required adaptation rules for those installed variants:

- do not rely on host file reads under `kb/...` for external-KB inspection
- prefer MCP tools over raw workspace file access for KB operations
- do not require automatic `kb_commit` in the default OpenClaw + external-`KB_ROOT` path
- keep the same high-level workflow intent as the checked-in mainline skills where host constraints allow

The installer should still treat those directories as installer-owned only if a matching manifest entry exists.
If a same-named skill already exists and is not clearly installer-owned, `install` must fail unless `--force` is provided.

### 3.5 `kb_commit` is not part of the default external-KB installation contract

The current `kb_commit` implementation is repo-relative and assumes `kb/` lives inside the Git repository that the MCP server is operating from.
That is incompatible with the confirmed installation mode where `KB_ROOT` points at an arbitrary external KB tree.

Therefore the installer design must explicitly scope the default OpenClaw integration contract as:

- read and write KB content through MCP tools
- do not promise that `kb_commit` is usable in external-KB mode
- present `kb_commit` as unsupported by default in installed OpenClaw skills unless a later dedicated compatibility change makes it safe

This keeps the installer honest about real current-mainline behavior.

### 4. The repository remains the runtime home of the MCP server

The installed OpenClaw MCP definition should point back to this repository's built artifact.
The installer does not copy or bundle the MCP server into the workspace in this round.

Rationale:

- keeps runtime aligned with the active mainline implementation
- avoids introducing a second distributed artifact format
- reduces drift between the repo's documented MCP behavior and the installed runtime

The trade-off is explicit:
the installation is bound to the repository path used during install.
If the repository is moved or deleted later, `check` must report the installation as broken and `repair` must require either:

- the original repo path to exist again, or
- an explicit new `--repo-root`

## Installation Model

### CLI surface

Add a repository CLI entry dedicated to OpenClaw installation lifecycle.

Recommended commands:

- `node dist/openclaw_installer.js install --workspace /abs/path/to/workspace --kb-root /abs/path/to/my-kb [--mcp-name llm-kb] [--force]`
- `node dist/openclaw_installer.js check [--workspace ...] [--mcp-name ...] [--json]`
- `node dist/openclaw_installer.js repair --workspace /abs/path/to/workspace [--mcp-name ...] [--kb-root ...] [--force]`
- `node dist/openclaw_installer.js uninstall --workspace /abs/path/to/workspace [--mcp-name ...] [--force]`

Package scripts can wrap these later, but the design should treat the compiled installer entrypoint as the real interface.

### Naming

Default MCP server registration name:

- `llm-kb`

This stays configurable via `--mcp-name`, but every lifecycle command must default to the same name to avoid accidental drift.

### Workspace targeting

The first implementation should support only the current default agent path.
That means the installer may write to an explicit `--workspace`, but only if that path matches the effective workspace of OpenClaw's current default agent.

If the operator points `--workspace` at some other agent workspace or an arbitrary directory, the installer should fail closed with `manual config required`.
This constraint is necessary because OpenClaw's documented `skills list/info/check` commands inspect the current workspace/config context and do not expose a generic `--workspace` selector for arbitrary workspaces.

For correctness in real OpenClaw environments, `install`, `repair`, and `uninstall` should require an explicit `--workspace`.
They should not guess an "active workspace" from a fallback path, because OpenClaw supports multiple agents and multiple workspaces.

`check` may accept omitted `--workspace` only for diagnostic discovery of the current default-agent workspace, but it must report which workspace it actually inspected and fail closed if the environment is ambiguous.

### Workspace discovery for diagnostics only

Resolution order:

1. resolve the current default agent from OpenClaw config
2. if that agent has an explicit workspace, use it
3. otherwise use `agents.defaults.workspace` if configured
4. if `OPENCLAW_PROFILE` is set and not `default`, fall back to `~/.openclaw/workspace-<profile>`
5. otherwise fall back to `~/.openclaw/workspace` only when there is no conflicting configured workspace state

If the resolved workspace path is absent:

- `install` and `repair` may create it after explicit user targeting
- `check` should report it missing rather than creating it implicitly

If it exists and is not a directory, fail.

This design intentionally keeps workspace discovery deterministic and overrideable.

### Skill visibility and agent-scope checks

Installing files into a workspace is not sufficient to make them usable.
OpenClaw can still make those skills ineligible through several mechanisms, including:

- `agents.defaults.skills` and `agents.list[].skills`
- `skills.entries.<skillKey>.enabled=false`
- `metadata.openclaw.requires.*` gates such as required bins, env vars, or config
- other eligibility filtering reflected by `openclaw skills list --eligible`

For the first implementation, the installer should validate only the default-agent path:

- if `agents.defaults.skills` is absent, treat skills as unrestricted by default
- if `agents.defaults.skills` exists, require it to include `kb_ingest`, `kb_query`, and `kb_lint`
- if a configured default-agent replacement set would hide the installed skills, fail with an actionable error instead of silently installing unusable files
- verify the effective eligible skill set through `openclaw skills list --eligible` only after confirming the target workspace matches the current default-agent workspace

The first implementation does not need to rewrite agent skill allowlists automatically.
In restricted multi-agent setups or non-default-agent workspace targets, the installer may report `manual config required` rather than attempting broad config mutation.

### Manifest location

The installer needs its own source of truth to support safe `check`, `repair`, and `uninstall`.

Recommended manifest path:

- `<workspace>/.llm-kb/openclaw-install.json`

Manifest contents should include:

- installer version
- install timestamp
- repo root
- MCP server name
- OpenClaw workspace path
- external `kb_root`
- installed skills and their source paths
- expected MCP command and args
- expected MCP env entries
- hashes of installed skill files
- whether the installed skill set is the OpenClaw-adapted variant set
- last successful active MCP probe result

The manifest should only describe artifacts this installer owns.
It must not attempt to mirror all of OpenClaw config.

## Detailed Behavior

### `install`

`install` should perform these steps in order:

1. verify the repository is in a usable state
   - `package.json` exists
   - `src/mcp_server.ts` exists
   - skill source files exist
2. verify required executables
   - `node`
   - `openclaw`
3. resolve repository root from current process location
4. resolve workspace path
5. resolve external `kb_root`
6. build this repository if needed
   - minimally ensure `dist/mcp_server.js` exists
   - preferred behavior: run the equivalent of `npm run build`
7. bootstrap missing external KB structure at the provided `KB_ROOT`
8. inspect conflicts
   - existing same-named MCP registration
   - existing same-named skills
   - existing manifest with divergent ownership metadata
9. stop on conflicts unless `--force`
10. install or overwrite skill files into the workspace
11. register the MCP server in OpenClaw with `openclaw mcp set`
12. write installer manifest
13. run post-install verification equivalent to `check`

Expected MCP registration shape:

- `command`: `node`
- `args`: `["/absolute/path/to/repo/dist/mcp_server.js"]`
- `env`:
  - `KB_ROOT=/absolute/path/to/external/kb_root`

`install` should fail if post-install verification fails.

Important verification rule:
successful `openclaw mcp set` only proves that OpenClaw saved config.
It does not prove that the target MCP server can actually start or expose the expected KB tool surface.
So post-install verification must include an active stdio MCP handshake against the built server process using the configured `KB_ROOT`, and it must confirm the expected `kb_*` tools are present.

### `check`

`check` should be read-only.

It should verify:

1. `openclaw` CLI is available
2. the workspace exists
3. the installer manifest exists and parses
4. the repository root in the manifest still exists
5. `dist/mcp_server.js` exists at the manifest's repo root
6. every installed skill directory exists
7. installed skill file hashes still match expected values
8. `openclaw mcp show <name>` exists and matches:
   - command
   - args
   - `env.KB_ROOT`
9. an active MCP probe against the configured server succeeds and returns the expected KB tool list
10. the external `kb_root` exists and has the minimum required structure directly under that root
11. the default-agent skill set is effectively eligible, not merely present on disk, using both config inspection and `openclaw skills list --eligible` only when the target matches the current default-agent workspace

`check` output should distinguish:

- healthy
- drift detected but repairable
- broken and requires operator intervention

Recommended output shape:

- human-readable by default
- machine-readable with `--json`

### `repair`

`repair` should repair only deterministic installer-owned integration artifacts.

Allowed repair scope:

- recreate missing workspace skill files
- restore missing or drifted MCP registration
- recreate missing installer manifest from current verified inputs
- bootstrap missing KB structure under the configured external `kb_root`
- regenerate the OpenClaw-specific installed skill variants from the repository source templates

Not allowed in `repair`:

- modifying KB content under `kb/wiki` or `kb/raw`
- deleting unknown skill directories
- overwriting user-modified same-named skills unless `--force`
- silently changing `kb_root` unless explicitly provided
- silently widening OpenClaw agent skill allowlists
- silently changing `skills.entries.*` enablement or `requires.*`-related config

If the manifest is missing but the installation can still be identified reliably through:

- explicit `--workspace`
- explicit `--mcp-name`
- resolvable OpenClaw MCP registration
- installer-recognizable skill file contents

then `repair` may reconstruct the manifest.

If both the manifest and OpenClaw MCP registration are missing, `repair` must require explicit operator input such as `--kb-root` and fail closed otherwise.

### `uninstall`

`uninstall` should remove only installer-owned integration artifacts.

Allowed uninstall scope:

- remove the registered MCP definition via `openclaw mcp unset`
- remove installer-owned skill directories if they still match manifest ownership expectations
- remove installer manifest
- remove installer-owned support directory `<workspace>/.llm-kb` if empty after uninstall

Not allowed:

- deleting the external `kb_root`
- deleting unrelated skills
- deleting same-named skills that appear user-modified unless `--force`

`uninstall` should remain conservative even under `--force`:
`--force` allows overwriting or removing known conflicting installer targets, but it still must not remove the external KB data tree.

## Conflict Policy

Default policy is fail-closed.

Conflicts that must fail without `--force`:

- same MCP name already registered with different command or env
- same skill directory already exists with non-matching content
- manifest exists but points to different repo root or `kb_root`
- workspace path resolves to a file
- `kb_root` resolves to a file

With `--force`, the installer may overwrite only installer-targeted artifacts:

- the same named MCP registration
- the same named workspace skills
- the installer manifest

Even with `--force`, it must not:

- delete arbitrary workspace content
- rewrite KB page content
- mutate OpenClaw config outside the MCP registration path it owns

## KB Bootstrap Rules

When `install` or `repair` needs to create a missing KB tree, it should create the minimum mainline structure expected by this repository directly under the provided `KB_ROOT`:

- `raw/inbox/`
- `wiki/`
- `wiki/index.md`
- `wiki/log.md`
- `wiki/sources/`
- `wiki/entities/`
- `wiki/concepts/`
- `wiki/analyses/`
- `wiki/reports/`
- `schema/wiki-conventions.md`
- `state/manifests/`
- `state/cache/page-index.json`

Bootstrap content should come from the mainline repository's current checked-in conventions where possible, not from the archived `worktree` templates.

## Internal Architecture

### Recommended file layout

Add a dedicated installer module tree under `src/`:

- `src/openclaw_installer.ts`
  - CLI entrypoint
- `src/openclaw-installer/args.ts`
  - argument parsing and command dispatch
- `src/openclaw-installer/openclaw-cli.ts`
  - wrappers around `openclaw mcp set/show/list/unset`
- `src/openclaw-installer/workspace.ts`
  - workspace resolution and path helpers
- `src/openclaw-installer/kb-bootstrap.ts`
  - minimum KB tree creation and validation
- `src/openclaw-installer/skills.ts`
  - OpenClaw-specific skill materialization, hashing, ownership validation
- `src/openclaw-installer/mcp-probe.ts`
  - active stdio MCP handshake and tool-surface verification
- `src/openclaw-installer/manifest.ts`
  - manifest read/write/validate helpers
- `src/openclaw-installer/install.ts`
  - install workflow
- `src/openclaw-installer/check.ts`
  - check workflow
- `src/openclaw-installer/repair.ts`
  - repair workflow
- `src/openclaw-installer/uninstall.ts`
  - uninstall workflow

Generic file/path helpers can stay in `src/utils/` where appropriate.

### Why a separate installer module tree

The installer has different concerns from the MCP server:

- host-environment inspection
- lifecycle ownership
- workspace-level filesystem writes
- OpenClaw CLI orchestration

Those concerns should not leak into `src/mcp_server.ts` or the KB tool modules.

## Output and Exit Semantics

All commands should have stable exit behavior:

- `0`: success
- `1`: expected validation or drift failure
- `2`: usage error or missing required input
- `3`: external command failure, such as `openclaw` CLI invocation failure

Human-readable output should be concise and action-oriented.
`--json` support is required for `check` and recommended for the other commands, but not mandatory in the first implementation for every subcommand.

## Risks

### 1. OpenClaw workspace discovery ambiguity

Risk:
Different OpenClaw installs may not expose the current default agent workspace in a single stable place.

Mitigation:

- allow explicit `--workspace`
- resolve the current default agent before applying workspace fallback rules
- keep fallback discovery limited to diagnostics
- surface the resolved path in command output

### 2. Repository path coupling

Risk:
The installed MCP registration points to the repo's `dist/mcp_server.js`, so moving the repo later breaks the installation.

Mitigation:

- persist repo root in manifest
- make `check` detect it clearly
- make `repair` accept explicit path overrides
- document this coupling plainly

### 3. Overwriting user-owned skills

Risk:
The workspace may already contain same-named skills with local edits.

Mitigation:

- fail closed by default
- compare content hashes
- only overwrite under `--force`

### 4. False-positive health checks from config-only MCP validation

Risk:
`openclaw mcp show` can look correct while the actual server process fails to boot or exposes the wrong tool set.

Mitigation:

- active stdio MCP probe during `install`, `check`, and `repair`
- verify the expected `kb_*` tool names, not only saved config

### 5. Workspace skill files present but hidden by agent allowlists

Risk:
OpenClaw may load the skill files from disk but still hide them from the default agent through `agents.defaults.skills` or agent-specific replacements.

Mitigation:

- inspect default-agent skill visibility rules
- fail closed with a manual-config-required message when the installed skills would still be invisible

### 6. Eligibility checks against the wrong workspace context

Risk:
`openclaw skills list --eligible` reflects the current OpenClaw workspace/config context, not an arbitrary workspace path supplied on the command line.

Mitigation:

- scope the first implementation to the current default agent workspace only
- require explicit `--workspace` to match that resolved workspace
- fail closed when the operator targets a different workspace

### 7. Partial installation on failure

Risk:
`install` could create skills but fail before MCP registration or manifest write.

Mitigation:

- stage operations in memory first where possible
- perform rollback for installer-owned artifacts created in the current run
- run a final `check` gate

## Testing Strategy

### Unit-level

- argument parsing
- workspace resolution
- manifest parsing and validation
- OpenClaw-specific skill rendering, hashing, and ownership detection
- KB bootstrap creation/validation
- MCP registration payload construction
- active MCP probe behavior and expected tool-name assertion

### Integration-level

Use a fake OpenClaw CLI harness or controlled command shim to test:

- successful install
- conservative conflict failure
- forced overwrite
- missing `kb_root` bootstrap
- default-agent skill visibility failure
- active MCP probe failure even when OpenClaw config was saved
- manifest reconstruction in repair
- uninstall removing only installer-owned artifacts

### Live-environment smoke tests

Where the environment allows it:

- run against a disposable OpenClaw workspace
- register a real MCP definition
- confirm `openclaw mcp show <name>` matches expected config
- confirm installed skills appear under the workspace

The first implementation should prioritize deterministic integration tests over deep live OpenClaw end-to-end automation.

## Rollout

### Phase 1

- add installer module tree
- implement `install`, `check`, `repair`, and `uninstall`
- add rollback behavior for failed `install`
- add integration coverage for drift and lifecycle behavior
- add documentation for manual and scripted OpenClaw installation

### Deferred

- shipping a copied/bundled MCP runtime instead of a repo-path-based runtime
- installer support for non-OpenClaw hosts
- plugin packaging
- automatic workspace discovery from broader OpenClaw runtime state beyond config and default path

## Final Recommendation

Build a current-mainline, CLI-first OpenClaw installer that:

- installs skills into an explicitly targeted workspace only when that path matches the current default agent workspace
- registers the root MCP server through `openclaw mcp set`
- binds that server to an external `KB_ROOT` supplied at install time
- records ownership in a workspace-local manifest
- supports conservative `install`, `check`, `repair`, and `uninstall`

This keeps the product aligned with the repository's chosen architecture:
MCP remains the active runtime surface, OpenClaw is the host environment, and the KB data remains an external operator-owned workspace.
