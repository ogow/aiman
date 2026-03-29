# Agent Router

Use this file as a lightweight router. Do not load every document by default. Read only the files that matter for the current task.

## Always-On Context

- `MEMORY.md` contains the core operating model for agents in this repo.
- The latest `.agents/memories/YYYY-MM-DD.md` contains the current task list, status, decisions, and carry-forward context.

## Read These When Relevant

- [ARCHITECTURE.md](/Users/ogow/Code/aiman/ARCHITECTURE.md): current code structure and where behavior lives
- [docs/cli.md](/Users/ogow/Code/aiman/docs/cli.md): command surface and CLI conventions
- [docs/memory.md](/Users/ogow/Code/aiman/docs/memory.md): memory workflow and daily-file contract
- [docs/typescript-style.md](/Users/ogow/Code/aiman/docs/typescript-style.md): repo TypeScript rules adapted from the Google TypeScript Style Guide; read when editing `.ts` files
- [package.json](/Users/ogow/Code/aiman/package.json): scripts, toolchain, and package entrypoints
- [.agents/skills/memory-maintainer/SKILL.md](/Users/ogow/Code/aiman/.agents/skills/memory-maintainer/SKILL.md): use after meaningful actions and important architecture, code, or logic decisions

## Working Rules

- Keep focus on one task at a time.
- Split larger approved plans into smaller concrete checkbox tasks in the daily memory before implementation starts.
- Continue to the next unchecked task automatically when safe.
- Update the daily memory file after each meaningful action and important decision.
- Run the repo memory-maintenance skill whenever meaningful actions or important architecture, code, or logic decisions occur.
- When editing TypeScript, follow [docs/typescript-style.md](/Users/ogow/Code/aiman/docs/typescript-style.md).
- Ask the user only when a blocker, ambiguity, or risky tradeoff truly requires it.
