---
title: Persistent Wiki
type: concept
status: active
created: 2026-08-31T14:27:15Z
updated: 2026-08-31T14:27:15Z
---

# Persistent Wiki

## Definition

A persistent wiki is a maintained layer of interlinked Markdown knowledge between raw sources and future Agent queries. It accumulates synthesis across Sessions instead of rebuilding every connection at query time.

## Source-backed facts

The example source argues that new material should update existing concepts, analyses, maps, and open questions, and that runtime indexes should remain replaceable sidecars. [Source record](../sources/src-44190eefdbf1.md)

## Design implications

- The durable unit is a readable page with provenance, not an embedding chunk.
- Ingest is complete only when affected knowledge and navigation are updated.
- Agent Sessions and search databases may accelerate work but are not sources of truth.

## Relationships

- Compared with query-time retrieval in [RAG and Persistent Wiki](../analyses/RAG%20and%20Persistent%20Wiki.md).
- Its reliability depends on [Knowledge Maintenance Quality](../questions/Knowledge%20Maintenance%20Quality.md).
