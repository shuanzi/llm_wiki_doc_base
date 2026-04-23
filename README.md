# OpenClaw KB (V2)

LLM-maintained knowledge base system. V2 is the active architecture in this repository.

This README is the operator entrypoint: what V2 contains, how to start MCP, and how to run safely.

## Live Docs

README is the top-level live entrypoint and operator guide.
Current live doc set:

- `README.md` (this file)
- [docs/product.md](./docs/product.md)
- [docs/technical.md](./docs/technical.md)
- [docs/progress.md](./docs/progress.md)
- [docs/openclaw-installer-agent-guide.md](./docs/openclaw-installer-agent-guide.md)

## Status

- Active architecture: **V2 (LLM-driven knowledge compilation)**
- OpenClaw integration: this repo now ships an OpenClaw installer (`kb-openclaw-installer` / `dist/openclaw_installer.js`) for external-KB deployments.
- Governance rule (current): for **multi-file changes under `kb/wiki`**, follow `plan -> draft -> apply` as required by [AGENTS.md](./AGENTS.md).
- Logging semantics: `wiki/log.md` records meaningful query synthesis and every complete lint pass, including clean pass (`No findings`, `0/0/0`).
- Historical context: old plan/review/idea/session snapshot docs are archived under `archived/`, and are not current truth sources.

## Repository Layout (V2)

```text
kb/
  raw/                 # immutable source files (inbox/assets)
  wiki/                # editable knowledge layer
    index.md           # navigation index
    log.md             # operation timeline (ingest / meaningful query synthesis / complete lint pass incl. clean pass)
    sources/           # per-source summary pages
    entities/          # entity pages
    concepts/          # concept pages
    analyses/          # query outputs worth persisting
    reports/           # lint/health reports
  schema/
    wiki-conventions.md
  state/
    manifests/         # source manifests
    cache/page-index.json
src/
  mcp_server.ts        # MCP stdio server exposing 8 workflow tools + 3 maintenance tools
  tools/kb_*.ts        # tool implementations
skills/
  kb_ingest/SKILL.md
  kb_query/SKILL.md
  kb_lint/SKILL.md
```

Rules for KB write scope and wiki operations are defined in [AGENTS.md](./AGENTS.md).

## MCP Tools

MCP server (`kb-mcp`) exposes 13 tools in total.

Workflow tools:

1. `kb_source_add` - register a source file into KB manifests
2. `kb_read_source` - read raw source content by `source_id`
3. `kb_write_page` - create/update full wiki page (frontmatter-validated)
4. `kb_update_section` - replace or append a specific heading section
5. `kb_ensure_entry` - idempotently append index/log entries with `dedup_key`
6. `kb_search_wiki` - search wiki pages via `auto`, `index`, `rg`, `bm25`, or optional `qmd`; also resolves wikilinks
7. `kb_read_page` - read wiki page by path or page id
8. `kb_commit` - stage the configured `kb_root` path and create a git commit

Maintenance tools:

9. `kb_rebuild_index` - rebuild `kb/state/cache/page-index.json` deterministically from `kb/wiki/**/*.md`
10. `kb_run_lint` - run deterministic and semantic KB lint checks without mutating files
11. `kb_search_index_status` - inspect ripgrep/BM25/QMD backend availability and staleness
12. `kb_search_rebuild_index` - rebuild BM25 and/or optional QMD search indexes
13. `kb_repair` - repair only structural KB artifacts (`index.md`, `log.md`, `page-index.json`) with `dry_run` support

Tool caveats from current implementation:

- `kb_source_add` preserves Markdown/plaintext import and converts supported non-Markdown files through MarkItDown before ingest.
- `kb_commit` stages only the configured `kb_root` path when that path is inside a git working tree, but files staged earlier outside that scope can still be included in the same commit.

## Environment Semantics (`KB_ROOT` / `WORKSPACE_ROOT`)

`src/mcp_server.ts` resolves `kb_root` in this order:

1. `KB_ROOT` -> `path.resolve(KB_ROOT)` (absolute paths are kept absolute; relative paths are accepted and resolved from current working directory)
2. `WORKSPACE_ROOT` -> treated as **repo root**, then resolved to `${WORKSPACE_ROOT}/kb`
3. Fallback -> `./kb` from current working directory

Startup guard behavior:

- If resolved `kb_root` does not exist as a directory, server exits with code `2`.

## Build and Start MCP

MCP startup flow is unchanged by the refactor. OpenClaw installer flow is separate and documented in the next section.

