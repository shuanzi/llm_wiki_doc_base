# AGENTS.md

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