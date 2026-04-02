# Agent Baseline

Use this file only as explicit baseline context for authored `aiman` agents through `contextFiles`.

Keep it stable, neutral, and non-task-specific. Do not treat it as ambient context, and do not put workflow steering or one-off project decisions here.

## Build And Checks

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Important Paths

- `.aiman/agents/`: authored specialist definitions
- `.agents/skills/`: provider-native skill bundles
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
- session commands: `aiman sesh ...` commands that inspect saved runs

## Safety

- Respect the agent's declared permissions and effective run mode.
- Prefer deterministic, inspectable output over hidden side effects.
- Use explicit `contextFiles` for repo guidance instead of assuming router files such as `AGENTS.md` are attached.
