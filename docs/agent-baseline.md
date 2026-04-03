# Agent Baseline

Use this file as a drafting reference for `AGENTS.md#Aiman Runtime Context`.

`aiman` does not attach this file directly. The point is to show the kind of stable, neutral, non-task-specific guidance that belongs in the runtime-context section when a repo wants shared `aiman` context.

## Build And Checks

- `bun run test`
- `bun run typecheck`
- `bun run lint`
- `bun run build`

## Important Paths

- `.aiman/profiles/`: authored specialist definitions
- `.aiman/skills/`: local `aiman` skill bundles
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

- profile: an authored Markdown specialist file under `.aiman/profiles/`
- run: one persisted execution of one authored profile
- launch snapshot: the immutable provider invocation metadata frozen into `run.md`
- session commands: `aiman sesh ...` commands that inspect saved runs

## Safety

- Respect the profile's declared mode and effective run rights.
- Prefer deterministic, inspectable output over hidden side effects.
- Put only shared repo guidance into `AGENTS.md#Aiman Runtime Context`; keep task strategy inside the authored profile body.
