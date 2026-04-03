# Architecture

`aiman` is a small human-first terminal workbench. It launches one profile at a time, persists one canonical run record, and makes that run easy to inspect later through either the default TUI or the non-TTY `run` commands.

## Current Shape

- [src/cli.ts](/Users/ogow/Code/aiman/src/cli.ts) is the executable entrypoint.
- [src/lib/cli.ts](/Users/ogow/Code/aiman/src/lib/cli.ts) builds the shared `yargs` instance and sends `aiman` with no args into the interactive app.
- [src/cmd/index.ts](/Users/ogow/Code/aiman/src/cmd/index.ts) registers the public `profile`, `skill`, `run`, and `sesh` surfaces plus the hidden detached-worker command.
- [src/cmd/app.ts](/Users/ogow/Code/aiman/src/cmd/app.ts) is the thin entrypoint for the Bun/OpenTUI workbench in [src/ui/aiman-app.tsx](/Users/ogow/Code/aiman/src/ui/aiman-app.tsx).
- [src/cmd/profile.ts](/Users/ogow/Code/aiman/src/cmd/profile.ts) groups profile catalog and authoring subcommands.
- [src/cmd/profile-list.ts](/Users/ogow/Code/aiman/src/cmd/profile-list.ts) implements `aiman profile list`.
- [src/cmd/profile-show.ts](/Users/ogow/Code/aiman/src/cmd/profile-show.ts) implements `aiman profile show`.
- [src/cmd/profile-check.ts](/Users/ogow/Code/aiman/src/cmd/profile-check.ts) implements `aiman profile check`.
- [src/cmd/profile-create.ts](/Users/ogow/Code/aiman/src/cmd/profile-create.ts) implements `aiman profile create`.
- [src/cmd/skill.ts](/Users/ogow/Code/aiman/src/cmd/skill.ts) groups local `aiman` skill discovery commands.
- [src/cmd/skills.ts](/Users/ogow/Code/aiman/src/cmd/skills.ts) implements `aiman skill list` for project/user local skills.
- [src/cmd/skill-show.ts](/Users/ogow/Code/aiman/src/cmd/skill-show.ts) and [src/cmd/skill-check.ts](/Users/ogow/Code/aiman/src/cmd/skill-check.ts) expose one skill at a time for inspection and validation.
- [src/cmd/run.ts](/Users/ogow/Code/aiman/src/cmd/run.ts) is the public run dispatcher: it runs one profile in the foreground or detached mode and also routes `run list`, `run show`, `run logs`, `run inspect`, and `run stop`.
- [src/cmd/ps.ts](/Users/ogow/Code/aiman/src/cmd/ps.ts) implements `aiman run list`.
- [src/cmd/status.ts](/Users/ogow/Code/aiman/src/cmd/status.ts) implements `aiman run show`.
- [src/cmd/logs.ts](/Users/ogow/Code/aiman/src/cmd/logs.ts) implements `aiman run logs`.
- [src/cmd/inspect.ts](/Users/ogow/Code/aiman/src/cmd/inspect.ts) implements `aiman run inspect`.
- [src/cmd/stop-agent.ts](/Users/ogow/Code/aiman/src/cmd/stop-agent.ts) now implements `aiman run stop <id>`.
- [src/cmd/sesh.ts](/Users/ogow/Code/aiman/src/cmd/sesh.ts) groups the non-TTY session-inspection commands (`list`, `show`, `logs`, and `inspect`) after the interactive `top` dashboard was removed.
- [src/cmd/internal-run.ts](/Users/ogow/Code/aiman/src/cmd/internal-run.ts) is a hidden worker command that owns provider execution for detached runs.
- [src/lib/profiles.ts](/Users/ogow/Code/aiman/src/lib/profiles.ts) is the strict catalog for built-in, project, and user profiles, including current-contract validation and authored profile creation.
- [src/lib/agents.ts](/Users/ogow/Code/aiman/src/lib/agents.ts) is now only a thin compatibility wrapper over the profile layer.
- [src/lib/skills.ts](/Users/ogow/Code/aiman/src/lib/skills.ts) manages local `aiman` skills, project/user precedence, skill validation, and the explicit active/suggested skill selection used for runs.
- [src/lib/project-context.ts](/Users/ogow/Code/aiman/src/lib/project-context.ts) extracts only the `## Aiman Runtime Context` section from repo-root `AGENTS.md`.
- [src/lib/run-doc.ts](/Users/ogow/Code/aiman/src/lib/run-doc.ts) reads and writes the canonical `run.md` file with `gray-matter`, while resolving any referenced artifacts inside each run directory.
- [src/lib/runs.ts](/Users/ogow/Code/aiman/src/lib/runs.ts) splits run preparation, detached launch, hidden-worker execution, and the direct synchronous execution path used by tests, while freezing launch evidence up front, rebuilding detached workers from the persisted launch snapshot instead of live profile files, assembling prompts from the selected profile plus AGENTS runtime context plus local skills, honoring persisted stop requests for active runs, and killing Windows command-processor launch trees when a `.cmd` / `.bat` provider must be stopped.
- [src/lib/run-store.ts](/Users/ogow/Code/aiman/src/lib/run-store.ts) owns persisted run files under the global `~/.aiman/runs/` store, with `run.md` as the canonical record plus run-directory-derived prompt/log/artifact/stop-request paths and derived active/warning read state for operator-facing views.
- [src/lib/run-index.ts](/Users/ogow/Code/aiman/src/lib/run-index.ts) keeps the global `~/.aiman/aiman.db` run index in sync with `run.md`, preferring `node:sqlite` on Node but falling back to `bun:sqlite` when the Bun-native CLI is running.
- [src/lib/run-output.ts](/Users/ogow/Code/aiman/src/lib/run-output.ts) tails and follows persisted logs without introducing a daemon or side-channel IPC layer.
- [src/lib/activity.ts](/Users/ogow/Code/aiman/src/lib/activity.ts) renders the small indeterminate activity bar used by foreground `run` and other active operator-facing views.
- [src/lib/run-render.ts](/Users/ogow/Code/aiman/src/lib/run-render.ts) centralizes the human-facing plain-text views used by `ps`, `status`, and `inspect`, including the frozen launch evidence surfaced by `inspect`.
- [src/ui/aiman-app.tsx](/Users/ogow/Code/aiman/src/ui/aiman-app.tsx) now owns the Bun/OpenTUI renderer bootstrap plus the unified workbench controller: it loads profiles/context/runs, polls run state, launches profiles, and stops active runs.
- [src/ui/workbench-model.ts](/Users/ogow/Code/aiman/src/ui/workbench-model.ts) holds the stable workbench enums, run/profile summary builders, tab/focus order, and small formatting helpers used across the TTY surface.
- [src/ui/workbench-view.tsx](/Users/ogow/Code/aiman/src/ui/workbench-view.tsx) contains the OpenTUI React presentation layer for the shell chrome, launch workspace, and runs workspace.
- [src/lib/providers/index.ts](/Users/ogow/Code/aiman/src/lib/providers/index.ts) selects the strict provider adapters for `codex` and `gemini`.
- [src/lib/provider-capabilities.ts](/Users/ogow/Code/aiman/src/lib/provider-capabilities.ts) centralizes the human/machine-readable rights model for each provider and run mode so operator surfaces can explain read-only vs write-enabled behavior consistently.
- [src/lib/providers/shared.ts](/Users/ogow/Code/aiman/src/lib/providers/shared.ts) keeps the explicit placeholder-based prompt rendering, AGENTS runtime-context and active-skill prompt assembly, cross-platform provider environment allowlist, timeout-safe helper execution, and result-normalization helpers small and boring.
- [src/lib/providers/codex.ts](/Users/ogow/Code/aiman/src/lib/providers/codex.ts) also pins Windows Codex launches away from login-shell and user-profile shell behavior, and blanks Codex project-doc, developer-instruction, and agent-role inputs on launch so authored `aiman` prompts do not inherit repo `AGENTS.md`, prompt-shaping `.codex` instruction keys, or malformed repo role definitions while still keeping project MCP registration available.
- [src/lib/providers/gemini.ts](/Users/ogow/Code/aiman/src/lib/providers/gemini.ts) injects a child-local Gemini settings overlay so Gemini context-file discovery uses an impossible filename instead of project `AGENTS.md` / `GEMINI.md`, keeps project `.gemini/settings.json` available for MCP registration, and sends the authored prompt on stdin while keeping Gemini in headless mode with `--prompt ""` so multiline prompts survive Windows command-wrapper launches.
- [src/lib/executables.ts](/Users/ogow/Code/aiman/src/lib/executables.ts) resolves provider commands from `PATH` for both Unix binaries and Windows `PATHEXT` shims, and rewrites Windows `.cmd`/`.bat` launches into an escaped `cmd.exe /d /s /c` invocation while preserving whether the launch went through the Windows command processor.
- [src/lib/paths.ts](/Users/ogow/Code/aiman/src/lib/paths.ts) resolves the effective project root by walking up from the caller's current directory to the nearest ancestor with project markers such as `.aiman`, `.agents`, or `.git`, while explicitly refusing to treat `$HOME` itself as that root so user scope and project scope do not collapse together under home-level marker folders or a home-level Git checkout.
- [src/lib/paths.ts](/Users/ogow/Code/aiman/src/lib/paths.ts) centralizes project/user profile roots, project/user skill roots, the global run-directory layout, and the SQLite run-index location.
- [src/lib/task-input.ts](/Users/ogow/Code/aiman/src/lib/task-input.ts) enforces the CLI task-input contract for `--task` vs stdin.

