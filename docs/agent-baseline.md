# Agent Baseline

Use this file as a drafting reference for a shared repo bootstrap context file such as `AGENTS.md`.

`aiman` does not attach this file directly. The point is to show the kind of stable, neutral, non-task-specific guidance that belongs in a shared bootstrap context file when a repo wants native provider context.

## Build And Checks

- `bun run test`
- `bun run typecheck`
- `bun run lint`
- `bun run build`

## Important Paths

- `.aiman/agents/`: authored specialist definitions
- `docs/cli.md`: CLI surface and operator behavior
- `docs/agent-runtime.md`: runtime contract and provider behavior
- `docs/typescript-style.md`: TypeScript editing rules
- `MEMORY.md`: durable repo operating model
- `ARCHITECTURE.md`: current structure and module boundaries

## Repo Norms

- Keep changes scoped to the assigned task.
- Prefer explicit context over assumptions about hidden repo instructions.
- Do not invent files, outputs, or verification results.
- Avoid changing unrelated files unless the task truly requires it.
- When editing TypeScript, follow `docs/typescript-style.md`.

## Repo Terms

- agent: an authored Markdown specialist file under `.aiman/agents/`
- run: one persisted execution of one authored agent
- launch snapshot: the immutable provider invocation metadata frozen into `run.md`
- run commands: `aiman runs ...` commands that inspect saved runs

## Safety

- Respect the agent's declared mode and effective run rights.
- Prefer deterministic, inspectable output over hidden side effects.
- Put only shared repo guidance into the shared bootstrap context file; keep task strategy inside the authored agent body.
