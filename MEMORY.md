# Core Memory

## Project Truths

- `aiman` is a human-first TypeScript terminal app built on a small `yargs` CLI plus a default interactive TUI.
- `aiman` is a provider-neutral run workbench, not an orchestrator or workflow engine.
- The public product model is `profiles`, `runs`, and local `aiman` `skills`.
- The public CLI is grouped by concern: `profile`, `skill`, and `run`.
- `aiman` with no arguments opens the interactive workbench and requires a real TTY.
- Built-in profiles `build` and `plan` are always available.
- Profiles live in project scope under `<repo>/.aiman/profiles/` and user scope under `~/.aiman/profiles/`.
- Local `aiman` skills live in `<repo>/.aiman/skills/<name>/SKILL.md` and `~/.aiman/skills/<name>/SKILL.md`.
- Repo-root `AGENTS.md` is the canonical project-context source, but only the `## Aiman Runtime Context` section is attached to runs.
- Codex and Gemini are execution backends only; `aiman` decides prompt context, active skills, and visible run metadata before launch.
- Public run modes are `safe` and `yolo`.
- Codex mode mapping is `safe -> --sandbox read-only` and `yolo -> --sandbox workspace-write`.
- Gemini mode mapping is `safe -> --approval-mode plan` and `yolo -> --approval-mode auto_edit`.
- Run persistence remains global under `~/.aiman/runs/`, indexed by `~/.aiman/aiman.db`.
- Persisted launch snapshots now record profile identity, active local skill names, optional `AGENTS.md` runtime-context attachment, and the original task text.
- TypeScript edits should follow `docs/typescript-style.md`, which adapts the Google TypeScript Style Guide to this repo.
- Verification runs through `bun test`; most suites still use Node-compatible `node:test` APIs, and the TUI layer now also includes OpenTUI React interaction tests.
- The repo keeps durable agent memory in root-level files plus `.agents/memories/`.
- Project-scoped `aiman` commands resolve the nearest ancestor project root that contains repo markers such as `.aiman`, `.agents`, or `.git`, but `$HOME` itself must never become the project root just because it contains user-scope folders or its own `.git` checkout.
- New runs persist one canonical `run.md` with YAML frontmatter plus a Markdown body; prompt, log, and artifact files are optional run-side details that can be inspected when present.
- Each persisted run now includes an immutable `launch` snapshot inside `run.md` so `inspect` and detached workers can trust the frozen launch evidence without re-reading mutable profile files.
- Authored profile bodies own their full prompt shape; `aiman` no longer appends a hidden runtime footer.
- Authored profiles must declare `provider`, `model`, `mode`, `description`, `reasoningEffort`, and a Markdown body containing `{{task}}`.
- `reasoningEffort` is provider-specific: Codex supports `none|low|medium|high`, while Gemini currently requires `none`.
- `aiman run` is foreground-first: it runs a worker inline by default and returns the final result when complete, while `--detach` is the explicit background mode.
- Each persisted run now records `launchMode: foreground | detached`, and operator-facing views surface that mode instead of assuming every live run came from the same path.
- Detached runs execute from snapshotted launch metadata persisted in `run.md` plus `prompt.md`; hidden workers should not re-read mutable profile files after `run --detach` returns.
- Run/session state is now global: `aiman` stores run directories under `~/.aiman/runs/`, indexes them in `~/.aiman/aiman.db`, and records each run's `projectRoot` so `sesh list`, `show`, `logs`, `inspect`, and the default workbench work from any working directory without scanning per-project `.aiman/runs/`.
- Windows provider launches still resolve logical commands like `codex` and `gemini` through `PATH`/`PATHEXT`, but `.cmd` and `.bat` shims must be re-launched through an escaped `cmd.exe /d /s /c` command line so prompt arguments survive Windows metacharacters instead of relying on `shell: true`.
- Windows MCP-preflight helpers must also tear down the full wrapped provider process tree on timeout, not just the outer `cmd.exe`, so repeated validation does not leak orphaned background CLI processes.
- Windows Codex runs also pin `allow_login_shell=false` and `shell_environment_policy.experimental_use_profile=false` so non-interactive provider-side PowerShell commands do not depend on loading the user's shell profile.
- Codex-backed `aiman` runs should keep project-scoped provider config available for things like MCP registration, but explicitly override prompt-shaping project inputs by setting `project_doc_max_bytes=0`, `project_doc_fallback_filenames=[]`, `developer_instructions=""`, `instructions=""`, and `agents={}` on the Codex CLI launch.
- Gemini-backed `aiman` runs should keep the project workspace and project settings available for MCP registration, but override Gemini context-file discovery with a child-local settings overlay passed through `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, whose `context.fileName` points at an impossible filename.
- Gemini-backed `aiman` runs should send the authored prompt on stdin while keeping Gemini in headless mode with `--prompt ""`, so multiline prompts survive Windows command-wrapper launches reliably.
- `bun run test:provider-contract` is the live provider smoke-test suite; it uses the real Codex and Gemini CLIs to verify that ambient repo instruction files stay out while only explicit `AGENTS.md#Aiman Runtime Context` appears.
- Operator-facing run liveness is derived from both the persisted supervising `aiman` process `pid` and a fresh supervisor heartbeat in `run.md`; `sesh list` only treats runs as active when both signals are current, while `sesh show`/`sesh inspect` warn when a run never reached a terminal record.
- Active runs can be stopped through `aiman run stop <run-id>` or the default interactive workbench; both write a persisted `.stop-requested` marker that the supervising worker polls so stop behavior works cross-platform, including PowerShell/Windows and `.cmd`-wrapped provider process trees.
- Human TTY surfaces now use Bun + OpenTUI React under `src/ui/`; `aiman` with no args remains the only interactive TTY entrypoint, and `aiman sesh top` is removed.
- The default interactive workbench now unifies launch and run monitoring in two workspaces: `launch` for profile selection plus task entry, and `runs` for active/historic run inspection plus stop actions.
- The OpenTUI workbench stays keyboard-first: `Tab` cycles focus, `1/2` switch workspaces, `Ctrl+L` launches, `Ctrl+R` refreshes runs, and `Ctrl+S` stops the selected active run.
- Operator-facing surfaces should make provider rights explicit: `show` describes each provider's read-only vs write-enabled modes, and concrete run views/reporting include the effective rights for that run.
- Human TTY surfaces may show an indeterminate activity indicator for active runs, but `aiman` does not pretend to know true percent-complete progress.
- The global run index must work under both Node and Bun: prefer `node:sqlite` when available, but fall back to `bun:sqlite` so the Bun-native CLI can still record and inspect runs.
- Foreground human `aiman run` output should stay caller-friendly: print the final answer on success when one exists, stay quiet on successful empty output, and leave verbose status/log detail to `run show`, `run logs`, and `run inspect`.
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
