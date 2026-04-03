# CLI Notes

`aiman` records one profile run at a time. A human or wrapper chooses which profile to run; `aiman` launches it, persists one canonical run record, and exposes that record through the default TUI or the `run` inspection commands.

Each run persists one canonical `run.md` file with YAML frontmatter plus a Markdown body. Prompt/log/artifact file paths are derived from the run directory, and `aiman run show`, `aiman run logs`, and `aiman run inspect` expose that persisted state directly.

Project-scoped commands resolve the nearest ancestor directory with project markers such as `.aiman`, `.agents`, or `.git`, so you can run `aiman` from a nested repo subdirectory without losing sight of the same project-scoped profiles and skills. The home-level user scope directories `~/.aiman` and `~/.agents` do not count as a project root by themselves, so user scope stays available even when you run `aiman` from somewhere under `$HOME`. Session commands now read the global run store in `~/.aiman`, so they work from any working directory.

## Current Commands

- `aiman`
- `aiman profile list [--scope project|user] [--json]`
- `aiman profile show <profile> [--scope project|user] [--json]`
- `aiman profile check <profile> [--scope project|user] [--json]`
- `aiman profile create <name> --scope project|user --provider codex|gemini --mode safe|yolo --model <id> --reasoning-effort <value> --description <text> [--instructions <text>] [--force] [--json]`
- `aiman skill list [--scope project|user] [--json]`
- `aiman skill show <skill> [--scope project|user] [--json]`
- `aiman skill check <skill> [--scope project|user] [--json]`
- `aiman run <profile> [--task <text>] [--cwd <path>] [--scope project|user] [--skill <name> ...] [--detach] [--json]`
- `aiman run list [--all] [--limit <n>] [--json]`
- `aiman run show <run-id> [--json]`
- `aiman run logs <run-id> [--stream all|stdout|stderr] [--tail <n>] [-f|--follow] [--json]`
- `aiman run inspect <run-id> [--json] [--stream run|prompt|stdout|stderr]`
- `aiman run stop <run-id> [--json]`

Profiles can exist in two scopes:

- project scope: `<repo>/.aiman/profiles/`
- user scope: `~/.aiman/profiles/`

Local `aiman` skills can also exist in two scopes:

- project scope: `<repo>/.aiman/skills/`
- user scope: `~/.aiman/skills/`

`aiman profile list`, `aiman profile show`, and `aiman run` consider both scopes by default and prefer the project profile when both scopes define the same name. `aiman profile list` collapses lower-priority duplicates so the default output matches the same precedence rule. `aiman profile create` requires an explicit `--scope`.

`aiman skill list` follows the same project-over-user precedence rule for local skills, so the default output shows the exact skill names a run would resolve first. Use `--scope` to inspect only project or only user skills.

The human TTY surface is now Bun/OpenTUI-based. `aiman` with no arguments opens the unified workbench, requires a real TTY, and keeps launch plus run monitoring in the same keyboard-first surface.

The workbench is intentionally split into two workspaces:

- `launch`: profile selection, profile details, and multiline task entry
- `runs`: active plus historic run browsing, detail tabs, stop, and task reuse

Default keyboard flow stays compact:

- `Tab` cycles focus between active regions
- `1` and `2` switch between `launch` and `runs`
- `Ctrl+L` launches the selected profile
- `Ctrl+R` refreshes runs
- `Ctrl+S` stops the selected active run
- `Ctrl+U` copies the selected run task back into `launch`

For `aiman profile create`, `--scope`, `--provider`, `--mode`, `--model`, `--reasoning-effort`, and `--description` are required. Instructions can come from `--instructions` or from stdin, which keeps multiline authoring scriptable and avoids hidden interactive prompts that could block parent agents.

`aiman profile check` is the public static profile validator. It reads one profile, reports blocking `errors` separately from non-blocking `warnings`, exits `1` only when blocking errors exist, and supports `--json` for wrappers or parent agents. It does not launch the provider, probe MCPs, or require auth.

For stronger authoring guidance, use `docs/agent-authoring.md` as the checklist for prompt shape and reliability before you finalize a profile.

