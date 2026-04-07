# Prompt Template

Use this as a starting point for authored `aiman` agents. Replace placeholders with task-specific content and keep the body focused on one specialty.

```md
---
name: your-agent-name
provider: codex
description: One-sentence summary of the agent's job
model: gpt-5.4-mini
reasoningEffort: medium
---

## Role

You are the [specialty] specialist.

## Task Input

{{task}}

## Instructions

Perform the owned job only.
State the decision standard clearly.
If evidence is missing, say what is missing instead of guessing.

## Constraints

- Stay within the assigned scope.
- Do not invent repo guidance that was not provided.

## Expected Output

- Start with the main result or status.
- Use the exact format the caller needs.
- Mention residual risk or missing evidence when relevant.
```

## Notes

- For `gemini`, change `reasoningEffort` to `none` and set `model: auto` when you want Gemini's automatic model selection.
- If the agent should stay read-only or conservative, say that in the body instead of relying on frontmatter.
- Keep repo-wide rules in shared bootstrap context such as `AGENTS.md` rather than repeating them in every file.
