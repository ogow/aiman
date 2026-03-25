# Architecture

## Goal

`aiman` is a local MCP server for managing reusable agents and spawning agent runs through existing CLIs.

The system is designed around three concerns:

- agent definitions
- run orchestration
- workspace-local execution state

Skills are intentionally out of scope for this MCP. Provider-native skills should stay in the standard skill folders that the downstream CLIs already understand:

- `~/.agents/skills`
- `<workspace>/.agents/skills`

`aiman` does not register, merge, resolve, or inject those skills. It runs the selected CLI in the target workspace and lets that CLI discover and load skills in its normal way.

## Core Model

There are two primary entities:

- `agent`: a reusable definition of how to run a specialist
- `run`: one execution of an agent against a task

There is no first-class `skill` entity in `aiman`.

Agent configuration is authored as Markdown with YAML frontmatter and a Markdown prompt body. The prompt body is provider-native text passed through as-is to the downstream CLI.

An agent contains:

- `name`
- `provider`
- `description` (optional)
- `model` (optional)
- `systemPrompt`

An agent does not contain skill definitions or skill references. If a task should force a provider-native skill, mention that skill in the task prompt using the provider's normal invocation style.

A run contains:

- `agentName`
- `agentSource`
- `provider`
- `model`
- `taskPrompt`
- `assembledPrompt`
- `workspace`
- `status`
- `timeoutMs`
- `command`
- `args`
- timestamps, exit code, and summary

## Main Components

### MCP Server

The server uses `@modelcontextprotocol/sdk` over stdio.

Current tool surface:

- `agent_create`
- `agent_list`
- `agent_get`
- `run_spawn`
- `run_get`
- `run_list`
- `run_wait`
- `run_cancel`
- `run_logs`

Entry point: [src/index.mjs](/Users/ogow/Code/aiman/src/index.mjs)

### Agent Registry

The registry loads agents from both home and workspace storage, merges them, and applies project precedence by agent name.

If the same agent exists in both scopes, only the workspace version is visible.

Implementation: [src/lib/agent-registry.mjs](/Users/ogow/Code/aiman/src/lib/agent-registry.mjs)

### Run Manager

The run manager resolves a visible agent, assembles the final prompt, asks the provider adapter for a concrete run plan, and spawns the underlying process. It also enforces optional run timeouts, records cancellation requests, and keeps terminal summaries readable.

Implementation: [src/lib/runner.mjs](/Users/ogow/Code/aiman/src/lib/runner.mjs)

### Provider Runners

Provider runners own model validation and command construction for each supported CLI. Authored agent files do not override command wiring; the provider adapter decides how to invoke the downstream CLI.

Implementation: [src/lib/providers/index.mjs](/Users/ogow/Code/aiman/src/lib/providers/index.mjs)

### Run Store

Run metadata and trace events are stored only in the workspace. Home storage is never used for active run state.

Implementation: [src/lib/run-store.mjs](/Users/ogow/Code/aiman/src/lib/run-store.mjs)

## Prompt Assembly

The final prompt is built from:

1. `AGENTS.md` in the workspace when present
2. the agent system prompt
3. the task prompt

Provider-native skills are not expanded into the assembled prompt. If the selected CLI supports skills, it discovers them from the standard skill folders while running in the workspace.

Implementation: [src/lib/context.mjs](/Users/ogow/Code/aiman/src/lib/context.mjs)

## Error Handling

Errors are normalized into explicit application errors and returned as readable MCP tool errors with ANSI color formatting.

Examples:

- agent not found
- model not found
- command not found
- validation failures

Implementation: [src/lib/errors.mjs](/Users/ogow/Code/aiman/src/lib/errors.mjs)

## Current Constraints

- provider defaults are intentionally minimal and may still need tightening against each CLI's evolving flags
- state uses JSON files, not SQLite
