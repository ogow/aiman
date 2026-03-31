# CLI Notes

`aiman` records one specialist run at a time. A human or wrapper chooses which specialist to run; `aiman` launches it, persists one canonical run record, and exposes that record through the `sesh` inspection commands.

Each run persists one canonical `run.md` file with YAML frontmatter plus a Markdown body. Prompt/log/artifact file paths are derived from the run directory, and `aiman sesh show`, `aiman sesh logs`, and `aiman sesh inspect` expose that persisted state directly.

## Current Commands

- `aiman agent list [--json]`
- `aiman agent show <agent> [--json]`
- `aiman agent create <name> --scope project|user --provider codex|gemini [--permissions read-only|workspace-write] --model <id> --description <text> [--instructions <text>] [--reasoning-effort low|medium|high] [--force] [--json]`
- `aiman skill list [--scope project|user] [--json]`
- `aiman run <agent> [--task <text>] [--cwd <path>] [--mode read-only|workspace-write] [--detach] [--json]`
- `aiman sesh list [--all] [--limit <n>] [--json]`
- `aiman sesh show <run-id> [--json]`
- `aiman sesh logs <run-id> [--stream all|stdout|stderr] [--tail <n>] [-f|--follow] [--json]`
- `aiman sesh inspect <run-id> [--json] [--stream run|prompt|stdout|stderr]`
- `aiman sesh top [--filter active|historic|all]`

Agents can exist in two scopes:

- project scope: `<repo>/.aiman/agents/`
- user scope: `~/.aiman/agents/`

Skills can also exist in two scopes:

- project scope: `<repo>/.agents/skills/`
- user scope: `~/.agents/skills/`

`aiman agent list`, `aiman agent show`, and `aiman run` consider both scopes by default and prefer the project agent when both scopes define the same name. `aiman agent list` collapses lower-priority duplicates so the default output matches the same precedence rule. `aiman agent create` requires an explicit `--scope`.

`aiman skill list` follows the same project-over-user precedence rule for skills, so the default output shows the exact skill names an agent run would resolve first. Use `--scope` to inspect only project or only user skills.

For `aiman agent create`, `--scope`, `--provider`, `--model`, and `--description` are required. `--permissions` defaults to `read-only` and is written into the agent frontmatter. Instructions can come from `--instructions` or from stdin, which keeps multiline authoring scriptable and avoids hidden interactive prompts that could block parent agents.

Agent bodies are now explicit prompt templates. `aiman` does not append a hidden footer at run time; instead it substitutes runtime values only where the body asks for them. New agents created by `aiman agent create` include `{{task}}` by default, and runnable agents should include that placeholder somewhere in the body.

Agent frontmatter must now declare `permissions: read-only | workspace-write`. `aiman run` uses that declared permission as the agent's execution mode unless the caller passes `--mode`, and a conflicting `--mode` fails instead of silently widening or narrowing access.

Agent frontmatter can also declare an optional YAML `skills:` list. `aiman agent create` does not scaffold or edit that field yet; add it manually when an authored agent expects provider-native skills. `aiman run` checks declared skills against `<repo>/.agents/skills/<name>/SKILL.md` first and `~/.agents/skills/<name>/SKILL.md` second, then records the resolved skill metadata in the launch snapshot.

Agent frontmatter can also declare an optional YAML `requiredMcps:` list. `aiman run` checks those MCP names through the selected provider CLI before launch and fails fast when a required MCP is missing, disabled, or reported disconnected.

`--reasoning-effort` is a provider-specific option:

- Codex-backed agents map it to Codex CLI config as `model_reasoning_effort`.
- Gemini-backed agents do not support it and will fail validation at run time.

Execution rights depend on both provider and `--mode`:

- Codex `read-only`: `aiman` launches `codex exec --sandbox read-only`
- Codex `workspace-write`: `aiman` launches `codex exec --sandbox workspace-write`
- Gemini `read-only`: `aiman` launches `gemini --approval-mode plan`
- Gemini `workspace-write`: `aiman` launches `gemini --approval-mode auto_edit`

Across providers, `aiman` forwards only an allowlisted runtime environment rather than the full parent process environment.

## Command Structure

