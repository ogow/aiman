# CLI Notes

`aiman` is intended to be called by an external parent agent or operator who chooses which specialist to run. The CLI itself manages specialists and persisted runs; it does not act as the top-level orchestrator.

Each run persists one canonical `run.md` file with YAML frontmatter plus a Markdown body. Prompt/log/artifact file paths are derived from the run directory, and `aiman inspect` exposes those files directly.

## Current Commands

- `aiman list [--json]`
- `aiman create <name> --scope project|user --provider codex|gemini --model <id> --description <text> [--instructions <text>] [--reasoning-effort low|medium|high] [--force] [--json]`
- `aiman show <agent> [--json]`
- `aiman run <agent> [--task <text>] [--cwd <path>] [--mode read-only|workspace-write] [--json]`
- `aiman inspect <run-id> [--json] [--stream run|prompt|stdout|stderr]`

Agents can exist in two scopes:

- project scope: `<repo>/.aiman/agents/`
- user scope: `~/.aiman/agents/`

`aiman list`, `aiman show`, and `aiman run` consider both scopes by default and prefer the project agent when both scopes define the same name. `aiman list` collapses lower-priority duplicates so the default output matches the same precedence rule. `aiman create` requires an explicit `--scope`.

For `aiman create`, both `--provider` and `--model` are required. That keeps routing explicit and avoids hidden inference when authoring new agents.

`--reasoning-effort` is a provider-specific option:

- Codex-backed agents map it to Codex CLI config as `model_reasoning_effort`.
- Gemini-backed agents do not support it and will fail validation at run time.

## Command Structure

- Top-level commands live in `src/cmd/`.
- Command modules export `command`, `describe`, `builder`, and `handler` to match the `yargs` command-module pattern.
- `aiman create <name>` is the authoring path for creating structured agent files without hand-writing raw frontmatter.
- `aiman run <agent>` is the primary execution path.
- `aiman inspect <run-id>` is the debug/inspection path for persisted runs, including a human summary by default plus parsed `run.md` metadata and artifact references.
- `aiman inspect <run-id> --stream run` shows the canonical persisted `run.md` file.
- `aiman inspect <run-id> --stream prompt` shows the exact prompt that was sent to the downstream provider.
- `aiman inspect <run-id> --stream stdout|stderr` reads the default log files from that run directory.

## Run Layout

Each run lives under `.aiman/runs/<run-id>/`.

Default files:

- `run.md`: canonical persisted run record
- `prompt.md`: rendered prompt sent to the provider
- `stdout.log`: created only when stdout is produced
- `stderr.log`: created only when stderr is produced
- `artifacts/`: optional directory for agent-authored handoff files

`run.md` stores structured execution fields such as `runId`, `status`, `agent`, `agentScope`, `agentPath`, `provider`, `mode`, timestamps, exit state, and optional `usage`, plus any authored frontmatter like `kind`, `summary`, `artifacts`, or task-specific metadata.

## Development Commands

- `npm run dev`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
