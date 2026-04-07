# Core Memory

## Project Truths

- `aiman` is a human-first TypeScript terminal app built on a small `yargs` CLI plus a default interactive TUI.
- `aiman` is a provider-neutral run workbench, not an orchestrator or workflow engine.
- The public product model is `agents`, `runs`, and shared repo bootstrap context configured through `aiman`.
- `aiman` now ships an importable package API through `createAiman()`, and the repo's own CLI commands consume that same facade instead of reaching directly into internal modules.
- The public CLI is grouped by concern: `agent`, `run`, and `runs`.
- `aiman` with no arguments opens the interactive workbench and requires a real TTY.
- Built-in agents `build` and `plan` are always available.
- Agents live in project scope under `<repo>/.aiman/agents/` and user scope under `~/.aiman/agents/`.
- Repo context is now native-provider-first: `aiman` configures shared bootstrap context file names for the repo, and Codex/Gemini discover those files natively instead of `aiman` injecting a managed runtime-context section into prompts.
- `aiman` does not have its own skill catalog or prompt-time skill injection, but it provides a `bun run skills` wrapper for the `skills` tool to install skills into the correct project or user directories.
- Codex and Gemini are execution backends only; `aiman` decides shared bootstrap context configuration and visible run metadata before launch.
- `aiman` no longer models separate `safe` / `yolo` harness modes; both providers launch through one write-enabled contract and agent behavior differences belong in the authored prompt body.
- Run persistence remains global under `~/.aiman/runs/`, indexed by `~/.aiman/aiman.db`.
- Persisted launch snapshots now record agent identity, configured native context file names, and the original task text.
- TypeScript edits should follow `docs/typescript-style.md`, which adapts the Google TypeScript Style Guide to this repo.
- Verification runs through `bun test`; most suites still use Node-compatible `node:test` APIs, and the TUI layer now also includes OpenTUI React interaction tests.
- The repo keeps durable agent memory in root-level files plus `.agents/memories/`.
- Project-scoped `aiman` commands resolve the nearest ancestor project root that contains repo markers such as `.aiman`, `.agents`, or `.git`, but `$HOME` itself must never become the project root just because it contains user-scope folders or its own `.git` checkout.
- New runs persist one canonical `run.md` with YAML frontmatter plus a Markdown body; prompt, log, and artifact files are optional run-side details that can be inspected when present.
- Each persisted run now includes an immutable `launch` snapshot inside `run.md` so `inspect` and detached workers can trust the frozen launch evidence without re-reading mutable agent files.
- Authored agent bodies own the task-specific prompt shape; `aiman` only substitutes explicit runtime placeholders such as `{{task}}`, `{{cwd}}`, `{{runId}}`, `{{runFile}}`, and `{{artifactsDir}}`.
- Authored agents must declare `provider`, `model`, `description`, `reasoningEffort` (optional for Gemini), and a Markdown body containing `{{task}}`.
- `reasoningEffort` is provider-specific: Codex requires `none|low|medium|high`, while Gemini defaults to `none` if omitted.
- `aiman run` is foreground-first: it runs a worker inline by default and returns the final result when complete, while `--detach` is the explicit background mode.
- Each persisted run now records `launchMode: foreground | detached`, and operator-facing views surface that mode instead of assuming every live run came from the same path.
- Detached runs execute from snapshotted launch metadata persisted in `run.md` plus `prompt.md`; hidden workers should not re-read mutable agent files after `run --detach` returns.
- Run/session state is now global: `aiman` stores run directories under `~/.aiman/runs/`, indexes them in `~/.aiman/aiman.db`, and records each run's `projectRoot` so `runs list`, `runs show`, `runs logs`, `runs inspect`, and the default workbench work from any working directory without scanning per-project `.aiman/runs/`.
- Windows provider launches still resolve logical commands like `codex` and `gemini` through `PATH`/`PATHEXT`, but `.cmd` and `.bat` shims must be re-launched through an escaped `cmd.exe /d /s /c` command line so prompt arguments survive Windows metacharacters instead of relying on `shell: true`.
- Windows MCP-preflight helpers must also tear down the full wrapped provider process tree on timeout, not just the outer `cmd.exe`, so repeated validation does not leak orphaned background CLI processes.
- Windows Codex runs also pin `allow_login_shell=false` and `shell_environment_policy.experimental_use_profile=false` so non-interactive provider-side PowerShell commands do not depend on loading the user's shell profile.
- Unix provider runs should launch in their own process group so timeout and stop handling can terminate the full provider subtree, including MCP helper descendants that inherit stdio pipes.
- `aiman` now supports layered config through `~/.aiman/config.json` plus optional `<repo>/.aiman/config.json`, with project config overriding home config.
- The public layered config is intentionally narrow: it can configure shared repo bootstrap context file names through `contextFileNames`, and otherwise `aiman` leaves bootstrap file selection to the downstream provider's native behavior.
- The `createAiman()` package API is now asynchronous to support configuration loading during initialization.
- When `contextFileNames` is configured, all agents in one repo share that same native bootstrap file list; agents do not override those file names individually.
- Codex-backed `aiman` runs should keep project-scoped provider config available for things like MCP registration, preserve native `AGENTS.md` loading, pass additional configured bootstrap file names through `project_doc_fallback_filenames`, blank other Codex prompt-shaping inputs such as `developer_instructions`, `instructions`, and `agents`, request JSONL event output on stdout via `--json`, pin `approval_policy="never"` for deterministic `codex exec` automation, and always grant the external run `artifacts/` directory as an explicit writable root via `--add-dir`.
- Gemini-backed `aiman` runs should keep the project workspace and project settings available for MCP registration, preserve native context discovery by passing the shared configured file names through a child-local `GEMINI_CLI_SYSTEM_SETTINGS_PATH` overlay, always run headless launches with `--approval-mode yolo`, add the per-run `artifacts/` directory to Gemini's workspace via `--include-directories`, send the authored prompt on stdin with `--prompt ""`, and request `--output-format json` so final parsing uses Gemini's structured `response` and `error` fields instead of raw stdout text.
- `bun run test:provider-contract` is the live provider smoke-test suite; it uses the real Codex and Gemini CLIs to verify that configured bootstrap context files are visible natively while non-configured context files stay out.
- Operator-facing run liveness is derived from both the persisted supervising `aiman` process `pid` and a fresh supervisor heartbeat in `run.md`; `runs list` only treats runs as active when both signals are current, while `runs show`/`runs inspect` warn when a run never reached a terminal record.
- Active runs can be stopped through `aiman runs stop <run-id>` or the default interactive workbench; both write a persisted `.stop-requested` marker that the supervising worker polls so stop behavior works cross-platform, including PowerShell/Windows and `.cmd`-wrapped provider process trees.
- Human TTY surfaces now use Bun + OpenTUI React under `src/tui/`; `aiman` with no args remains the only interactive TTY entrypoint, and `aiman runs top` is removed.
- The default interactive workbench now uses four workspaces: `start`, `agents`, `tasks`, and `runs`.
- The OpenTUI workbench stays keyboard-first: `s/a/t/r` switch workspaces, `Enter` drills into the active pane, `Escape` backs out, `Ctrl+L` launches, `Ctrl+R` refreshes runs, and `Ctrl+S` stops the selected active run.
- The `tasks` workspace now uses a controlled keyboard-first draft buffer instead of delegating task entry to an OpenTUI textarea, so launches and tests do not depend on hidden renderer focus state.
- Operator-facing surfaces should make provider rights explicit through the actual launch contract rather than deprecated harness mode labels.
- Human TTY surfaces may show an indeterminate activity indicator for active runs, but `aiman` does not pretend to know true percent-complete progress.
- The global run index must work under both Node and Bun: prefer `node:sqlite` when available, but fall back to `bun:sqlite` so the Bun-native CLI can still record and inspect runs.
- Foreground human `aiman run` output should stay caller-friendly: print the final answer on success when one exists, stay quiet on successful empty output, and leave verbose status/log detail to `runs show`, `runs logs`, and `runs inspect`.
- Removed the confusing prompt reuse functionality and its associated `Ctrl+U` shortcut from the workbench.
- Improved the `Escape` key behavior to always clear the active notice/error banner.
- Updated documentation and tests to reflect the removal of prompt reuse.
- Prefer explicit failure over degraded fallback behavior in the current harness: operator surfaces should either work under their stated requirements or fail clearly, and provider success parsing should require the expected persisted artifacts.
- `src/lib/run-doc.ts` uses `gray-matter` for the run document instead of a custom YAML/frontmatter parser.
- This repo is currently forward-only during active development; do not preserve backward compatibility unless the user explicitly asks for it.

