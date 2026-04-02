# Memory Workflow

## Files

- `MEMORY.md`: stable, always-loaded project memory
- `AGENTS.md`: lightweight router for deeper docs
- `.agents/memories/YYYY-MM-DD.md`: daily working memory

## Daily File Contract

Each daily file should use this structure:

```md
# Daily Memory Log - YYYY-MM-DD

## Tasks

- [ ] Clear, self-contained task
- [x] Completed task

## Current Status

- Current focus: <exactly one task>
- Last completed action: <short note>
- Blocked by: <none or short note>

## Progress Log

- HH:MM - Completed action or important observation

## Decisions

- HH:MM - Decision made, with short reason

## Carry Forward

- Only items that still matter next session
```

## Rules

- Write tasks clearly enough that an agent can begin without guessing.
- Split larger approved plans into smaller concrete checkbox tasks before implementation begins.
- Keep exactly one active task at a time.
- Check off tasks when complete.
- Continue to the next unchecked task automatically unless blocked.
- Update the daily file after each meaningful action and important decision.
