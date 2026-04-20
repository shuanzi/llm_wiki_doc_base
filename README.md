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

## Status

- Active architecture: **V2 (LLM-driven knowledge compilation)**
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
  mcp_server.ts        # MCP stdio server exposing 8 V2 tools
  tools/kb_*.ts        # tool implementations
skills/
  kb_ingest/SKILL.md
  kb_query/SKILL.md
  kb_lint/SKILL.md
```

Rules for KB write scope and wiki operations are defined in [AGENTS.md](./AGENTS.md).

## The 8 V2 Tools

MCP server (`kb-mcp`) exposes these tools:

1. `kb_source_add` - register a source file into KB manifests
2. `kb_read_source` - read raw source content by `source_id`
3. `kb_write_page` - create/update full wiki page (frontmatter-validated)
4. `kb_update_section` - replace or append a specific heading section
5. `kb_ensure_entry` - idempotently append index/log entries with `dedup_key`
6. `kb_search_wiki` - search `page-index.json` (query/filter/link resolution)
7. `kb_read_page` - read wiki page by path or page id
8. `kb_commit` - stage `kb/` and create a git commit

Tool caveats from current implementation:

- `kb_source_add` currently accepts only `.md` and `.txt` sources.
- `kb_commit` runs `git add kb/` before commit, but if other files were already staged earlier, they can still be included in the same commit.

## Environment Semantics (`KB_ROOT` / `WORKSPACE_ROOT`)

`src/mcp_server.ts` resolves `kb_root` in this order:

1. `KB_ROOT` -> `path.resolve(KB_ROOT)` (absolute paths are kept absolute; relative paths are accepted and resolved from current working directory)
2. `WORKSPACE_ROOT` -> treated as **repo root**, then resolved to `${WORKSPACE_ROOT}/kb`
3. Fallback -> `./kb` from current working directory

Startup guard behavior:

- If resolved `kb_root` does not exist as a directory, server exits with code `2`.

## Build and Start MCP

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

## Skills (Operator-facing Workflows)

- `skills/kb_ingest/SKILL.md`: ingest one source and update multiple wiki pages
- `skills/kb_query/SKILL.md`: answer from wiki-first context; optionally persist analyses
- `skills/kb_lint/SKILL.md`: health checks (orphans, ghost links, missing cross-references, stubs, contradictions, data gaps that could be filled with a web search)

Use skills as the default operating procedure over the 8 tools (tools = primitives, skills = workflow).

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
