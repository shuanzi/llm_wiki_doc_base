---
date: 2026-04-12
refreshed_at: 2026-04-19
branch: 0410_claude_version
---

# V2 Migration — Session Status (2026-04-12 snapshot, refreshed 2026-04-19)

End-of-day snapshot for picking up in a fresh session. This file now includes a 2026-04-19 refresh to align with current repository state.

## 1. Architecture summary

Repo transitioned from V1 (deterministic plan → draft → apply pipeline) to V2 (LLM-driven knowledge compilation).

V2 shape:
- **8 tools** in `src/tools/kb_*.ts`: `kb_source_add`, `kb_read_source`, `kb_write_page`, `kb_update_section`, `kb_ensure_entry`, `kb_search_wiki`, `kb_read_page`, `kb_commit`.
- **MCP stdio server** in `src/mcp_server.ts` exposing all 8 tools over `@modelcontextprotocol/sdk@1.29.0`.
- **Skills** (LLM-facing procedures) in `skills/kb_ingest/SKILL.md`, `skills/kb_query/SKILL.md`, `skills/kb_lint/SKILL.md`.
- **Wiki conventions** in `kb/schema/wiki-conventions.md` (single source of truth for frontmatter / wikilinks / page types).
- **V2 KB layout** under `kb/wiki/`: `sources/`, `entities/`, `concepts/`, plus navigation pages `index.md` and `log.md`.

## 2. What's committed on this branch

Commits since `main` (newest first):

| SHA | Subject |
|---|---|
| `c92119d` | docs: V2 migration session snapshot 2026-04-12 |
| `37a3594` | refactor: rewrite e2e_v2_ingest.ts as general-purpose driver exercising all 8 tools |
| `0cf64b1` | fix: migrate V1 wiki index.md and log.md to V2 conventions |
| `1ec3db0` | fix: kb_ensure_entry bumps updated_at and preserves insert order |
| `c758443` | fix: mcp_server WORKSPACE_ROOT semantics + SDK version pin |
| `230cd59` | feat: V2 E2E first-pass output — multi-page ingest from RISC-V TEE source |
| `dddfc6f` | refactor: clean up MCP SDK import workaround — use dynamic import with .js extension |
| `6710ceb` | feat: MCP stdio server exposing V2 tools |
| `d1ff4b8` | chore: remove V1 test_e2e.ts — obsolete under V2 LLM-driven flow |
| `eb7c28f` | chore: local configs and llm-wiki idea doc |
| `167e891` | feat: V2 Phase 2 — LLM-driven skills + wiki conventions |

`npx tsc --noEmit` passes clean at the tip of the branch.

## 3. Phase-by-phase progress

### Phase 1 — Tool layer (done, pre-session)
All 8 `src/tools/kb_*.ts` implemented.

### Phase 2 — Skills + conventions (done)
- `skills/kb_ingest|kb_query|kb_lint/SKILL.md` written; `kb/schema/wiki-conventions.md` written.
- **Codex review: 5 findings, all fixed** (rolled into `167e891` + follow-ups):
  1. `kb_lint` couldn't enumerate via `kb_search_wiki("*")` → rewritten to Read `kb/state/cache/page-index.json` directly.
  2. Missing `dedup_key` in kb_query / kb_lint save flows → added canonical patterns `index_{topic_id}`, `log_analysis_{topic_id}_{YYYY-MM-DD}`.
  3. `kb_ingest` didn't mandate `append: true` → explicit instruction added.
  4. `kb_read_page` error message referenced stale `kb_apply_patch` → replaced with `kb_write_page`.
  5. Skills didn't check `warnings[]` → explicit check instructions added.

### Phase 3 — MCP exposure + E2E + migration (done, one follow-up pending)

| Sub-phase | Status | Notes |
|---|---|---|
| 3.1 Investigate MCP exposure | completed | |
| 3.2 Implement MCP stdio server | completed | `6710ceb` + `dddfc6f` |
| 3.3 E2E validation | completed | First-pass manual LLM flow → commit `230cd59` |
| 3.4 Delete V1 test_e2e.ts | completed | `d1ff4b8` |
| 3.5 V1 legacy wiki data handling | completed | Rolled into Fix C |
| 3.6 Obsidian compatibility spot-check | **pending** | Static navigation/link updates are in place; GUI backlinks/graph spot-check still pending |
| 3.7 README update for V2 architecture | completed | `README.md` now documents V2 architecture, MCP startup semantics, and safe E2E usage |
| 3.8 Formal wiki ingest refresh | completed | 2026-04-19: added `src_sha256_08e04538`, new concept `risc_v_matrix_extensions`, updated `risc_v` / `index.md` / `log.md` |

**Codex review of Phase 3: 1 Critical + 3 Major + 3 Minor. All 7 fixed.**

| ID | Severity | Fix | Commit |
|---|---|---|---|
| 1 | Critical | MCP `WORKSPACE_ROOT` semantics — resolves to `{root}/kb`; `KB_ROOT` stays as absolute override; startup guard exits 2 on missing kb_root | `c758443` |
| 7 | Minor | SDK pinned to exact `1.29.0` | `c758443` |
| 4 | Major | V1 `index.md` / `log.md` had mixed V1/V2 state → migrated to wikilinks + `## [date] migrated` headings | `0cf64b1` |
| 5 | Minor | `kb_ensure_entry` didn't bump `updated_at` | `1ec3db0` |
| 6 | Minor | `kb_ensure_entry` inserted in reverse order inside sections — now walks to section end | `1ec3db0` |
| 2 | Major | E2E only exercised 5/8 tools — driver rewritten to exercise all 8, generic source path via CLI, idempotency test built in | `37a3594` |
| 3 | Major | E2E had hardcoded RISC-V boilerplate — driver now templates from source frontmatter | `37a3594` |

