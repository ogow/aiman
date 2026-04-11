# Agent Authoring Reference

This guide is for tightening authored `aiman` specialists after the first scaffold exists.

For the basic path, start with [Creating Agents](./creating-agents.md).

## Design For One Stable Job

The most reliable agents are narrow.

Good:

- `change-reviewer`
- `site-mapper`
- `doc-updater`

Bad:

- `general-helper`
- `coding-assistant`
- `project-operator`

Before editing the prompt, lock these decisions:

- the one job the agent owns
- what evidence it must gather before deciding
- what it should do when evidence is missing
- when it should stop
- whether the output is for a human (`text`) or a machine (`schema`)

## Output Modes

`aiman` supports two public output lanes:

| Mode     | Use it for                                           | Stored as          |
| -------- | ---------------------------------------------------- | ------------------ |
| `text`   | Human-readable answers, reviews, plans, explanations | `finalText`        |
| `schema` | Strict JSON for automation                           | `structuredResult` |

For schema-mode agents, keep the public contract small:

- `summary`
- `outcome`
- `result`

Do not teach `next` as part of normal authored-agent design. Routing and follow-up decisions belong in the harness or human workflow around the agent.

## Prompt Shape

Use a simple, explicit structure:

1. `Role`
2. `Task Input`
3. `Instructions`
4. `Stop Conditions`
5. `Expected Output`

Wrap `{{task}}` in XML:

```md
## Task Input

<task>
{{task}}
</task>
```

That boundary matters because it keeps user-supplied task text separate from the agent’s own instructions.

## Reliability Rules

- Tell the agent what to do when evidence is missing.
- Prefer a blocked result over guessing.
- Add explicit stop conditions so the agent does not wander.
- Keep the expected output concrete enough that another human can tell whether the run succeeded.
- Keep shared repo guidance in `AGENTS.md`, not copied into every agent.

## Common Mistakes

- Vague success criteria
- No blocked path when evidence is missing
- No stop conditions
- Using `schema` when a human is the real reader
- Teaching orchestration or handoff behavior inside the agent

## Tightening Workflow

1. Edit the agent body.
2. Run `aiman agent check <name>`.
3. Run one small smoke task.
4. Inspect the prompt and run record if the result is weak.
5. Make the smallest prompt change that addresses the observed failure.

If you want guided help while repairing one agent, use `$agent-hardening`.
