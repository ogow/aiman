# Debug Loop

Use this loop when an authored `aiman` agent is failing or behaving inconsistently.

1. Run `aiman agent check <name>`.
2. Run one tiny smoke task with `aiman run <name> --task "..."`.
3. Read `aiman runs show <run-id>` first.
4. Read `aiman runs inspect <run-id> --stream prompt`.
5. Read `aiman runs inspect <run-id> --stream run`.
6. Read `stdout` or `stderr` only if the parsed result is still unclear.

## Common Fixes

### The agent wanders

- Narrow the role.
- Strengthen constraints.
- Add explicit stop conditions.

### The agent guesses

- Add missing-evidence behavior.
- Tell it to return `blocked` or another explicit outcome instead of speculating.

### The schema output breaks

- Make the expected output smaller and more concrete.
- Name the intended `outcome` values.
- Tell the agent not to add prose before or after the final JSON.

### The result is too vague for a follow-up agent

- Tighten the task-specific fields inside `result`.
- Keep critical facts in the main output instead of hiding them in artifacts.

Change one thing at a time and re-run the same tiny smoke task before widening scope.
