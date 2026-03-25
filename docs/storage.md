# Storage

## Layout

`aiman` uses the same hidden folder name in both scopes:

- home: `~/.aiman/`
- workspace: `<workspace>/.aiman/`

This storage is only for `aiman` state. Provider-native skills are not stored under `.aiman`.

## Home Storage

Home storage is for reusable agent definitions shared across projects.

Current layout:

- `~/.aiman/agents/*.md`

Provider-native home skills should stay in:

- `~/.agents/skills/<skill-name>/SKILL.md`

These agents are visible in every workspace that uses the MCP server unless a project agent with the same name overrides them.

## Workspace Storage

Workspace storage is for project-specific agents and all execution state.

Current layout:

- `<workspace>/.aiman/agents/*.md`
- `<workspace>/.aiman/state.json`
- `<workspace>/.aiman/traces/*.jsonl`

Provider-native repo skills should stay in:

- `<workspace>/.agents/skills/<skill-name>/SKILL.md`

## Merge Rules

Visible agents are built by merging:

1. home agents
2. workspace agents

Merge key:

- `name`

Conflict rule:

- workspace agent wins

Result:

- all unique home agents are visible
- all workspace agents are visible
- if the same name exists in both places, only the workspace agent is shown

## Why Runs Stay Local

Runs, traces, and related execution artifacts stay in the workspace because they are tied to:

- one repo
- one task context
- one local working tree

Keeping them local avoids:

- cross-project trace pollution
- ambiguous handoffs
- cleanup problems

## File Format

Current implementation stores authored agent definitions as Markdown files with YAML frontmatter and a Markdown prompt body.

Intended direction:

- keep Markdown as the human-authored agent format
- run state should remain machine-managed storage
- trace events should remain append-only execution logs

Minimal frontmatter contract:

- required: `name`, `provider`
- optional: `description`, `model`
- body: provider-native prompt text passed through as-is

Example:

```md
---
name: code-reviewer
provider: codex
description: Reviews code for risks and quality
model: gpt-5
---

Review the current change carefully.
Focus on correctness, regressions, and missing tests.
Use provider-native references like @files or $skills when that CLI supports them.
```

Run state is stored as JSON in `state.json`.

Trace events are stored as JSONL, one file per run.

Skills remain file-based in the standard `.agents/skills` locations used by the downstream CLIs and are not persisted or merged by `aiman`.

## Likely Future Change

The storage model is intentionally simple right now. The next durable upgrade would be:

- keep agent definitions file-based
- replace workspace run state with SQLite
