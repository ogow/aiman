# CLI Notes

`aiman` records one agent run at a time. A human or wrapper chooses which agent to run; `aiman` launches it, persists one canonical `result.json`, and exposes that result through the default TUI or the `run` inspection commands.

Each run persists:

- one canonical `result.json`
- optional `stdout.log`
- optional `stderr.log`
- optional `artifacts/`

The run store is global under `~/.aiman/runs/` and is scanned directly from disk. `aiman` does not use SQLite for run lookup.

## Current Commands

- `aiman`
- `aiman agent list [--scope project|user] [--json]`
- `aiman agent show <agent> [--scope project|user] [--json]`
- `aiman agent check <agent> [--scope project|user] [--json]`
- `aiman agent create <name> --scope project|user --provider codex|gemini --model <id|auto> --reasoning-effort <value> --description <text> [--instructions <text>] [--force] [--json]`
- `aiman run <agent> [--task <text>] [--cwd <path>] [--scope project|user] [--detach] [--json]`
- `aiman runs list [--all] [--limit <n>] [--json]`
- `aiman runs show <run-id> [--json]`
- `aiman runs logs <run-id> [--stream all|stdout|stderr] [--tail <n>] [-f|--follow] [--json]`
- `aiman runs inspect <run-id> [--json] [--stream run|prompt|stdout|stderr]`
- `aiman runs stop <run-id> [--json]`

## Agent Scopes

Agents can exist in two scopes:

- project scope: `<repo>/.aiman/agents/`
- user scope: `~/.aiman/agents/`

`aiman agent list`, `aiman agent show`, and `aiman run` consider both scopes by default and prefer the project agent when both scopes define the same name. `aiman agent create` requires an explicit `--scope`.

## Agent Authoring

For `aiman agent create`, `--scope`, `--provider`, `--model`, and `--description` are required. `--reasoning-effort` is required for Codex and optional for Gemini (defaults to `none`).

Agent bodies are explicit prompt templates. `aiman` substitutes runtime values where the body asks for them, then appends one required JSON success contract. New agents created by `aiman agent create` include `{{task}}` by default, and runnable agents should include that placeholder somewhere in the body.

On success, every agent must return JSON with exactly these top-level keys:

- `resultType`
- `summary`
- `result`
- `handoff`
- `artifacts`

`handoff` must always include:

- `outcome`
- `notes`
- `questions`

Use `docs/agent-authoring.md` for the higher-level checklist.
Use `docs/agent-debugging.md` for the practical smoke-test and inspection workflow.

## Command Structure

- `aiman` with no args is the default OpenTUI workbench for humans working in a real TTY.
- `aiman agent create <name>` is the authoring path for creating structured agent files without hand-writing raw frontmatter.
- `aiman run <agent>` is the default synchronous worker path. It runs in the foreground, persists the run, and returns the final result when complete.
- `aiman run <agent> --detach` is the explicit background path. It starts a managed worker and returns immediately with the live run id.
- `aiman runs stop <id>` stops one active run by run id.
- `aiman runs inspect <run-id> --stream run` shows the canonical persisted `result.json` file.
- `aiman runs inspect <run-id> --stream prompt` shows the exact rendered prompt stored in the launch snapshot.
- `aiman runs inspect <run-id> --stream stdout|stderr` reads the default log files from that run directory.

Foreground `aiman run` stays human-friendly:

- on success it prints the concise `summary` when one exists
- on failure it prints a compact failure block
- detailed inspection stays in `aiman runs show`, `aiman runs logs`, `aiman runs inspect`, and the interactive workbench

## Debugging Workflow

When an authored agent is weak, malformed, or hard to chain:

1. Run `aiman agent check <name>`.
2. Run one tiny smoke task with `aiman run <name> --task ...`.
3. Read `aiman runs show <run-id>` first for the parsed summary, `resultType`, `result`, `handoff`, and final error.
4. Read `aiman runs inspect <run-id> --stream prompt` to confirm the exact rendered prompt.
5. Read `aiman runs inspect <run-id> --stream run` to inspect the canonical `result.json`.
6. Read `aiman runs inspect <run-id> --stream stdout|stderr` when provider output or JSON parsing still looks suspicious.

## Run Layout

Each run lives under:

```text
~/.aiman/runs/<YYYY-MM-DD>/<timestamp-run-id>/
```

Default files:

- `result.json`
- `stdout.log`
- `stderr.log`
- `artifacts/`

`result.json` stores the canonical machine-readable run state, including the immutable `launch` snapshot, structured `result`, `handoff`, artifact manifest, and terminal error data when present.

`active` state is derived from the stored `pid` plus a fresh persisted heartbeat:

- `active: true` means the supervising `aiman` process for that run still exists and the supervisor heartbeat is still fresh
- `active: false` means the run is either terminal or the supervising process is gone

## Development Commands

- `bun run dev`
- `bun run test`
- `bun run test:provider-contract`
- `bun run typecheck`
- `bun run build`
- `bun run lint`