- Top-level commands live in `src/cmd/`.
- Command modules export `command`, `describe`, `builder`, and `handler` to match the `yargs` command-module pattern.
- `aiman agent create <name>` is the authoring path for creating structured agent files without hand-writing raw frontmatter.
- `aiman skill list` is the operator path for discovering available skill names and scopes before declaring them in agent frontmatter.
- `aiman agent show <agent>` is the quick operator path for checking the agent's declared permissions, required MCPs, provider behavior, supported run modes, and the rights the runtime will grant in each mode.
- Authored agent bodies are the full prompt contract. `aiman` no longer appends hidden task/cwd/run-path footer text at execution time.
- `aiman run <agent>` is the default synchronous worker path. It runs in the foreground, persists the run, and returns the final result when complete.
- `aiman run <agent> --detach` is the explicit background path. It starts a managed worker and returns immediately with the live run id.
- Detached workers execute from the launch snapshot already persisted in `run.md` and `prompt.md`, so later agent-file edits do not change an acknowledged run.
- `aiman sesh list` is the operator path for asking which sessions are active right now.
- `aiman sesh show <run-id>` is the compact human-facing per-session view.
- `aiman sesh logs <run-id>` is the output view, with `-f`/`--follow` for live streaming.
- `aiman sesh inspect <run-id>` is the detailed evidence view for persisted sessions, including the frozen launch snapshot and raw file access through `--stream`.
- `aiman sesh top` is the interactive session dashboard, defaults to `--filter active`, supports `--filter historic` and `--filter all`, and requires a real TTY.
- Human-readable command output is intentionally plain text and more polished than the JSON payloads, while `--json` remains the stable machine-facing contract for wrappers and parent tools.
- `aiman run` shows a small indeterminate activity bar on TTYs while a foreground run is active, then prints only the final answer on success; detailed status stays in `aiman sesh show` and `aiman sesh inspect`.
- `aiman sesh list` defaults to active runs only so the common "what is alive now?" check does not rely on stale frontmatter.
- `aiman sesh inspect <run-id> --stream run` shows the canonical persisted `run.md` file.
- `aiman sesh inspect <run-id> --stream prompt` shows the exact prompt that was sent to the downstream provider.
- `aiman sesh inspect <run-id> --stream stdout|stderr` reads the default log files from that run directory.
- `aiman run <agent> --detach` prints a short launch summary to stderr so operators can see the run id, show command, and live logs command immediately.
- `aiman sesh show <run-id>` and `aiman sesh inspect <run-id>` both derive whether the run is still active from the stored supervising `pid`; when a run never reaches a terminal record they show a concise warning instead of inventing a new persisted state.
- `aiman agent show`, `aiman run`, `aiman sesh show`, and `aiman sesh inspect` surface run rights explicitly so operators can see whether the provider is in read-only, write-enabled, or plan/no-edit mode.

## Run Layout

Each run lives under `.aiman/runs/<run-id>/`.

Default files:

- `run.md`: canonical persisted run record
- `prompt.md`: rendered prompt sent to the provider
- `stdout.log`: created only when stdout is produced
- `stderr.log`: created only when stderr is produced
- `artifacts/`: optional directory for agent-authored handoff files

`run.md` stores structured execution fields such as `runId`, `status`, `agent`, `agentScope`, `agentPath`, `provider`, `launchMode`, optional `model`, optional `reasoningEffort`, `mode`, timestamps, exit state, and optional `usage`, plus any authored frontmatter like `kind`, `summary`, `artifacts`, or task-specific metadata.

`run.md` also stores a required immutable `launch` object. That launch snapshot freezes the resolved agent identity, provider invocation (`command`, `args`, `promptTransport`), cwd, timeout settings, allowlisted environment key names, and digests for the authored agent file and rendered prompt.
When an agent declares skills, the same launch snapshot also records the resolved skill names, paths, scopes, and digests that were present at launch time.

For operator-facing reads, `aiman` also derives whether the run is still active from the stored `pid`:

- `active: true` means the supervising `aiman` process for that run still exists
- `active: false` means the run is either terminal or the supervising process is gone
- when `run.md` still records `status: running` but the pid is gone, `status` and `inspect` show a warning instead of adding a separate persisted stale state

## Input Notes

- `aiman run <agent>` accepts task input from `--task` or stdin, but not both.
- Runnable agent bodies should include `{{task}}`. If the body omits it, `aiman run` fails with a clear validation error instead of silently appending the task somewhere else.
- `aiman agent create <name>` uses `--instructions` immediately when provided; otherwise it reads instructions from stdin.
- `aiman run --detach --json` returns the detached launch payload immediately, while foreground `aiman run --json` waits and returns the completed result payload.
- The CLI no longer falls back to hidden interactive prompting during `create`; missing instructions fail fast with an actionable message instead of waiting on terminal input.

## Development Commands

- `npm run dev`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
