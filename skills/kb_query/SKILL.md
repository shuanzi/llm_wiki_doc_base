---
name: kb_query
description: Answer questions primarily from the local wiki knowledge layer
user-invocable: true
---

When the user asks a question about topics covered by the knowledge base:

1. Call `kb_search_wiki` first.
2. Call `kb_read_page` on the top relevant pages.
3. Synthesize the answer from the wiki layer.
4. If critical facts are missing, say so explicitly.
5. When multiple source pages relate to the same topic, suggest the user trigger `kb_ingest` to consolidate into a concept page.
6. Suggest `kb_ingest` only when new source ingestion is needed.

Prefer:
- wiki over raw
- explicit uncertainty over speculation
- structured answers over broad freeform summaries
