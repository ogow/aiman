# CLI Notes

`aiman` records one agent run at a time. A human or wrapper chooses which agent to run; `aiman` launches it, persists one canonical run record, and exposes that record through the default TUI or the `run` inspection commands.

Each run persists one canonical `run.md` file with YAML frontmatter plus a Markdown body. Prompt/log/artifact file paths are derived from the run directory, and `aiman runs show`, `aiman runs logs`, and `aiman runs inspect` expose that persisted state directly.

Project-scoped commands resolve the nearest ancestor directory with project markers such as `.aiman`, `.agents`, or `.git`, so you can run `aiman` from a nested repo subdirectory without losing sight of the same project-scoped agents. The home-level user scope directories `~/.aiman` and `~/.agents` do not count as a project root by themselves, so user scope stays available even when you run `aiman` from somewhere under `$HOME`. Run management commands now read the global run store in `~/.aiman`, so they work from any working directory.

## Current Commands

- `aiman`
- `aiman agent list [--scope project|user] [--json]`
- `aiman agent show <agent> [--scope project|user] [--json]`
- `aiman agent check <agent> [--scope project|user] [--json]`
- `aiman agent create <name> --scope project|user --provider codex|gemini --mode safe|yolo --model <id|auto> --reasoning-effort <value> --description <text> [--instructions <text>] [--force] [--json]`
- `aiman run <agent> [--task <text>] [--cwd <path>] [--scope project|user] [--detach] [--json]`
- `aiman runs list [--all] [--limit <n>] [--json]`
- `aiman runs show <run-id> [--json]`
- `aiman runs logs <run-id> [--stream all|stdout|stderr] [--tail <n>] [-f|--follow] [--json]`
- `aiman runs inspect <run-id> [--json] [--stream run|prompt|stdout|stderr]`
- `aiman runs stop <run-id> [--json]`

Agents can exist in two scopes:

- project scope: `<repo>/.aiman/agents/`
- user scope: `~/.aiman/agents/`

`aiman agent list`, `aiman agent show`, and `aiman run` consider both scopes by default and prefer the project agent when both scopes define the same name. `aiman agent list` collapses lower-priority duplicates so the default output matches the same precedence rule. `aiman agent create` requires an explicit `--scope`.

The human TTY surface is now Bun/OpenTUI-based. `aiman` with no arguments opens the unified workbench, requires a real TTY, and keeps launch plus run monitoring in the same keyboard-first surface.

The workbench is intentionally split into four workspaces:

- `start`: the landing page and global status
- `agents`: agent browsing and agent details
- `tasks`: agent selection plus multiline task entry
- `runs`: active plus historic run browsing, detail tabs, and stop

Default keyboard flow stays compact:

- `s`, `a`, `t`, and `r` switch workspaces
- `Enter` drills into the active list pane
- `Escape` backs out and clears the active notice
- `Ctrl+L` launches the selected agent
- `Ctrl+R` refreshes runs
- `Ctrl+S` stops the selected active run

The `tasks` workspace now uses a controlled task draft buffer instead of relying on an embedded textarea component for launch-critical input, so task entry stays deterministic under both the live TTY and the OpenTUI test harness.

For `aiman agent create`, `--scope`, `--provider`, `--mode`, `--model`, `--reasoning-effort`, and `--description` are required. For Gemini agents, `--model auto` means "let the `gemini` CLI choose its automatic default model." `auto` is invalid for non-Gemini providers. Instructions can come from `--instructions` or from stdin, which keeps multiline authoring scriptable and avoids hidden interactive prompts that could block parent agents.

`aiman agent check` is the public static agent validator. It reads one agent, reports blocking `errors` separately from non-blocking `warnings`, exits `1` only when blocking errors exist, and supports `--json` for wrappers or parent agents. It does not launch the provider, probe MCPs, or require auth.

For stronger authoring guidance, use `docs/agent-authoring.md` as the checklist for prompt shape and reliability before you finalize an agent.

Agent bodies are explicit prompt templates. `aiman` does not append a hidden footer at run time; instead it substitutes runtime values only where the body asks for them. New agents created by `aiman agent create` include `{{task}}` by default, and runnable agents should include that placeholder somewhere in the body.

Agent frontmatter must declare `mode: safe | yolo`. `aiman run` uses that declared mode as the agent's execution mode.

