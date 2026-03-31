# Aiman Provider Behavior

Use this file when the task depends on `aiman` provider differences, run rights, scope resolution, or MCP and skill preflight behavior.

This file describes providers used by `aiman` itself. It is not a statement about which host agent system is reading this skill.

## Providers

Current providers:

- `codex`
- `gemini`

## Permissions and Effective Rights

Agent files declare:

- `permissions: read-only`
- `permissions: workspace-write`

Provider behavior currently maps those permissions like this:

- Codex `read-only`: `codex exec --sandbox read-only`
- Codex `workspace-write`: `codex exec --sandbox workspace-write`
- Gemini `read-only`: `gemini --approval-mode plan`
- Gemini `workspace-write`: `gemini --approval-mode auto_edit`

Use `aiman agent show <agent>` when you need to confirm what rights the runtime will actually grant.

## Reasoning Effort

- Codex supports `reasoningEffort` by mapping it to `model_reasoning_effort`
- Gemini does not support `reasoningEffort` and should fail validation instead of ignoring it

## Scope Resolution

Agent resolution:

- project scope first: `<repo>/.aiman/agents/`
- user scope second: `~/.aiman/agents/`

Skill resolution:

- project scope first: `<repo>/.agents/skills/`
- user scope second: `~/.agents/skills/`

Use `--scope project|user` when you need to force one scope.

## Launch Modes

- Foreground is the default and preferred path
- Detached is the explicit background path

Practical rule:

- use foreground when the caller needs the result now
- use detached when the caller needs a background run id and plans to inspect it later

## Skill and MCP Preflight

Declared `skills:`:

- are resolved before launch
- are not inlined into prompts by `aiman`
- are frozen into the run's launch snapshot for later inspection

Declared `requiredMcps:`:

- are checked through the selected provider CLI before launch
- fail fast when a requirement is not met

## Session Liveness

Treat run liveness as a two-signal check:

- supervising `pid`
- fresh persisted heartbeat

Do not assume `status: running` alone means the run is active right now.