## 4. Working-tree state at refresh time (2026-04-19 snapshot, ⚠️ dirty)

Below is the refresh-time working-tree snapshot; it does not include this document's current maintenance edits.

```
 D .codex/AGENTS.md
 D .codex/agents/explorer.toml
 D .codex/agents/worker.toml
 D .codex/config.toml
 M kb/state/cache/page-index.json
 M kb/wiki/entities/risc_v.md
 M kb/wiki/index.md
 M kb/wiki/log.md
 M scripts/e2e_v2_ingest.ts
?? README.md
?? kb/wiki/concepts/risc_v_matrix_extensions.md
?? kb/wiki/sources/src_sha256_08e04538.md
?? scripts/validate_e2e_v2_ingest_safety.ts
```

Compared with the 2026-04-12 snapshot, the old "E2E driver overwrote real KB with placeholder pages" state is no longer the active issue.

Current dirtiness reflects ongoing V2 hardening + real wiki ingest updates, not throwaway E2E placeholder pollution.

## 5. Open issues / new findings

### 5.1 E2E driver non-destructive debt status: resolved (2026-04-19)

`scripts/e2e_v2_ingest.ts` now:
- defaults to a throwaway temp copy of `./kb` when `--kb-root` is omitted;
- rejects `--commit` unless explicit `--kb-root` is provided;
- enforces commit guard so `--commit` target must be exactly `<git-top-level>/kb`;
- checks run-2 content idempotency via snapshot diff.

`scripts/validate_e2e_v2_ingest_safety.ts` exists and encodes default-mode safety, explicit-mode content idempotency, and commit-guard checks.

Residual caveat: explicit `--kb-root <path>` mode intentionally writes to that target.

### 5.2 Formal wiki ingest completed on 2026-04-19

Verified in current `kb/wiki`:
- new source: `sources/src_sha256_08e04538.md`
- new concept: `concepts/risc_v_matrix_extensions.md`
- updated entity: `entities/risc_v.md` (`source_ids` includes `src_sha256_08e04538`)
- updated navigation/log: `index.md` and `log.md` contain the 2026-04-19 ingest updates

### 5.3 Codex has not yet re-reviewed the post-remediation state

Per earlier direction ("走方案B，可以先处理技术债。这轮E2E验证完成后，请让codex review这一阶段的工作"), another Codex review should run after the remediation round is complete. Not yet dispatched.

## 6. Remaining tasks

Task IDs refer to the TaskList in the planning thread.

| ID | Subject | Status | Blocked by |
|---|---|---|---|
| #23 | Phase 3.6: Obsidian compatibility spot-check | pending | GUI verification not yet executed |
| #24 | Phase 3.7: README update for V2 architecture | completed | — |
| (done) | E2E driver non-destructive hardening + safety validation script | completed | — |
| (done) | Formal wiki ingest refresh (`src_sha256_08e04538`) | completed | — |
| (new) | Codex review round 2 on Phase 3 remediation | pending | — |

## 7. Key file / command reference

**Paths**
- MCP server entrypoint: `src/mcp_server.ts` (bin `kb-mcp`, scripts `start:mcp`)
- V2 tool implementations: `src/tools/kb_*.ts`
- Skills: `skills/kb_{ingest,query,lint}/SKILL.md`
- Conventions: `kb/schema/wiki-conventions.md`
- E2E driver: `scripts/e2e_v2_ingest.ts` (uses `tsconfig.scripts.json`)

**Commands**
- `npm run build` — compile to `dist/`
- `npm run typecheck` — no-emit check (passes clean)
- `npm run start:mcp` — launch MCP stdio server
- `npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts <source.md>` — run E2E driver in safe default mode (throwaway temp KB)
- `npx tsx --tsconfig tsconfig.scripts.json scripts/e2e_v2_ingest.ts <source.md> --kb-root <abs-kb-root> [--commit]` — explicit target mode; `--commit` allowed only for `<git-top-level>/kb`

**Env vars for MCP server**
- `KB_ROOT=<abs-path-to-kb-dir>` — absolute override
- `WORKSPACE_ROOT=<repo-root>` — resolves to `{repo}/kb`
- Fallback: `./kb` relative to cwd
- Server exits with code 2 at startup if `kb_root` doesn't exist as a directory.

## 8. Notable design decisions captured this session

- `@modelcontextprotocol/sdk@1.29.0` dual ESM/CJS export map is broken: `./*` wildcard omits `.js` extension so Node CJS `require()` can't resolve it. Fix: dynamic `await import("@modelcontextprotocol/sdk/.../stdio.js")` with explicit `.js` suffix inside `async main()`. Static `import type` at module scope still works because TS uses `typesVersions`. Rationale documented in `src/mcp_server.ts` header.
- `WORKSPACE_ROOT` means **repo root**, not the `kb/` dir — stated explicitly in server startup log, enforced by startup guard.
- V1 → V2 wiki migration: all relative links rewritten as `[[src_sha256_xxx|title]]` wikilinks; V1 log bullets converted into `## [unknown] migrated | {title}` headings grouped under `## V1 历史条目 (迁移)`. Summaries are placeholder-equal-to-title with a HTML comment marker for `kb_lint` to flag later.
- `kb_ensure_entry` now parses frontmatter, bumps `updated_at` to today, and re-serializes on every successful insert. Insert position walks forward from anchor to the next heading of same-or-higher level (trailing blank lines trimmed) so new entries land at section end.
