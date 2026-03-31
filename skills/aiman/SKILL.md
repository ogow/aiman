---
name: aiman
description: Operate the `aiman` CLI to discover agents and skills, create authored agent files, run agents in the foreground or detached mode, inspect recorded sessions, and debug failed or stuck runs. Use when working in a repo that uses `aiman`, regardless of whether the host agent is Codex, Gemini, OpenCode, or another skill-capable agent system, especially for agent authoring, session inspection, run forensics, provider-mode or MCP-preflight issues, or choosing the right non-TTY command instead of the TTY-only dashboard.
---

# Aiman

Use this skill to work with `aiman` safely and efficiently.

This package is the general skill source. Keep the core guidance host-agnostic so it can be installed into different agent systems. Optional files under `agents/` may add host-specific metadata, but the main `SKILL.md` and `references/` should stand on their own.

## Core Rules

- Prefer the stable non-TTY surfaces: `agent`, `skill`, `run`, and `sesh`.
- Never use `aiman sesh top` from an agent or automation. It is a human-only TTY dashboard.
- Inspect an unfamiliar agent with `aiman agent show <name>` before running it.
- Prefer `--json` for wrappers or automation that need structured output.
- Inspect an existing run before rerunning it when the goal is debugging or forensics.

## Workflow

1. Discover what exists.
   - Use `aiman agent list` to find authored agents.
   - Use `aiman skill list` to find project or user skills.
   - Use `aiman agent show <agent>` to confirm provider, permissions, declared skills, and required MCPs.
2. Author or update an agent.
   - Use `aiman agent create <name> ...` for new agent files.
   - Read `references/authoring-agents.md` for frontmatter, placeholders, and validation rules.
3. Run the agent.
   - Use `aiman run <agent> --task ...` for normal foreground runs.
   - Use `aiman run <agent> --detach` only when background execution is actually needed.
4. Inspect and debug runs.
   - Use `aiman sesh list` to see what is active.
   - Use `aiman sesh show <runId>` for the compact per-run view.
   - Use `aiman sesh logs <runId>` for output and `-f` only when live streaming is needed.
   - Use `aiman sesh inspect <runId>` or `--stream ...` for persisted evidence.

## Decision Guide

- Need the command surface or exact flags: read `references/commands.md`.
- Need to debug a failed, stale, or suspicious run: read `references/debugging.md`.
- Need to create or fix an agent file: read `references/authoring-agents.md`.
- Need provider, permissions, scope, or MCP guidance: read `references/provider-behavior.md`.

## Fast Defaults

- Start with `aiman agent show <agent>` before a first run.
- Use foreground `aiman run` unless there is a real need for `--detach`.
- Use `aiman sesh inspect <runId> --stream prompt` when the issue looks prompt-related.
- Use `aiman sesh logs <runId> --stream stderr` when the issue looks launch- or provider-related.
- Treat `aiman sesh inspect` as the closest thing to a trace view. There is no separate public trace command today.
