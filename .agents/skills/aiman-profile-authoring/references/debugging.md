# Debugging Authored Aiman Agents

Use this reference when a created agent is vague, malformed, blocked unexpectedly, or hard for another agent to consume.

## Start Small

Debug with one tiny, concrete smoke task first.

Good smoke tasks:

- ask for one narrowly scoped change
- ask for one simple review
- ask for one small plan

Bad smoke tasks:

- combine several unrelated outcomes
- require a lot of missing context
- are so large that you cannot tell what failed first

## Fast Debug Loop

1. Run `aiman agent check <name>`.
2. Run `aiman run <name> --task "<small concrete task>"`.
3. Capture the returned run id if the run is detached, or inspect the latest run directly from the TUI or `runs list`.
4. Read `aiman runs show <run-id>`.
5. Read `aiman runs inspect <run-id> --stream prompt`.
6. Read `aiman runs inspect <run-id> --stream run`.
7. Read `aiman runs inspect <run-id> --stream stdout` and `--stream stderr` when needed.

## What Each Surface Tells You

`aiman agent check <name>`:

- static frontmatter and body-shape problems
- missing `{{task}}`
- missing recommended sections

`aiman runs show <run-id>`:

- parsed `summary`
- `resultType`
- `result`
- `handoff`
- final error

`aiman runs inspect <run-id> --stream prompt`:

- the exact rendered prompt the provider received
- whether the authored body actually says what you thought it said

`aiman runs inspect <run-id> --stream run`:

- the canonical persisted `result.json`
- the immutable launch snapshot
- whether the final run was `success`, `error`, or stuck in `running`

`aiman runs inspect <run-id> --stream stdout|stderr`:

- raw provider output
- parsing clues when the provider appears to succeed but the run still fails

## Common Failure Modes

The agent wanders:

- add `Stop Conditions`
- narrow the job in `Role`
- make `Constraints` forbid unrelated exploration

The agent guesses:

- tell it exactly what to do when evidence is missing
- require blocked handoff behavior instead of speculation

The agent returns vague results:

- define the fields inside `result`
- name a stable `resultType`
- make `Expected Output` concrete and list-shaped

The agent produces malformed success JSON:

- remind the body that the runtime already enforces the outer envelope
- make the body describe only the task-specific `result`
- smoke test again and inspect `stdout.log` if the provider emitted extra prose

The next agent still cannot use the result:

- tighten `handoff.nextTask`
- put the key structured facts into `result`
- move large detail into `artifacts/` and describe those artifacts explicitly

## Fix The Smallest Thing First

Prefer this order:

1. fix the authored body
2. rerun the same small task
3. inspect `result.json`
4. only then try a more realistic task

That keeps the debug loop fast and makes regressions easier to see.
