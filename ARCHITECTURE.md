# Architecture

`aiman` is a small CLI-only specialist-run recorder. It launches one authored specialist at a time, persists one canonical run record, and makes that run easy to inspect later.

## Current Shape

- [src/cli.ts](/Users/ogow/Code/aiman/src/cli.ts) is the executable entrypoint.
- [src/lib/cli.ts](/Users/ogow/Code/aiman/src/lib/cli.ts) builds the shared `yargs` instance.
- [src/cmd/index.ts](/Users/ogow/Code/aiman/src/cmd/index.ts) registers the public `agent`, `skill`, `run`, and `sesh` command groups plus the hidden detached-worker command.
- [src/cmd/agent.ts](/Users/ogow/Code/aiman/src/cmd/agent.ts) groups the authored-agent catalog and authoring subcommands.
- [src/cmd/list.ts](/Users/ogow/Code/aiman/src/cmd/list.ts) implements `aiman agent list`.
- [src/cmd/create.ts](/Users/ogow/Code/aiman/src/cmd/create.ts) implements `aiman agent create` for structured project-scope or user-scope agent files.
- [src/cmd/show.ts](/Users/ogow/Code/aiman/src/cmd/show.ts) implements `aiman agent show`.
- [src/cmd/skill.ts](/Users/ogow/Code/aiman/src/cmd/skill.ts) groups skill-related subcommands.
- [src/cmd/skills.ts](/Users/ogow/Code/aiman/src/cmd/skills.ts) implements `aiman skill list`, using the same precedence rules that run-time skill resolution uses.
- [src/cmd/run.ts](/Users/ogow/Code/aiman/src/cmd/run.ts) runs one specialist in the foreground by default, can launch detached runs explicitly, owns the small human activity indicator for foreground TTY use, and keeps successful foreground output down to the final answer instead of a full status dump.
- [src/cmd/sesh.ts](/Users/ogow/Code/aiman/src/cmd/sesh.ts) groups session inspection subcommands.
- [src/cmd/ps.ts](/Users/ogow/Code/aiman/src/cmd/ps.ts) implements `aiman sesh list`, listing active recorded runs using the stored PID plus the persisted supervisor heartbeat as the live-process check.
- [src/cmd/status.ts](/Users/ogow/Code/aiman/src/cmd/status.ts) implements `aiman sesh show`, rendering the compact human-friendly per-run view.
- [src/cmd/logs.ts](/Users/ogow/Code/aiman/src/cmd/logs.ts) implements `aiman sesh logs`, reading or following persisted run output from `stdout.log` and `stderr.log`.
- [src/cmd/inspect.ts](/Users/ogow/Code/aiman/src/cmd/inspect.ts) implements `aiman sesh inspect`, exposing the detailed parsed run record plus raw persisted files.
- [src/cmd/top.ts](/Users/ogow/Code/aiman/src/cmd/top.ts) implements `aiman sesh top`, providing the interactive terminal dashboard and requiring a real TTY instead of silently degrading to another mode.
- [src/cmd/internal-run.ts](/Users/ogow/Code/aiman/src/cmd/internal-run.ts) is a hidden worker command that owns provider execution for detached runs.
- [src/lib/agents.ts](/Users/ogow/Code/aiman/src/lib/agents.ts) loads the small agent catalog from both project and user scope, validates frontmatter including declared skills and required MCP names, resolves agents with project precedence, and scaffolds new agent files.
- [src/lib/skills.ts](/Users/ogow/Code/aiman/src/lib/skills.ts) resolves declared agent skills from project and user skill roots, keeps project-over-user precedence, and freezes the resolved skill metadata into launch-time evidence.
- [src/lib/skills.ts](/Users/ogow/Code/aiman/src/lib/skills.ts) also reads the skill catalog for `aiman skill list`, exposing the same project/user precedence operators will see at run time.
- [src/lib/run-doc.ts](/Users/ogow/Code/aiman/src/lib/run-doc.ts) reads and writes the canonical `run.md` file with `gray-matter`, while resolving any referenced artifacts inside each run directory.
- [src/lib/runs.ts](/Users/ogow/Code/aiman/src/lib/runs.ts) splits run preparation, detached launch, hidden-worker execution, and the direct synchronous execution path used by tests, while freezing launch evidence up front and rebuilding detached workers from the persisted launch snapshot instead of live agent files.
- [src/lib/run-store.ts](/Users/ogow/Code/aiman/src/lib/run-store.ts) owns persisted run files under `.aiman/runs/`, with `run.md` as the canonical record plus run-directory-derived prompt/log/artifact paths and derived active/warning read state for operator-facing views.
- [src/lib/run-output.ts](/Users/ogow/Code/aiman/src/lib/run-output.ts) tails and follows persisted logs without introducing a daemon or side-channel IPC layer.
- [src/lib/activity.ts](/Users/ogow/Code/aiman/src/lib/activity.ts) renders the small indeterminate activity bar used by foreground `run` and active views inside `top`.
- [src/lib/run-render.ts](/Users/ogow/Code/aiman/src/lib/run-render.ts) centralizes the human-facing plain-text views used by `ps`, `status`, `inspect`, and `top`, including the frozen launch evidence surfaced by `inspect`.
- [src/lib/providers/index.ts](/Users/ogow/Code/aiman/src/lib/providers/index.ts) selects the strict provider adapters for `codex` and `gemini`.
- [src/lib/provider-capabilities.ts](/Users/ogow/Code/aiman/src/lib/provider-capabilities.ts) centralizes the human/machine-readable rights model for each provider and run mode so operator surfaces can explain read-only vs write-enabled behavior consistently.
- [src/lib/providers/shared.ts](/Users/ogow/Code/aiman/src/lib/providers/shared.ts) keeps the explicit placeholder-based prompt rendering, environment allowlist, MCP-list parsing, and result-normalization helpers small and boring.
- [src/lib/paths.ts](/Users/ogow/Code/aiman/src/lib/paths.ts) centralizes project/user agent roots, project/user skill roots, and run-directory layout.
- [src/lib/task-input.ts](/Users/ogow/Code/aiman/src/lib/task-input.ts) enforces the CLI task-input contract for `--task` vs stdin.

