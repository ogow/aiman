# Agent Harnesses

Use a harness when you want `aiman` to execute a human-written plan through repeatable agent runs, deterministic checks, retries, and reviews.

`aiman` remains the run engine. The harness owns orchestration.

## Default Flow

The recommended cheap path is:

```text
human plan
  -> builder agent implements one task
  -> harness runs deterministic checks
  -> builder retries once if checks fail
  -> reviewer runs only when risk requires it
  -> final reviewer checks the whole diff
  -> harness writes a report
```

Do not create agents for linting, formatting, typecheck, tests, or diff collection. Those are deterministic harness steps.

## Example

Use the standalone example:

```sh
bun run examples/plan-harness.ts examples/plan-harness.sample.json
```

You can pass a project root as the third argument:

```sh
bun run examples/plan-harness.ts path/to/plan.json /path/to/project
```

The harness writes a JSON report under:

```text
.aiman/harness-runs/
```

## Plan Shape

Each plan is JSON:

```json
{
   "id": "my-plan",
   "builderAgent": "build",
   "reviewerAgent": "reviewer",
   "finalReview": "always",
   "maxCheckRetries": 1,
   "checks": [
      {
         "name": "typecheck",
         "command": "bun",
         "args": ["run", "typecheck"]
      }
   ],
   "tasks": [
      {
         "id": "task-1",
         "title": "Update one behavior",
         "goal": "Implement the smallest scoped change that satisfies the request.",
         "scope": ["src/lib/example.ts", "test/example.test.ts"],
         "acceptance": ["Focused tests pass.", "No unrelated files change."],
         "risk": "medium",
         "review": "auto",
         "checks": [
            {
               "name": "focused-test",
               "command": "bun",
               "args": ["test", "test/example.test.ts"]
            }
         ]
      }
   ]
}
```

Checks use command plus args instead of shell strings. This keeps check execution explicit and avoids accidental shell behavior.

## Review Policy

The harness reviews task diffs when:

- `review` is `required`
- `review` is `auto` and `risk` is `medium` or `high`
- `review` is `auto` and deterministic checks failed before a retry

The harness skips task-level review when `review` is `skip`. The final integration review still runs when `finalReview` is `always`.

Reviewer agents must start their answer with:

```text
BLOCKING: none
```

or:

```text
BLOCKING: yes
```

An unclear reviewer answer fails the harness run. That is intentional: the review output is a gate, not free-form commentary.

## Task Status

A task passes when:

- the builder agent returns success
- all configured checks pass
- required review returns `BLOCKING: none`, or blocking findings were repaired and checks pass

By default, the harness stops later tasks after a failure. Set `continueOnFailure: true` in the plan when independent tasks should keep running.

## When To Extend V1

Add new harness behavior only when real runs prove the need:

- a debugger agent after repeated non-obvious check failures
- a planner agent when users provide vague goals instead of concrete plans
- security or docs reviewers for specific high-risk areas
- richer cost and token accounting when provider usage is available in run records
