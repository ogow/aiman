# CLI Notes

`aiman` runs one agent at a time and records the result to disk.

## Main Commands

- `aiman`
- `aiman agent list [--scope project|user] [--json]`
- `aiman agent show <agent> [--scope project|user] [--json]`
- `aiman agent check <agent> [--scope project|user] [--json]`
- `aiman agent create <name> [--scope project|user] [--provider codex|gemini] [--description <text>] [--result-mode text|schema] [--instructions <text>] [--model <id|auto>] [--reasoning-effort <value>] [--timeout-ms <ms>] [--force] [--json]`
- `aiman run <agent> [--task <text>] [--cwd <path>] [--scope project|user] [--detach] [--json]`
- `aiman runs list [--all] [--limit <n>] [--json]`
- `aiman runs show <run-id> [--json]`
- `aiman runs logs <run-id> [--stream all|stdout|stderr] [--tail <n>] [-f|--follow] [--json]`
- `aiman runs inspect <run-id> [--json] [--stream run|prompt|stdout|stderr]`
- `aiman runs stop <run-id> [--json]`

## Agent Creation

`aiman agent create <name>` is the normal authoring path.

The default experience is interactive-first:

- provider: `codex` or `gemini`
- one-sentence description
- output style: `text` or `json`

If you already know what you want, you can still pass flags directly.

Advanced flags:

- `--model`
- `--reasoning-effort`
- `--timeout-ms`

Provider defaults:

- Codex: `gpt-5.4-mini`, `medium`
- Gemini: `auto`, `none`

## Agent Checks

`aiman agent check <name>` is the fast static gate. It focuses on the common authoring mistakes:

- missing `{{task}}`
- missing XML wrapper around `{{task}}`
- missing stop conditions
- missing missing-evidence guidance
- weak output-shape guidance

## Result Modes

- `text`: default. `aiman run` prints `finalText` directly when the run succeeds.
- `schema`: strict JSON. The final answer must contain `summary`, `outcome`, and `result`.

## Debugging Flow

When an agent is weak or malformed:

1. `aiman agent check <name>`
2. `aiman run <name> --task "..."`
3. `aiman runs show <run-id>`
4. `aiman runs inspect <run-id> --stream prompt`
5. `aiman runs inspect <run-id> --stream run`
6. `aiman runs inspect <run-id> --stream stdout|stderr`

## Project Boundary

`aiman` is the agent-definition and run-recording layer.

It does not own:

- multi-agent routing
- retries
- task sequencing
- project verification policy

Those belong in a project harness or human workflow around `aiman`.
