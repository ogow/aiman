# Core Memory

## Project Truths

- `aiman` is a human-first terminal workbench and agent runtime engine.
- A project-specific "Harness" should wrap agent execution with custom context and validation logic.
- Built-in agents `build` and `plan` are always available.
- Agents live in project scope under `<repo>/.aiman/agents/` and user scope under `~/.aiman/agents/`.
- Repo context is now native-provider-first: `aiman` configures shared bootstrap context file names for the repo, and Codex/Gemini discover those files natively instead of `aiman` injecting a managed runtime-context section into prompts.
- `aiman` does not have its own skill catalog or prompt-time skill injection, but it provides a `bun run skills` wrapper for the `skills` tool to install skills into the correct project or user directories.
- This repo now ships a dedicated `.agents/skills/agent-hardening/` skill for creating and repairing authored `aiman` agents with the existing `agent check`, smoke-run, and run-inspection workflow instead of adding new verification subcommands.
- Codex and Gemini are execution backends only; `aiman` decides shared bootstrap context configuration and visible run metadata before launch.
- `aiman` no longer models separate `safe` / `yolo` harness modes; both providers launch through one write-enabled contract and agent behavior differences belong in the authored prompt body.
- Run persistence is global and file-first under `~/.aiman/runs/<YYYY-MM-DD>/<timestamp-run-id>/`.
- Persisted launch snapshots now record agent identity, configured native context file names, and the original task text.
- TypeScript edits should follow `docs/typescript-style.md`, which adapts the Google TypeScript Style Guide to this repo.
- Verification runs through `bun test`; most suites still use Node-compatible `node:test` APIs, and the TUI layer now also includes OpenTUI React interaction tests.
- The repo keeps durable agent memory in root-level files plus `.agents/memories/`.
- Project-scoped `aiman` commands resolve the nearest ancestor project root that contains repo markers such as `.aiman`, `.agents`, or `.git`, but `$HOME` itself must never become the project root just because it contains user-scope folders or its own `.git` checkout.
- New runs persist one canonical `run.json`; stdout/stderr logs and `artifacts/` are optional supporting files in the same run directory.
- Each persisted run includes an immutable `launch` snapshot inside `run.json` so `inspect` and detached workers can trust the frozen launch evidence without re-reading mutable agent files.
- Authored agent bodies own the task-specific prompt shape; `aiman` only substitutes explicit runtime placeholders such as `{{task}}`, `{{cwd}}`, `{{runId}}`, `{{runFile}}`, and `{{artifactsDir}}`.
- Authored agents now declare a `resultMode`; `text` is the default path, while `schema` explicitly opts into runtime-enforced JSON validation.
- For `resultMode: "schema"`, `aiman` appends a small runtime JSON contract that requires `summary`, `outcome`, and `result`; legacy `next` payloads remain runtime-compatible but are no longer part of the default public authoring contract.
- Gemini schema-mode runs now tolerate prose-heavy assistant output by extracting the last valid top-level JSON object from the provider response before schema validation, while still preserving explicit provider error payloads.
- Authored agents may still declare an optional informational `capabilities` list for operator visibility, but the normal public authoring path no longer teaches or scaffolds it.
- Authored agents may also declare an optional `timeoutMs`; omit it to use the runtime default, or set `0` to disable the timeout for that agent.
- The default authored-agent path is now provider-explicit but low-friction: `provider` and `description` are the main required choices, while omitted `model` and `reasoningEffort` resolve through provider defaults (`gpt-5.4-mini`/`medium` for Codex, `auto`/`none` for Gemini).
- `aiman agent create` is now interactive-first and generates a minimal scaffold around `Role`, `Task Input`, `Instructions`, `Stop Conditions`, and `Expected Output`.
- `aiman run` is foreground-first: it runs a worker inline by default and returns the final result when complete, while `--detach` is the explicit background mode.
- Run supervision uses a 5 minute default timeout unless a run override or authored agent `timeoutMs` says otherwise; `timeoutMs: 0` means no timeout.
- Each persisted run now records `launchMode: foreground | detached`, and operator-facing views surface that mode instead of assuming every live run came from the same path.
- Detached runs execute from snapshotted launch metadata persisted in `run.json`; hidden workers should not re-read mutable agent files after `run --detach` returns.
- Run/session state is now global and filesystem-scanned: `aiman` stores run directories under `~/.aiman/runs/` and resolves them directly from disk without SQLite.
- Windows provider launches still resolve logical commands like `codex` and `gemini` through `PATH`/`PATHEXT`, but `.cmd` and `.bat` shims must be re-launched through an escaped `cmd.exe /d /s /c` command line so prompt arguments survive Windows metacharacters instead of relying on `shell: true`.
- Windows MCP-preflight helpers must also tear down the full wrapped provider process tree on timeout, not just the outer `cmd.exe`, so repeated validation does not leak orphaned background CLI processes.
- Windows Codex runs also pin `allow_login_shell=false` and `shell_environment_policy.experimental_use_profile=false` so non-interactive provider-side PowerShell commands do not depend on loading the user's shell profile.
- Unix provider runs should launch in their own process group so timeout and stop handling can terminate the full provider subtree, including MCP helper descendants that inherit stdio pipes.
- `aiman` now supports layered config through `~/.aiman/config.json` plus optional `<repo>/.aiman/config.json`, with project config overriding home config.
- The public layered config is intentionally narrow: it can configure shared repo bootstrap context file names through `contextFileNames`, and otherwise `aiman` leaves bootstrap file selection to the downstream provider's native behavior.
- The `createAiman()` package API is now asynchronous to support configuration loading during initialization.
- When `contextFileNames` is configured, all agents in one repo share that same native bootstrap file list; agents do not override those file names individually.
- Codex-backed `aiman` runs should keep project-scoped provider config available for things like MCP registration, preserve native `AGENTS.md` loading, pass additional configured bootstrap file names through `project_doc_fallback_filenames`, blank other Codex prompt-shaping inputs such as `developer_instructions`, `instructions`, and `agents`, request JSONL event output on stdout via `--json`, pin `approval_policy="never"` for deterministic `codex exec` automation, and always grant the external run `artifacts/` directory as an explicit writable root via `--add-dir`.
- Codex and Gemini provider launches now also export `PLAYWRIGHT_MCP_OUTPUT_DIR` pointing at the current run `artifacts/` directory so Playwright-based browser helpers can write run outputs there without disabling Playwright's own file-root checks; `PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS` is allowlisted for explicit operator overrides but is not enabled by default.
- Codex instruction discovery is one-file-per-directory: in each directory it checks `AGENTS.override.md`, then `AGENTS.md`, then configured fallback names, so fallback files only apply where `AGENTS.md` is absent at that directory level.
- Gemini-backed `aiman` runs should keep the project workspace and project settings available for MCP registration, preserve native context discovery by passing the shared configured file names through a child-local `GEMINI_CLI_SYSTEM_SETTINGS_PATH` overlay, always run headless launches with `--approval-mode yolo`, add the per-run `artifacts/` directory to Gemini's workspace via `--include-directories`, send the authored prompt on stdin with `--prompt ""`, and request `--output-format json` so final parsing uses Gemini's structured `response` and `error` fields instead of raw stdout text.
- `bun run test:provider-contract` is the live provider smoke-test suite; it uses the real Codex and Gemini CLIs to verify that configured bootstrap context files are visible natively while non-configured context files stay out.
- `bun run test:config-smoke` is the live non-unit config harness; it runs a real authored agent through `createAiman()` and verifies layered config loading, persisted launch metadata, provider wiring, and native bootstrap-context visibility.
- Operator-facing run liveness is derived from both the persisted supervising `aiman` process `pid` and a fresh supervisor heartbeat in `run.json`; `runs list` only treats runs as active when both signals are current, while `runs show`/`runs inspect` warn when a run never reached a terminal record.
- Active runs can be stopped through `aiman runs stop <run-id>` or the default interactive workbench; both write a persisted `.stop-requested` marker that the supervising worker polls so stop behavior works cross-platform, including PowerShell/Windows and `.cmd`-wrapped provider process trees.
- Human TTY surfaces now use Bun + OpenTUI React under `src/tui/`; `aiman` with no args remains the only interactive TTY entrypoint, and `aiman runs top` is removed.
- The default interactive workbench now uses four workspaces: `start`, `agents`, `tasks`, and `runs`.
- The OpenTUI workbench stays keyboard-first: `s/a/t/r` switch workspaces, `Enter` drills into the active pane, `Escape` backs out, `Ctrl+L` launches, `Ctrl+R` refreshes runs, and `Ctrl+S` stops the selected active run.
- The `tasks` workspace now uses a controlled keyboard-first draft buffer instead of delegating task entry to an OpenTUI textarea, so launches and tests do not depend on hidden renderer focus state.
- Operator-facing surfaces should make provider rights explicit through the actual launch contract rather than deprecated harness mode labels.
- Human TTY surfaces may show an indeterminate activity indicator for active runs, but `aiman` does not pretend to know true percent-complete progress.
- Foreground human `aiman run` output should stay caller-friendly: print `finalText` directly for successful text-mode runs, otherwise print the concise `summary` when one exists, stay quiet on successful empty output, and leave verbose status/log detail to `runs show`, `runs logs`, and `runs inspect`.
- `aiman agent check` should warn when authored agents omit `Stop Conditions`, because the repo treats explicit stop rules as part of a reliable authored contract.
- Removed the confusing prompt reuse functionality and its associated `Ctrl+U` shortcut from the workbench.
- Improved the `Escape` key behavior to always clear the active notice/error banner.
- Updated documentation and tests to reflect the removal of prompt reuse.
- Prefer explicit failure over degraded fallback behavior in the current harness: operator surfaces should either work under their stated requirements or fail clearly, and provider success parsing should require the expected persisted artifacts.
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