## Conventions

- Keep the CLI bootstrap thin.
- Prefer one command module per command or subcommand.
- Keep user-facing behavior simple and explicit.
- Keep the public command tree grouped by concern: `profile` for authored prompt contracts, `skill` for reusable local skills, `run` for execution, and `sesh` for live/completed session inspection.
- Add focused utility modules in `src/lib/` when behavior is shared or worth testing independently.
- Keep profile loading catalog-based and simple; the repo is small enough that clarity matters more than micro-optimizing file lookups.
- Keep skill execution provider-native: `aiman` should record declared skills as agent metadata, while actual skill discovery and use stay with the downstream CLI.
- Keep required MCP checks provider-native too: use the selected provider CLI as the source of truth for whether a declared MCP is available before launch.
- Keep profile scope explicit on creation, but let lookup consider both project and user scope by default and prefer project scope on name collisions.
- Keep skill roots explicit and parallel to agent precedence for `aiman`'s own skill-management commands: use `<repo>/.agents/skills/` first, then `~/.agents/skills/`, but do not make run-time prompt behavior depend on resolving those folders.
- Keep project instruction inheritance opt-in and explicit: authored profile files are the primary instruction contract, and only `AGENTS.md#Aiman Runtime Context` should be appended as extra repo context during a run.
- Keep the shared repo baseline separate from router files: `AGENTS.md` stays lightweight, while `docs/agent-baseline.md` is the drafting reference for what belongs in `AGENTS.md#Aiman Runtime Context`.
- Keep profile mode explicit in frontmatter; the profile file should declare whether it is `safe` or `yolo`, and runtime overrides must not bypass that declaration.
- Keep run persistence boring and explicit; store files on disk instead of hiding state behind extra abstractions.
- Keep the canonical run record file-first: `run.md` carries deterministic frontmatter plus the final Markdown body, and `artifacts/` remains optional.
- Keep prompt/log/artifact files optional and inspectable rather than mandatory outputs, but derive their default locations from the run directory instead of duplicating path metadata in `run.md`.
- Keep run lookup global and deterministic; store run directories in `~/.aiman/runs/`, index them in `~/.aiman/aiman.db`, and record `projectRoot` in the persisted run metadata instead of relying on the caller's current directory.
- Keep one immutable `launch` snapshot inside `run.md`; it should freeze the resolved agent, provider invocation, digests, timeout settings, and allowlisted environment key names before execution starts.
- Distinguish recorded run state from live process state; use the stored supervising `aiman` `pid` plus a fresh persisted heartbeat to answer "is this still running now?" instead of trusting stale `status: running` frontmatter, but do not introduce a new persisted stale lifecycle state.
- Keep the launch/worker split boring: foreground `run` executes inline, detached `run --detach` starts a managed background worker, and the worker itself is just another CLI command running against the same run directory and persisted launch snapshot.
- Keep provider-specific options honest: Codex supports `reasoningEffort` through CLI config, while unsupported providers should fail clearly instead of silently ignoring it.
- Keep provider-isolation promises verified against the real CLIs through `bun run test:provider-contract`, not only through adapter argv/env unit tests.
- Keep provider rights explicit: the effective access level depends on both provider and run mode, and operator-facing surfaces should spell that out instead of assuming callers know adapter flags.
- Prefer forward-only cleanup over backward-compatibility shims while the project is still changing quickly.
- Keep `aiman` focused on recording one specialist run. Choosing what to run next, retry, or compose belongs outside this tool.
- Return slim machine-readable output from `aiman run ... --json`; keep full execution metadata on disk and expose it through `status`, `logs`, and `inspect`.
- Keep human progress honest: use indeterminate activity indicators where helpful, but do not invent percent-complete semantics the harness cannot actually measure.
- Keep React and TSX scoped to the human TTY layer under `src/ui/`; the rest of the CLI and domain modules should stay plain TypeScript where possible.
- Keep the shared TTY chrome compact and intentional: use the shared header/home primitives for aligned hotkey legends, branded ASCII identity, page context, and global run-health indicators instead of numeric navigation or split-pane clutter.
- Avoid adding runtime APIs before the CLI or tests actually need them.