## Agent Operating Model

- Read `AGENTS.md` first.
- Read `MEMORY.md` second.
- When resuming or selecting work, read the latest `.agents/memories/YYYY-MM-DD.md`.
- Work on exactly one task at a time.
- Before starting substantial work from a larger plan, split that plan into smaller concrete tasks in the daily memory file.
- Finish the current task before starting another.
- After finishing a task, continue to the next unchecked task automatically when it is safe to do so.
- Do not ask the user for permission to continue to the next task unless a real blocker, ambiguity, dependency, or tradeoff requires input.
- Update the daily memory file after each meaningful action and each important decision.
- After meaningful actions and important architecture, code, or logic decisions, run the repo memory-maintenance skill and update docs when needed.
- Keep daily memory concise and high-signal; do not turn it into a transcript.

## Task Writing Rules

- Each task must describe one concrete outcome.
- Each task must be specific enough that an agent can start without guessing.
- Mention the target area when the task depends on a particular file, module, or behavior.
- Avoid vague tasks such as "improve memory" or "work on CLI."
- Keep tasks small enough for one focused work pass.
- If a user-approved plan is larger than one focused work pass, break it into several smaller checkbox tasks in the daily memory before implementation begins.

## Daily Memory

- Daily memory lives in `.agents/memories/YYYY-MM-DD.md`.
- The daily file is the working source of truth for current tasks, recent progress, and short-lived decisions.
- Promote information into `MEMORY.md` only when it is stable and likely to matter across many future sessions.
