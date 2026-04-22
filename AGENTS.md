# AGENTS.md

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

## Role policy

The root agent is the planner / architect / coordinator.

For non-trivial tasks, the root agent should:
1. clarify the goal,
2. produce a short implementation plan,
3. decompose the work into bounded subtasks,
4. spawn execution-focused `worker` agents for implementation,
5. wait for results,
6. integrate findings and decide next steps.

## Delegation rules

- Root agent should avoid direct coding except for tiny glue changes, final integration, or emergency fixes.
- Use `explorer` for read-heavy analysis and codebase mapping.
- Use `worker` for concrete implementation tasks.
- Use`reviewer` for perform code review focused on correctness, regressions, edge cases, security, and missing tests. This agent should remain read-only.
- Use`test_runner` for adds or updates focused tests when needed, runs relevant validation commands, and reports pass/fail status and remaining coverage gaps.

- Spawn one worker per independent subtask when parallelism helps.
- Keep each worker task narrow and testable.

## Output contract for worker agents

Each worker should return:
- changed files
- summary of implementation
- validation performed
- unresolved risks

## Engineering constraints

- Prefer minimal diffs.
- Do not introduce new dependencies without explicit justification.
- Run targeted tests after code changes.
- Escalate architectural ambiguity back to the root agent instead of guessing.

## action rules
1. Think before acting. Read existing files before writing code.
2. Be concise in output but thorough in reasoning.
3. Prefer editing over rewriting whole files.
4. Do not re-read files you have already read unless the file may have changed.
5. Test your code before declaring done.
6. No sycophantic openers or closing fluff.
7. Keep solutions simple and direct.
8. User instructions always override this file.