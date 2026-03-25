# Roadmap

## Current State

Implemented:

- official MCP SDK over stdio
- merged home and workspace agent registry
- project precedence on name collision
- model-aware agent definitions
- readable colored tool errors
- workspace-local run state and JSONL traces
- provider-specific run planning for `codex`, `claude`, and `gemini`
- timeout-aware runs with stronger cancellation handling and clearer terminal summaries

## Next Priorities

### 1. Retry policy

Add retry configuration and reporting so transient provider or CLI failures can be retried deliberately instead of requiring a brand-new run.

### 2. Structured handoffs

Add handoff artifacts between runs so one agent can pass compact state to another without replaying full history.

### 3. Agent import

Add import or discovery paths for provider-native agent folders when that becomes useful, so existing project agents can be reused without rewriting them by hand.

### 4. SQLite for run state

Move workspace run state from JSON files to SQLite when concurrency, auditability, or querying becomes a real need.

## Known Issues

### 1. RunStore is not concurrency-safe

`RunStore` uses read-modify-write updates against one JSON file with a shared temporary filename. Parallel writes can fail or drop updates, so the current storage path is fragile under concurrent tool calls.

### 2. Malformed agent files can break registry reads

`AgentRegistry` currently assumes every agent file parses cleanly. One bad file in `.aiman/agents/` can break `agent_list`, `agent_get`, and any run flow that depends on agent lookup.

### 3. Agent name normalization can overwrite definitions

Agent filenames are slugified and lowercased, but visible agent identity still uses the raw `name`. That means names such as `Frontend` and `frontend` can collide on disk and overwrite one another unexpectedly.

### 4. Runner event handlers are not hardened against storage failures

The async child-process event handlers write to the run store directly without defensive error handling. If a log append or run update fails, the process can surface unhandled promise rejections instead of degrading cleanly.

## Nice-to-Have

- richer run summaries
- artifact collection
- MCP task support for long-running operations
- import and export for agent packs
- agent versioning or inheritance