From repository root:

```bash
npm run typecheck
npm run build
npm run start:mcp
```

For explicit roots:

```bash
KB_ROOT=/absolute/path/to/kb npm run start:mcp
# or
WORKSPACE_ROOT=/absolute/path/to/repo npm run start:mcp
```

`start:mcp` runs `node dist/mcp_server.js`, so build first.

## OpenClaw Installer (External KB)

Build artifacts first:

```bash
npm run typecheck
npm run build
```

Install (requires explicit default-agent workspace and explicit external `KB_ROOT`):

```bash
node dist/openclaw_installer.js install --workspace /absolute/path/to/current-default-agent-workspace --kb-root /absolute/path/to/external-kb --mcp-name llm-kb
```

Check:

```bash
node dist/openclaw_installer.js check --workspace /absolute/path/to/current-default-agent-workspace --mcp-name llm-kb --json
```

Repair:

```bash
node dist/openclaw_installer.js repair --workspace /absolute/path/to/current-default-agent-workspace --kb-root /absolute/path/to/external-kb --mcp-name llm-kb
```

Uninstall:

```bash
node dist/openclaw_installer.js uninstall --workspace /absolute/path/to/current-default-agent-workspace --mcp-name llm-kb
```

Operator notes for current implementation:

- Current implementation only supports the OpenClaw current default-agent workspace. If `--workspace` does not match the resolved default-agent workspace, installer commands fail closed with manual-config guidance.
- `KB_ROOT` is an explicit external root in the installer contract (`install` requires `--kb-root`; `repair` can infer from manifest/MCP config but accepts explicit override).
- Installed skills are OpenClaw-adapted variants (`openclaw-adapted-v1`) written under `<workspace>/skills/{kb_ingest|kb_query|kb_lint}`.
- `kb_commit` remains available in the MCP server surface, but it is not part of the default external-KB installer contract; adapted skills intentionally avoid automatic `kb_commit`.
- Installer ownership is repo-coupled: expected MCP config points to this repo build artifact (`<repo>/dist/mcp_server.js`) plus the configured `KB_ROOT`.
- Conflict handling is conservative by default and fails closed on ownership/config/content conflicts unless `--force` is explicitly provided.

Agent-oriented execution guide:

- [docs/openclaw-installer-agent-guide.md](./docs/openclaw-installer-agent-guide.md)

## Skills (Operator-facing Workflows)

- `skills/kb_ingest/SKILL.md`: ingest one source and update multiple wiki pages
- `skills/kb_query/SKILL.md`: answer from wiki-first context; optionally persist analyses
- `skills/kb_lint/SKILL.md`: health checks (orphans, ghost links, missing cross-references, stubs, contradictions, data gaps that could be filled with a web search)

Use skills as the default operating procedure over the workflow tools; maintenance tools are health/repair primitives.

## Safe E2E Usage

E2E driver: `scripts/e2e_v2_ingest.ts`

Current default behavior (safe): if `--kb-root` is omitted, the script creates a throwaway temp workspace, copies `./kb` into it, runs both ingest passes there, and cleans it up.
Precision note: the safe default is cwd-sensitive because it seeds from `process.cwd()/kb` when `--kb-root` is omitted. The `--kb-root "$PWD/kb"` commit example assumes cwd is the repo root. Commit mode itself is governed by the explicit `--kb-root` value (must resolve to `<git-top-level>/kb`).

Safe default run:

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts /absolute/path/to/source.md
```

Target a specific KB root (explicit mode):

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts /absolute/path/to/source.md --kb-root /absolute/path/to/kb
```

Commit mode rule: `--commit` is rejected unless `--kb-root` is explicitly provided, and that explicit root must be exactly `<git-top-level>/kb` (i.e., `dirname(kb_root) == git rev-parse --show-toplevel`); nested paths like `<repo>/sub/kb` are rejected.

Production-usable commit example (explicitly targets this repo's KB and commits in this repo):

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts /absolute/path/to/source.md --kb-root "$PWD/kb" --commit
```

## Historical Context (Not Default)

Old plan/review/idea/session snapshot documents are kept under `archived/` for traceability only. They are design history and audit trail, not live operational facts.

## Pointers

- Live doc set: `README.md`, [docs/product.md](./docs/product.md), [docs/technical.md](./docs/technical.md), [docs/progress.md](./docs/progress.md)
- Secondary implementation entrypoint: [src/mcp_server.ts](./src/mcp_server.ts)
- Archive index: [archived/index.md](./archived/index.md)