Profile bodies are explicit prompt templates. `aiman` does not append a hidden footer at run time; instead it substitutes runtime values only where the body asks for them. New profiles created by `aiman profile create` include `{{task}}` by default, and runnable profiles should include that placeholder somewhere in the body.

Profile frontmatter must declare `mode: safe | yolo`. `aiman run` uses that declared mode as the profile's execution mode.

Profile frontmatter must also declare `reasoningEffort`, and the allowed values depend on the selected provider:

- `codex`: `none`, `low`, `medium`, or `high`
- `gemini`: `none`

Use `none` when the selected provider or model does not support configurable reasoning effort.

Profile frontmatter can also declare an optional YAML `skills:` list. `aiman profile create` does not scaffold or edit that field yet; add it manually when a profile depends on local `aiman` skills. `aiman run` resolves those names from `.aiman/skills/` or `~/.aiman/skills/`, attaches the selected skill bodies to the rendered prompt, and records the active skill names in the launch snapshot.

If the repo has an `AGENTS.md#Aiman Runtime Context` section, `aiman run` appends only that section as shared project context. This is the current public path for shared repo guidance. Keep it small and stable; keep specialist behavior in the profile body instead.

Profiles that declare `permissions`, `contextFiles`, or `requiredMcps` are invalid. Rewrite them to the strict current contract instead of trying to preserve those fields.

Provider isolation details:

- On Windows, Codex-backed runs add `allow_login_shell=false` and `shell_environment_policy.experimental_use_profile=false` so non-interactive runs do not inherit user PowerShell profile behavior.
- Codex-backed runs also add `project_doc_max_bytes=0`, `project_doc_fallback_filenames=[]`, `developer_instructions=""`, `instructions=""`, and `agents={}` so repo `AGENTS.md`, project Codex prompt-shaping instructions, and repo-defined Codex agent roles do not leak into authored `aiman` profiles beyond the explicit `AGENTS.md#Aiman Runtime Context` section, while project `.codex` MCP definitions still load.
- Gemini-backed runs also add a child-local settings overlay, passed only to the spawned Gemini process through `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, that forces Gemini `context.fileName` to an impossible filename. That keeps project context files such as `AGENTS.md` or `GEMINI.md` from leaking into authored `aiman` profiles beyond the explicit runtime-context section while project `.gemini/settings.json` MCP definitions still load.

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
- `aiman profile create <name>` is the authoring path for creating structured profile files without hand-writing raw frontmatter.
- `aiman profile show <profile>` and `aiman profile check <profile>` are the operator paths for inspecting one profile's contract before a run.
- `aiman skill list`, `aiman skill show`, and `aiman skill check` are the local-skill inspection paths.
- Authored profile bodies are the full prompt contract. `aiman` no longer appends hidden task/cwd/run-path footer text at execution time.
- `aiman run <profile>` is the default synchronous worker path. It runs in the foreground, persists the run, and returns the final result when complete.
- `aiman run <profile> --detach` is the explicit background path. It starts a managed worker and returns immediately with the live run id.
- `aiman run stop <id>` is the quick operator path for stopping one active run by run id without opening the interactive workbench, including Windows runs launched through npm-style `.cmd` wrappers.
- Detached workers execute from the launch snapshot already persisted in `run.md` and `prompt.md`, so later profile-file edits do not change an acknowledged run.
- `aiman sesh list` is the operator path for asking which sessions are active right now across all projects.
- `aiman sesh show <run-id>` is the compact human-facing per-session view.
- `aiman sesh logs <run-id>` is the output view, with `-f`/`--follow` for live streaming.
- `aiman sesh inspect <run-id>` is the detailed evidence view for persisted sessions, including the frozen launch snapshot and raw file access through `--stream`.
- `aiman sesh top` is removed. Agents, wrappers, and automations should use `aiman sesh list`, `aiman sesh show`, `aiman sesh logs`, and `aiman sesh inspect` instead of trying to drive the human TTY workbench.
- Human-readable command output is intentionally plain text and more polished than the JSON payloads, while `--json` remains the stable machine-facing contract for wrappers and parent tools.
- `aiman run` shows a small indeterminate activity bar on TTYs while a foreground run is active, then prints only the final answer on success; detailed status stays in `aiman sesh show`, `aiman sesh inspect`, and the interactive workbench.
- `aiman sesh list` defaults to active runs only so the common "what is alive now?" check does not rely on stale frontmatter.
- `aiman sesh inspect <run-id> --stream run` shows the canonical persisted `run.md` file.
- `aiman sesh inspect <run-id> --stream prompt` shows the exact prompt that was sent to the downstream provider.
- `aiman sesh inspect <run-id> --stream stdout|stderr` reads the default log files from that run directory.
- `aiman run <profile> --detach` prints a short launch summary to stderr so operators can see the run id, show command, and live logs command immediately.
- `aiman sesh show <run-id>` and `aiman sesh inspect <run-id>` both derive whether the run is still active from the stored supervising `pid` plus a fresh persisted heartbeat; when a run never reaches a terminal record they show a concise warning instead of inventing a new persisted state.
- `aiman profile show`, `aiman run`, `aiman sesh show`, and `aiman sesh inspect` surface run rights explicitly so operators can see whether the provider is in safe, yolo, read-only, write-enabled, or plan/no-edit mode.

## Run Layout

Each run lives under `~/.aiman/runs/<run-id>/`.

Default files:

- `run.md`: canonical persisted run record
- `prompt.md`: rendered prompt sent to the provider
- `stdout.log`: created only when stdout is produced
- `stderr.log`: created only when stderr is produced
- `artifacts/`: optional directory for run-authored handoff files

`run.md` stores structured execution fields such as `runId`, `status`, `profile`, `profileScope`, `profilePath`, `provider`, `launchMode`, `model`, `mode`, `projectRoot`, timestamps, exit state, and optional `usage`, plus any authored frontmatter like `kind`, `summary`, `artifacts`, or task-specific metadata.

`run.md` also stores a required immutable `launch` object. That launch snapshot freezes the resolved profile identity, provider invocation (`command`, `args`, `promptTransport`), cwd, timeout settings, allowlisted environment key names, and digests for the authored profile file and rendered prompt.
When a profile declares skills or the repo exposes `AGENTS.md#Aiman Runtime Context`, the same launch snapshot records the active skill names and the attached runtime-context path from that run.

