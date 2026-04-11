# Knowledge Base Rules

1. `kb/raw` is the source-of-truth layer for original materials. Do not rewrite raw sources.
2. `kb/wiki` is the editable knowledge layer.
3. Any multi-file change under `kb/wiki` must go through the plan → draft → apply pipeline.
4. `kb_source_add` may register immutable raw-source and manifest records before a wiki patch exists.
5. Query the wiki first before falling back to raw sources.
6. Every ingest that changes `kb/wiki` must update `kb/wiki/log.md`.
7. Every new page must be linked from an index or parent page.
8. Uncertainty or contradiction must be written explicitly as conflict or open question.
9. High-value answers should be candidates for `kb/wiki/analyses/`.
10. All write targets must resolve within `kb/`. External source locators are read-only inputs.
