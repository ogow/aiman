# Architecture

## Goal

`aiman` is a local CLI for managing reusable agents and spawning agent runs through existing provider CLIs.

The system is designed around three concerns:

- agent definitions
- run orchestration
- workspace-local execution state

Skills are intentionally out of scope for `aiman`. Provider-native skills should stay in the standard skill folders that the downstream CLIs already understand:

- `~/.agents/skills`
- `<workspace>/.agents/skills`

`aiman` does not register, merge, resolve, or inject those skills. It runs the selected CLI in the target workspace and lets that CLI discover and load skills in its normal way.

## Core Model

There are two primary entities:

- `agent`: a reusable definition of how to run a specialist
- `run`: one execution of an agent against a task

There is no first-class `skill` entity in `aiman`.

Agent configuration is authored as Markdown with YAML frontmatter and a Markdown prompt body. The prompt body is provider-native text passed through as-is to the downstream CLI.

A run contains:

- agent identity and source
- provider, model, and reasoning effort
- task prompt and assembled prompt
- workspace, write scope, and timeout
- resolved command, args, and env
- status, pid, timestamps, exit code, and summary

## Main Components

### CLI entrypoint

The CLI parses subcommands, resolves input from flags, files, or stdin, and renders either human-readable output or `--json`.

Public command surface:

- `aiman agent list`
- `aiman agent get <name>`
- `aiman agent create ...`
- `aiman run spawn ...`
- `aiman run list`
- `aiman run get <run-id>`
- `aiman run wait <run-id>`
- `aiman run cancel <run-id>`
- `aiman run logs <run-id>`

Entry point: [src/cli.ts](/Users/ogow/Code/aiman/src/cli.ts)

### Agent Registry

The registry loads agents from both home and workspace storage, merges them, and applies project precedence by agent name.

If the same agent exists in both scopes, only the workspace version is visible.

Implementation: [src/lib/agent-registry.ts](/Users/ogow/Code/aiman/src/lib/agent-registry.ts)

### Run Manager

The run manager resolves a visible agent, assembles the final prompt, asks the provider adapter for a concrete run plan, stores the queued run, and then either:

- starts the run in-process for engine-level usage and tests
- starts a detached worker for CLI usage so later commands can inspect or cancel the same run

Implementation: [src/lib/runner.ts](/Users/ogow/Code/aiman/src/lib/runner.ts)

### Detached Run Worker

The worker process starts queued runs for the CLI, captures stdout and stderr into trace events, and updates final run status after completion or termination.

Implementation: [src/run-worker.ts](/Users/ogow/Code/aiman/src/run-worker.ts)

### Provider Runners

Provider runners own model validation, reasoning-effort support, and command construction for each supported CLI. Authored agent files do not override command wiring; the provider adapter decides how to invoke the downstream CLI.

Implementation: [src/lib/providers/index.ts](/Users/ogow/Code/aiman/src/lib/providers/index.ts)

### Run Store

Run metadata and trace events are stored only in the workspace. Home storage is never used for active run state.

Implementation: [src/lib/run-store.ts](/Users/ogow/Code/aiman/src/lib/run-store.ts)

## Prompt Assembly

The final prompt is built from:

1. `AGENTS.md` in the workspace when present
2. the agent system prompt
3. the task prompt

Provider-native skills are not expanded into the assembled prompt. If the selected CLI supports skills, it discovers them from the standard skill folders while running in the workspace.

Implementation: [src/lib/context.ts](/Users/ogow/Code/aiman/src/lib/context.ts)

## Error Handling

Errors are normalized into explicit application errors and rendered as readable CLI errors or serialized JSON error payloads.

Examples:

- agent not found
- run not found
- model not found
- command not found
- validation failures

Implementation: [src/lib/errors.ts](/Users/ogow/Code/aiman/src/lib/errors.ts)

## Current Constraints

- provider defaults are intentionally minimal and may still need tightening against each CLI's evolving flags
- run state still uses JSON files, not SQLite
- `reasoningEffort` is provider/model-configured, so support and accepted values can differ between CLIs and models