`aiman` also keeps a SQLite run index at `~/.aiman/aiman.db`. `sesh list` and the other run lookup paths use that index to resolve global runs quickly; legacy project-local `.aiman/runs/` directories are not auto-imported in the current forward-only design.

For operator-facing reads, `aiman` also derives whether the run is still active from the stored `pid` plus a fresh persisted heartbeat:

- `active: true` means the supervising `aiman` process for that run still exists and the supervisor heartbeat is still fresh
- `active: false` means the run is either terminal or the supervising process is gone
- when `run.md` still records `status: running` but the pid is gone, `status` and `inspect` show a warning instead of adding a separate persisted stale state

## Input Notes

- `aiman run <profile>` accepts task input from `--task` or stdin, but not both.
- Runnable profile bodies should include `{{task}}`. If the body omits it, `aiman run` fails with a clear validation error instead of silently appending the task somewhere else.
- `aiman profile create <name>` uses `--instructions` immediately when provided; otherwise it reads instructions from stdin.
- A practical creation flow is: gather the contract, `aiman profile create`, `aiman profile show`, `aiman profile check`, then optionally run a small smoke task.
- `aiman run --detach --json` returns the detached launch payload immediately, while foreground `aiman run --json` waits and returns the completed result payload.
- The CLI no longer falls back to hidden interactive prompting during `create`; missing instructions fail fast with an actionable message instead of waiting on terminal input.

## Development Commands

- `bun run dev`
- `bun run test`
- `bun run test:provider-contract`
- `bun run typecheck`
- `bun run build`
- `bun run lint`

`bun run test:provider-contract` is the live provider smoke-test suite. It uses the real Codex and Gemini CLIs, skips explicitly when a CLI or auth is unavailable, and checks that ambient repo instruction files stay out while only `AGENTS.md#Aiman Runtime Context` appears.
