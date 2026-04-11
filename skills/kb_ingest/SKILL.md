---
name: kb_ingest
description: Ingest a new source into the local knowledge base through a patch-first workflow
user-invocable: true
---

When the user asks to add a source, update the wiki from a source, or summarize and store new material:

1. Call `kb_source_add` to register the source and get `source_id`.
2. Call `kb_plan_ingest` to produce a structural patch plan.
3. Call `kb_draft_patch` to render the plan into a complete, replayable file changeset.
4. If the topic is high-risk, present the draft summary and wait for confirmation.
5. Otherwise call `kb_apply_patch` to execute the draft.
6. Call `kb_commit` with a concise message.

Always ensure:
- `kb/wiki/log.md` is updated (via ensure_entry in the draft)
- Any new page is linked from an index or parent page
- Unresolved conflicts are written explicitly
- The full plan → draft → applied chain is archived in `kb/state/`
