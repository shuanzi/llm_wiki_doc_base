---
title: RAG and Persistent Wiki
type: analysis
status: active
created: 2026-08-31T14:27:15Z
updated: 2026-08-31T14:27:15Z
---

# RAG and Persistent Wiki

## Question

How does a maintained wiki differ from query-time retrieval over raw documents?

## Evidence-backed distinction

The source note says query-time retrieval may repeat synthesis in later Sessions, while a persistent wiki stores maintained Markdown between sources and future queries. [Source record](../sources/src-44190eefdbf1.md)

## Synthesis

The two patterns are complementary rather than mutually exclusive:

| Layer | Primary value | Persistent status |
|---|---|---|
| Raw-source retrieval | Find details not yet synthesized | Replaceable index; raw files remain durable |
| Persistent Wiki | Preserve cross-source understanding and navigation | Durable Markdown knowledge |

## Inference and uncertainty

A persistent wiki should reduce repeated synthesis for recurring questions, but the actual quality depends on maintenance discipline and requires empirical evaluation.
