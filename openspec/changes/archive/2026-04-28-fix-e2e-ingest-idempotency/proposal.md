## Why

The E2E ingest safety validation currently fails because the driver writes entity frontmatter in a format that differs from `kb_update_section`'s normalized output. A prior fix that runs `kb_update_section` on run 2 makes the final snapshot pass, but it masks second-pass write drift and introduces avoidable time-based false-failure risk.

## What Changes

- Make V2 E2E page templates serialize frontmatter with the shared `serializeFrontmatter` helper so `kb_write_page` output already matches normalized formatting (including array style).
- Keep `kb_update_section` coverage as a run-1-only check, and skip it on run 2 so snapshot diff can expose real second-pass write drift.
- Keep runtime KB tool behavior unchanged; this is a validation-driver fix, not an API or data model change.

## Capabilities

### New Capabilities
- `e2e-ingest-validation`: Defines the expected behavior for the V2 ingest E2E driver and its safety/idempotency validation script.

### Modified Capabilities
- None.

## Impact

- Affected code: `scripts/e2e_v2_ingest.ts`.
- Affected validation: `scripts/validate_e2e_v2_ingest_safety.ts` and related targeted test commands.
- No new dependencies.
- No breaking changes to MCP tools, OpenClaw installer behavior, or KB file format rules.
