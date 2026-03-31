# Core Memory

## Project Truths

- `aiman` is currently a CLI-only TypeScript project built with `yargs`.
- `aiman` is a provider-neutral specialist-run recorder, not an orchestrator or workflow engine.
- The codebase favors small command modules and a thin CLI bootstrap.
- The public CLI is grouped by concern: `agent` for authored specialists, `skill` for reusable skills, `run` for execution, and `sesh` for live or completed session inspection.
- TypeScript edits should follow `docs/typescript-style.md`, which adapts the Google TypeScript Style Guide to this repo.
- Tests use Node's built-in `node:test` runner with `assert/strict`.
- The repo keeps durable agent memory in root-level files plus `.agents/memories/`.
- Authored agents can live in both project scope (`<repo>/.aiman/agents/`) and user scope (`~/.aiman/agents/`); lookup considers both and prefers project scope on name collisions.
- Authored agents can optionally declare `skills` in frontmatter; `aiman run` preflights those names against project skills (`<repo>/.agents/skills/`) and user skills (`~/.agents/skills/`), prefers the project skill on collisions, and records the resolved skill files in the launch snapshot.
- `aiman skill install [source]` accepts either a local path or a git URL, installs into project scope (`<repo>/.agents/skills/`) or user scope (`~/.agents/skills/`), defaults the omitted source to `https://github.com/ogow/aiman`, clones the source repo's default branch for git installs, and keeps skill packaging as plain directories rather than a separate archive/install format.
- Authored agents can optionally declare `requiredMcps` in frontmatter; `aiman run` preflights those names through the selected provider CLI before launch and fails fast when a required MCP is missing, disabled, or reported disconnected.
- `aiman skill list` lists available project/user skills using the same project-over-user precedence as run-time skill resolution, so operators can discover the exact skill names to declare in agent frontmatter.
- New runs persist one canonical `run.md` with YAML frontmatter plus a Markdown body; prompt, log, and artifact files are optional run-side details that can be inspected when present.
- Each persisted run now includes an immutable `launch` snapshot inside `run.md` so `inspect` and detached workers can trust the frozen launch evidence without re-reading mutable agent files.
- Authored agent bodies own their full prompt shape; `aiman` no longer appends a hidden runtime footer.
- Authored agent frontmatter now must declare `permissions: read-only | workspace-write`; `aiman run` uses that declaration as the agent's execution mode and rejects conflicting `--mode` overrides.
- Authored agent frontmatter now must also declare `model`; both hand-written agent files and `aiman agent create` follow the same required model contract.
- `aiman run` is foreground-first: it runs a worker inline by default and returns the final result when complete, while `--detach` is the explicit background mode.
- Each persisted run now records `launchMode: foreground | detached`, and operator-facing views surface that mode instead of assuming every live run came from the same path.
- Detached runs execute from snapshotted launch metadata persisted in `run.md` plus `prompt.md`; hidden workers should not re-read mutable agent files after `run --detach` returns.
- Operator-facing run liveness is derived from both the persisted supervising `aiman` process `pid` and a fresh supervisor heartbeat in `run.md`; `sesh list` only treats runs as active when both signals are current, while `sesh show`/`sesh inspect` warn when a run never reached a terminal record.
- Operator-facing surfaces should make provider rights explicit: `show` describes each provider's read-only vs write-enabled modes, and concrete run views/reporting include the effective rights for that run.
- Human TTY surfaces may show an indeterminate activity indicator for active runs, but `aiman` does not pretend to know true percent-complete progress.
- Foreground human `aiman run` output should stay caller-friendly: print the final answer on success when one exists, stay quiet on successful empty output, and leave verbose status/log detail to `sesh show`, `sesh logs`, and `sesh inspect`.
- Prefer explicit failure over degraded fallback behavior in the current harness: operator surfaces should either work under their stated requirements or fail clearly, and provider success parsing should require the expected persisted artifacts.
- `src/lib/run-doc.ts` uses `gray-matter` for the run document instead of a custom YAML/frontmatter parser.
- This repo is currently forward-only during active development; do not preserve backward compatibility unless the user explicitly asks for it.
- Codex-backed agents can map `reasoningEffort` through the Codex CLI config key `model_reasoning_effort`; unsupported providers should reject it instead of silently ignoring it.

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
