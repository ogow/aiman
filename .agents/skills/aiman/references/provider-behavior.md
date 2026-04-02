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

Project-root rule:

- project commands may walk up to the nearest ancestor with project markers
- home-level `~/.aiman` and `~/.agents` do not make `$HOME` count as a project root by themselves
- project-over-user precedence still applies once a real project root is found

## Launch Modes

- Foreground is the default and preferred path
- Detached is the explicit background path

Practical rule:

- use foreground when the caller needs the result now
- use detached when the caller needs a background run id and plans to inspect it later

Stop behavior:

- use `aiman agent stop <runId>` for non-TTY stop requests
- use `aiman sesh top` only when a human is driving the dashboard directly
- Windows `.cmd` / `.bat` provider wrappers are stopped as a process tree, not just by signalling the `cmd.exe` wrapper

## Skill and MCP Preflight

Declared `skills:`:

- are recorded as declared names in the run's launch snapshot
- are not inlined into prompts by `aiman`
- are left to the downstream provider runtime for actual discovery and use

Declared `requiredMcps:`:

- are checked through the selected provider CLI before launch
- fail fast when a requirement is not met

## Session Liveness

Treat run liveness as a two-signal check:

- supervising `pid`
- fresh persisted heartbeat

Do not assume `status: running` alone means the run is active right now.
