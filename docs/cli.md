# CLI Notes

`aiman` is intended to be called by an external parent agent or operator who chooses which specialist to run. The CLI itself manages specialists and persisted runs; it does not act as the top-level orchestrator.

Each run persists one canonical `run.md` file with YAML frontmatter plus a Markdown body. `aiman` surfaces the parsed metadata and referenced artifacts through `aiman inspect`, but it does not own task queues or memory.

## Current Commands

- `aiman list [--json]`
- `aiman show <agent> [--json]`
- `aiman run <agent> [--task <text>] [--cwd <path>] [--mode read-only|workspace-write] [--json]`
- `aiman inspect <run-id> [--json] [--stream run|prompt|stdout|stderr]`

## Command Structure

- Top-level commands live in `src/cmd/`.
- Command modules export `command`, `describe`, `builder`, and `handler` to match the `yargs` command-module pattern.
- `aiman run <agent>` is the primary execution path.
- `aiman inspect <run-id>` is the debug/inspection path for persisted runs, including a human summary by default plus parsed `run.md` metadata and artifact references.
- `aiman inspect <run-id> --stream run` shows the canonical persisted `run.md` file.
- `aiman inspect <run-id> --stream prompt` shows the exact prompt that was sent to the downstream provider.

## Development Commands

- `npm run dev`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
