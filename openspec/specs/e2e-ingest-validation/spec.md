## Purpose

Defines the expected behavior for the V2 ingest E2E driver and its safety/idempotency validation script.

## Requirements

### Requirement: Two-pass ingest validation preserves final KB content
The V2 ingest E2E driver SHALL leave the KB file tree unchanged after the second ingest pass when the same source is ingested twice into the same KB root.

#### Scenario: Re-ingesting the same source is content-idempotent
- **WHEN** `scripts/e2e_v2_ingest.ts` runs against a source file and then immediately re-runs against the same source file and KB root
- **THEN** the second pass MUST keep the same `source_id`
- **AND** the second pass MUST report existing index and log entries instead of inserting duplicates
- **AND** the file-content snapshot after the second pass MUST match the file-content snapshot after the first pass

### Requirement: E2E driver writes normalization-compatible page templates
The V2 ingest E2E driver SHALL generate source/entity/concept page frontmatter using the same serialization rules as wiki section normalization, so repeated runs do not oscillate between equivalent YAML formats.

#### Scenario: Page templates already match normalized frontmatter
- **WHEN** the driver writes pages via `kb_write_page` during Step 4/5/6
- **THEN** the serialized frontmatter MUST match the shared `serializeFrontmatter` style (including block-array formatting for list fields)

#### Scenario: Run-2 snapshot is not hidden by compensation writes
- **WHEN** the second ingest pass runs on the same KB root
- **THEN** the driver MUST NOT call `kb_update_section` as a post-write compensation step in run 2
- **AND** Step 6b MUST explicitly report that it was skipped on run 2
- **AND** validation MUST fail if the run 2 output contains a `kbUpdateSection` tool call

#### Scenario: Re-running against an existing explicit KB root avoids date-only rewrites
- **WHEN** the driver runs against an explicit `--kb-root` where the first entity page already exists
- **THEN** Step 6b MUST NOT call `kb_update_section`
- **AND** the existing entity page MUST NOT be rewritten solely to update `updated_at`
