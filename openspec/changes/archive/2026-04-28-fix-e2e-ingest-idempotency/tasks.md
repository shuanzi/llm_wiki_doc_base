## 1. Reproduce And Locate

- [x] 1.1 Run the failing E2E ingest safety validation in the isolated worktree.
- [x] 1.2 Confirm the observed content drift is caused by inconsistent final entity page normalization between run 1 and run 2.

## 2. Implementation

- [x] 2.1 Update `scripts/e2e_v2_ingest.ts` page builders to use shared `serializeFrontmatter`, so `kbWritePage` output already matches normalized frontmatter formatting.
- [x] 2.2 Keep Step 6b as a create-time-only `kb_update_section` coverage/normalization check for the first entity, and update comments/logging to explicitly skip run 2 compensation writes.
- [x] 2.3 Assert the safety validator sees Run 2 skip Step 6b and no Run 2 `kbUpdateSection` tool call.

## 3. Validation

- [x] 3.1 Run `scripts/validate_e2e_v2_ingest_safety.ts` and confirm it passes.
- [x] 3.2 Run the targeted `tests/*.test.ts` suite or a relevant subset to confirm no regression in existing behavior.
- [x] 3.3 Run `openspec status --change fix-e2e-ingest-idempotency` and confirm the change is apply-ready.