## Conventions

- Keep the CLI bootstrap thin.
- Prefer one command module per command or subcommand.
- Keep user-facing behavior simple and explicit.
- Keep the public command tree grouped by concern: `agent` for authored specialists, `skill` for reusable skills, `run` for execution, and `sesh` for live/completed session inspection.
- Add focused utility modules in `src/lib/` when behavior is shared or worth testing independently.
- Keep agent loading catalog-based and simple; the repo is small enough that clarity matters more than micro-optimizing file lookups.
- Keep skill execution provider-native: `aiman` should validate and record declared skills, not reimplement Codex/Gemini skill loading.
- Keep required MCP checks provider-native too: use the selected provider CLI as the source of truth for whether a declared MCP is available before launch.
- Keep agent scope explicit on creation, but let lookup consider both project and user scope by default and prefer project scope on name collisions.
- Keep skill roots explicit and parallel to agent precedence: use `<repo>/.agents/skills/` first, then `~/.agents/skills/`, and freeze the resolved file paths/digests in the launch snapshot for auditability.
- Keep agent permissions explicit in frontmatter; the agent file should declare whether it is a `read-only` or `workspace-write` specialist, and runtime overrides must not bypass that declaration.
- Keep run persistence boring and explicit; store files on disk instead of hiding state behind extra abstractions.
- Keep the canonical run record file-first: `run.md` carries deterministic frontmatter plus the final Markdown body, and `artifacts/` remains optional.
- Keep prompt/log/artifact files optional and inspectable rather than mandatory outputs, but derive their default locations from the run directory instead of duplicating path metadata in `run.md`.
- Keep one immutable `launch` snapshot inside `run.md`; it should freeze the resolved agent, provider invocation, digests, timeout settings, and allowlisted environment key names before execution starts.
- Distinguish recorded run state from live process state; use the stored supervising `aiman` `pid` plus a fresh persisted heartbeat to answer "is this still running now?" instead of trusting stale `status: running` frontmatter, but do not introduce a new persisted stale lifecycle state.
- Keep the launch/worker split boring: foreground `run` executes inline, detached `run --detach` starts a managed background worker, and the worker itself is just another CLI command running against the same run directory and persisted launch snapshot.
- Keep provider-specific options honest: Codex supports `reasoningEffort` through CLI config, while unsupported providers should fail clearly instead of silently ignoring it.
- Keep provider rights explicit: the effective access level depends on both provider and run mode, and operator-facing surfaces should spell that out instead of assuming callers know adapter flags.
- Prefer forward-only cleanup over backward-compatibility shims while the project is still changing quickly.
- Keep `aiman` focused on recording one specialist run. Choosing what to run next, retry, or compose belongs outside this tool.
- Return slim machine-readable output from `aiman run ... --json`; keep full execution metadata on disk and expose it through `status`, `logs`, and `inspect`.
- Keep human progress honest: use indeterminate activity indicators where helpful, but do not invent percent-complete semantics the harness cannot actually measure.
- Avoid adding runtime APIs before the CLI or tests actually need them.