Agent frontmatter must also declare `reasoningEffort`, and the allowed values depend on the selected provider:

- `codex`: `none`, `low`, `medium`, or `high`
- `gemini`: `none`

Use `none` when the selected provider or model does not support configurable reasoning effort.

Agent frontmatter handles `model` differently by provider:

- `codex`: `model` is required and must name an explicit model
- `gemini`: `model` is required; use an explicit model id or `model: auto` to let Gemini choose automatically

Repo bootstrap context is configured at the harness level instead of per agent. `aiman` reads layered config from `~/.aiman/config.json` and optional `<repo>/.aiman/config.json`, with project config winning. The only public setting today is `contextFileNames`, for example:

```json
{
   "contextFileNames": ["AGENTS.md", "CONTEXT.md"]
}
```

When `contextFileNames` is configured, all agents in the same repo use that same ordered file list. Agents do not override it individually. `aiman` passes those file names through the downstream provider's native context-discovery settings and records the effective list in the launch snapshot. When it is not configured, `aiman` leaves bootstrap file selection to the downstream provider's native behavior.

Agents that declare `permissions`, `contextFiles`, `skills`, or `requiredMcps` are invalid. Rewrite them to the strict current contract instead of trying to preserve those fields.

Provider isolation details:

- On Windows, Codex-backed runs add `allow_login_shell=false` and `shell_environment_policy.experimental_use_profile=false` so non-interactive runs do not inherit user PowerShell profile behavior.
- Codex-backed runs preserve native `AGENTS.md` handling, pass any additional configured bootstrap file names through `project_doc_fallback_filenames`, and still blank other Codex prompt-shaping inputs such as `developer_instructions`, `instructions`, and `agents`, while project `.codex` MCP definitions still load.
- Gemini-backed runs preserve native context discovery by passing the shared configured file names through a child-local settings overlay via `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, while project `.gemini/settings.json` MCP definitions still load.

Execution rights depend on both provider and `--mode`:

- Codex `read-only`: `aiman` launches `codex exec --sandbox read-only`
- Codex `workspace-write`: `aiman` launches `codex exec --sandbox workspace-write`
- Gemini `read-only`: `aiman` launches `gemini --approval-mode plan`
- Gemini `workspace-write`: `aiman` launches `gemini --approval-mode auto_edit`

Across providers, `aiman` forwards only an allowlisted runtime environment rather than the full parent process environment.

## Command Structure

- Top-level commands live in `src/cmd/`.
- Command modules export `command`, `describe`, `builder`, and `handler` to match the `yargs` command-module pattern.
- `aiman` with no args is the default OpenTUI workbench for humans working in a real TTY.
- `aiman agent create <name>` is the authoring path for creating structured agent files without hand-writing raw frontmatter.
- `aiman agent show <agent>` and `aiman agent check <agent>` are the operator paths for inspecting one agent's contract before a run.
- Authored agent bodies are the full prompt contract. `aiman` no longer appends hidden task/cwd/run-path footer text at execution time.
- `aiman run <agent>` is the default synchronous worker path. It runs in the foreground, persists the run, and returns the final result when complete.
- `aiman run <agent> --detach` is the explicit background path. It starts a managed worker and returns immediately with the live run id.
- `aiman runs stop <id>` is the quick operator path for stopping one active run by run id without opening the interactive workbench, including Windows runs launched through npm-style `.cmd` wrappers.
- Detached workers execute from the launch snapshot already persisted in `run.md` and `prompt.md`, so later agent-file edits do not change an acknowledged run.
- `aiman runs list` is the operator path for asking which sessions are active right now across all projects.
- `aiman runs show <run-id>` is the compact human-facing per-session view.
- `aiman runs logs <run-id>` is the output view, with `-f`/`--follow` for live streaming.
- `aiman runs inspect <run-id>` is the detailed evidence view for persisted sessions, including the frozen launch snapshot and raw file access through `--stream`.
- Legacy `aiman sesh ...` commands are removed. Agents, wrappers, and automations should use `aiman runs list`, `aiman runs show`, `aiman runs logs`, and `aiman runs inspect` instead of trying to drive the human TTY workbench.
- Human-readable command output is intentionally plain text and more polished than the JSON payloads, while `--json` remains the stable machine-facing contract for wrappers and parent tools.
- `aiman run` shows a small indeterminate activity bar on TTYs while a foreground run is active, then prints only the final answer on success; detailed status stays in `aiman runs show`, `aiman runs inspect`, and the interactive workbench.
- `aiman runs list` defaults to active runs only so the common "what is alive now?" check does not rely on stale frontmatter.
- `aiman runs inspect <run-id> --stream run` shows the canonical persisted `run.md` file.
- `aiman runs inspect <run-id> --stream prompt` shows the exact prompt that was sent to the downstream provider.
- `aiman runs inspect <run-id> --stream stdout|stderr` reads the default log files from that run directory.
- `aiman runs logs <run-id>` and `aiman runs inspect <run-id> --stream stdout` show raw provider stdout; for Codex runs that means JSONL events, and for Gemini runs that means the final structured JSON object from `--output-format json`.
- `aiman run <agent> --detach` prints a short launch summary to stderr so operators can see the run id, show command, and live logs command immediately.
- `aiman runs show <run-id>` and `aiman runs inspect <run-id>` both derive whether the run is still active from the stored supervising `pid` plus a fresh persisted heartbeat; when a run never reaches a terminal record they show a concise warning instead of inventing a new persisted state.
- `aiman agent show`, `aiman run`, `aiman runs show`, and `aiman runs inspect` surface run rights explicitly so operators can see whether the provider is in safe, yolo, read-only, write-enabled, or plan/no-edit mode.

## Run Layout

Each run lives under `~/.aiman/runs/<run-id>/`.

Default files:

- `run.md`: canonical persisted run record
- `prompt.md`: rendered prompt sent to the provider
- `stdout.log`: created only when stdout is produced
- `stderr.log`: created only when stderr is produced
- `artifacts/`: optional directory for run-authored handoff files

`run.md` stores structured execution fields such as `runId`, `status`, `agent`, `agentScope`, `agentPath`, `provider`, `launchMode`, `model`, `mode`, `projectRoot`, timestamps, exit state, and optional `usage`, plus any authored frontmatter like `kind`, `summary`, `artifacts`, or task-specific metadata.

`run.md` also stores a required immutable `launch` object. That launch snapshot freezes the resolved agent identity, provider invocation (`command`, `args`, `promptTransport`), cwd, timeout settings, allowlisted environment key names, and digests for the authored agent file and rendered prompt.
When the repo config defines bootstrap context files, the launch snapshot records the effective `contextFileNames` used for that run.

`aiman` also keeps a SQLite run index at `~/.aiman/aiman.db`. `runs list` and the other run lookup paths use that index to resolve global runs quickly; legacy project-local `.aiman/runs/` directories are not auto-imported in the current forward-only design.

For operator-facing reads, `aiman` also derives whether the run is still active from the stored `pid` plus a fresh persisted heartbeat:

- `active: true` means the supervising `aiman` process for that run still exists and the supervisor heartbeat is still fresh
- `active: false` means the run is either terminal or the supervising process is gone
- when `run.md` still records `status: running` but the pid is gone, `runs show` and `runs inspect` show a warning instead of adding a separate persisted stale state

## Input Notes

- `aiman run <agent>` accepts task input from `--task` or stdin, but not both.
- Runnable agent bodies should include `{{task}}`. If the body omits it, `aiman run` fails with a clear validation error instead of silently appending the task somewhere else.
- `aiman agent create <name>` uses `--instructions` immediately when provided; otherwise it reads instructions from stdin.
- A practical creation flow is: gather the contract, `aiman agent create`, `aiman agent show`, `aiman agent check`, then optionally run a small smoke task.
- `aiman run --detach --json` returns the detached launch payload immediately, while foreground `aiman run --json` waits and returns the completed result payload.
- The CLI no longer falls back to hidden interactive prompting during `create`; missing instructions fail fast with an actionable message instead of waiting on terminal input.

## Development Commands

- `bun run dev`
- `bun run test`
- `bun run test:provider-contract`
- `bun run typecheck`
- `bun run build`
- `bun run lint`

`bun run test:provider-contract` is the live provider smoke-test suite. It uses the real Codex and Gemini CLIs, skips explicitly when a CLI or auth is unavailable, and checks that configured bootstrap context files appear natively while non-configured files stay out.
