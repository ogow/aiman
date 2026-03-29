# Core Memory

## Project Truths

- `aiman` is currently a CLI-only TypeScript project built with `yargs`.
- The codebase favors small command modules and a thin CLI bootstrap.
- TypeScript edits should follow `docs/typescript-style.md`, which adapts the Google TypeScript Style Guide to this repo.
- Tests use Node's built-in `node:test` runner with `assert/strict`.
- The repo keeps durable agent memory in root-level files plus `.agents/memories/`.
- Specialist runs can optionally persist a file-first `report.md` with YAML frontmatter plus artifacts inside each run directory; orchestration and memory still belong to the external parent agent.

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
