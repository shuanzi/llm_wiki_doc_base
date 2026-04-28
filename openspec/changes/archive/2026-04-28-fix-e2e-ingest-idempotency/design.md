## Context

`scripts/e2e_v2_ingest.ts` runs the same ingest twice and compares the KB snapshot after run 1 against the snapshot after run 2. The entity/source/concept template frontmatter was emitted as inline arrays, while `kb_update_section` rewrites frontmatter with the shared YAML serializer (block-array style). This created serialization drift between passes. A prior patch made run 2 also call `kb_update_section`, but that turns run 2 into a compensating write path that can hide real second-pass drift.

## Goals / Non-Goals

**Goals:**
- Make `kb_write_page` output from Step 4/5/6 already match shared normalization serialization.
- Preserve `kb_update_section` coverage in the E2E driver.
- Restore `scripts/validate_e2e_v2_ingest_safety.ts` as a useful content-idempotency regression check.

**Non-Goals:**
- Change `kb_update_section` frontmatter serialization behavior.
- Change `kb_write_page` behavior or MCP tool schemas.
- Broaden the E2E driver into a real summarization or extraction implementation.

## Decisions

- Serialize source/entity/concept page frontmatter via the shared `serializeFrontmatter` helper used by wiki update logic.
  - Rationale: makes Step 4/5/6 writes converge to the same format `kb_update_section` would emit, eliminating array-style flip without changing tool behavior.
- Keep Step 6b (`kb_update_section`) as a create-time-only coverage/normalization check for the first entity page.
  - Rationale: preserves tool coverage for newly created pages while ensuring repeated top-level runs against an explicit `--kb-root` do not rewrite `updated_at` through `kb_update_section`.
- Assert that Run 2 explicitly skips Step 6b and does not call `kb_update_section`.
  - Rationale: prevents future compensation writes from hiding real second-pass drift.

- Keep the content-idempotency assertion unchanged.
  - Rationale: the assertion is correctly detecting file-content drift. The bug is in the driver leaving run 2 in a different final state, not in the assertion.

## Risks / Trade-offs

- [Risk] If template builder and shared serializer diverge in future, drift can reappear. → Mitigation: generate frontmatter directly through `serializeFrontmatter` instead of hand-written YAML.
- [Risk] `updated_at` may flap around day boundaries if re-derived every run or rewritten by Step 6b. → Mitigation: preserve existing `updated_at` when a page already exists, and only run Step 6b when the first entity page is newly created.
