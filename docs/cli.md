# CLI Notes

`aiman` is intended to be called by an external parent agent or operator who chooses which specialist to run. The CLI itself manages specialists and persisted runs; it does not act as the top-level orchestrator.

Specialists can optionally write a structured `report.md` into their run directory. `aiman` surfaces the parsed frontmatter and referenced artifacts through `aiman inspect`, but it does not own task queues or memory.

## Current Commands

- `aiman list [--json]`
- `aiman show <agent> [--json]`
- `aiman run <agent> [--task <text>] [--cwd <path>] [--mode read-only|workspace-write] [--json]`
- `aiman inspect <run-id> [--json] [--stream stdout|stderr]`

## Command Structure

- Top-level commands live in `src/cmd/`.
- Command modules export `command`, `describe`, `builder`, and `handler` to match the `yargs` command-module pattern.
- `aiman run <agent>` is the primary execution path.
- `aiman inspect <run-id>` is the debug/inspection path for persisted runs, including optional parsed `report.md` metadata and artifact references.

## Development Commands

- `npm run dev`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
