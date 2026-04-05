# `aiman`

> A small terminal workbench for running one agent at a time, then keeping a trustworthy record of what happened.

`aiman` is for teams that want a simple, human-first terminal app instead of a bigger orchestration system. You define agents as Markdown files, configure shared repo bootstrap context through `aiman` config, run through Codex or Gemini, and inspect the saved run later through the OpenTUI workbench or the `run` commands.

## Why It Exists

Most agent tooling jumps quickly into orchestration, routing, and background systems. `aiman` stays narrower:

- one agent per run
- explicit agent files
- shared native repo context via configured bootstrap file names such as `AGENTS.md`
- persisted prompts, logs, and run metadata
- a small-terminal-first OpenTUI workbench plus simple CLI inspection

If you want a boring, inspectable way to author specialists and keep a durable record of each run, this is the shape.

## Mental Model

```mermaid
flowchart LR
    A["Agent (.aiman/agents/*.md)"] --> B["aiman run <agent>"]
    G["Configured bootstrap context files (for example AGENTS.md)"] --> M
    M["Provider CLI (Codex or Gemini)"] --> B
    B --> R["~/.aiman/runs/<run-id>/run.md"]
    B --> P["prompt.md + stdout.log + stderr.log"]
    R --> I["aiman runs show / logs / inspect"]
    P --> I
```

## Core Concepts

| Concept | What it is                                                         | Where it lives                         |
| ------- | ------------------------------------------------------------------ | -------------------------------------- |
| Agent   | A reusable prompt preset with YAML frontmatter and a Markdown body | `.aiman/agents/` or `~/.aiman/agents/` |
| Run     | One execution of one agent                                         | `~/.aiman/runs/<run-id>/`              |
| App     | The default interactive terminal UI                                | `aiman`                                |

## Quick Start

### 1. Install dependencies

```bash
bun install
```

`aiman` now expects Bun for the interactive workbench and local development commands.

### 2. Make the CLI available everywhere

```bash
bun run install:global
```

That builds `dist/` and links the `aiman` binary so you can run `aiman ...` from any directory where Bun is available.

If you want to remove it later:

```bash
bun run uninstall:global
```

### 3. Create an agent

```bash
aiman agent create reviewer \
  --scope project \
  --provider codex \
  --mode safe \
  --model gpt-5.4-mini \
  --reasoning-effort medium \
  --description "Reviews diffs" \
  --instructions "Review the current patch and call out concrete bugs."
```

### 4. Inspect the agent

```bash
aiman agent show reviewer --scope project
```

### 5. Check it

```bash
aiman agent check reviewer --scope project
```

### 6. Run it

```bash
aiman run reviewer --scope project --task "Review my current changes"
```

### 7. Inspect the saved run

```bash
aiman
aiman runs list --all
aiman runs show <run-id>
aiman runs logs <run-id>
aiman runs inspect <run-id>
```

## CLI Overview

### Agent Commands

Use these to create and inspect authored agents.

| Command                                        | Purpose                                     |
| ---------------------------------------------- | ------------------------------------------- |
| `aiman agent list [--scope project&#124;user]` | List available agents                       |
| `aiman agent show <agent> [--scope ...]`       | Show one agent's provider, mode, and prompt |
| `aiman agent check <agent> [--scope ...]`      | Statically validate one agent               |
| `aiman agent create <name> ...`                | Create a new agent file                     |

### Run Commands

Use these to execute a specialist.

| Command                           | Purpose                                           |
| --------------------------------- | ------------------------------------------------- |
| `aiman run <agent> --task <text>` | Run in the foreground and return the final result |
| `aiman run <agent> --detach`      | Start a background run and return immediately     |

Foreground runs wait for completion and print the final answer on success. Detached runs persist the same run contract, but execute from the launch snapshot already frozen into `run.md` and `prompt.md`.

### Runs Commands

Use these to inspect what already happened.

| Command                                 | Purpose                                           |
| --------------------------------------- | ------------------------------------------------- |
| `aiman runs list [--all] [--limit <n>]` | List active runs or recent history                |
| `aiman runs show <run-id>`              | Show compact per-run status                       |
| `aiman runs logs <run-id>`              | Read persisted stdout and stderr, optionally live |
| `aiman runs inspect <run-id>`           | Read the full persisted evidence                  |

### TTY Surfaces

- `aiman` with no arguments opens the default OpenTUI workbench for creating, inspecting, and stopping runs.
- The workbench is real-TTY-only, small-terminal-first, and unifies launch plus run monitoring in one keyboard-first surface.
- The workbench is split into `start`, `agents`, `tasks`, and `runs`.
- `tasks` is the keyboard-first task-entry workspace; `runs` keeps active and historic runs together, with answer/log/prompt details plus stop actions.

## Package API

`aiman` can now be used as an importable package as well as a CLI.

```ts
import { createAiman } from "aiman";

const aiman = await createAiman({ projectRoot: process.cwd() });

const result = await aiman.runs.run("reviewer", {
   agentScope: "project",
   task: "Review the current changes"
});

console.log(result.finalText);
```

Useful entrypoints:

- `createAiman({ projectRoot? })`
- `aiman.agents.list|get|check|create(...)`
- `aiman.projectContext.load()`
- `aiman.runs.run|launch|list|get|readOutput|inspectFile|stop(...)`
- `aiman.workbench.open()`

## How Agents Work

An `aiman` agent is a Markdown file with YAML frontmatter plus a provider-native prompt body.

```md
---
name: hello
provider: gemini
description: Respond with a short, friendly greeting
mode: safe
model: gemini-2.5-flash-lite
reasoningEffort: none
---

## Role

You are the hello specialist.

## Task Input

{{task}}

## Instructions

Respond briefly and warmly.
```

### Required frontmatter

- `name`
- `provider`
- `description`
- `mode`
- `model`
- `reasoningEffort`

### `agent create` requirements

When creating an agent through the CLI, these flags are required:

- `--scope`
- `--provider`
- `--mode`
- `--model`
- `--reasoning-effort`
- `--description`

### Important prompt rule

`aiman` does not append a hidden runtime footer anymore. The agent body is the real prompt contract. If the agent should receive the caller's task, include `{{task}}` in the body.

### Shared runtime context

If your repo needs shared guidance for all `aiman` runs, configure shared bootstrap context file names in `~/.aiman/config.json` or `<repo>/.aiman/config.json`.

```json
{
   "contextFileNames": ["AGENTS.md", "CONTEXT.md"]
}
```

When configured, `aiman` passes those file names to the downstream provider's native context-discovery mechanism. If you do not configure them, `aiman` leaves bootstrap file selection to the provider's native behavior. Keep those files boring and stable: build/test commands, important paths, terminology, and safety rules. Keep task strategy and specialist behavior in the authored agent body instead.

For a drafting reference, see [`docs/agent-baseline.md`](./docs/agent-baseline.md).

For a stronger checklist on requirements, prompt shape, and reliability, see [`docs/agent-authoring.md`](./docs/agent-authoring.md).

Before first use, run `aiman agent check <name>`. It is a static validation pass: it does not launch the provider, probe MCPs, or require auth. Blocking errors fail with exit code `1`; warnings still exit `0`.

`reasoningEffort` is required, but the allowed values depend on the provider:

- `codex`: `none`, `low`, `medium`, or `high`
- `gemini`: `none`

Use `none` when the selected provider or model does not support configurable reasoning effort.

Agents that use old fields such as `permissions`, `contextFiles`, `skills`, or `requiredMcps` are invalid and should be rewritten to the current contract instead of migrated in place.

## Using `aiman` From A Main Agent

`aiman` works best as a specialist runner called by a broader parent agent, wrapper, or automation.

Typical pattern:

1. The main agent decides which specialist to use.
2. It calls `aiman run <agent> ...`.
3. It reads the result directly, or inspects the saved session if it needs more evidence.
4. It keeps orchestration, memory, and next-step decisions outside `aiman`.

For a synchronous handoff:

```bash
aiman run reviewer --scope project --task "Review the current diff"
```

For a machine-readable handoff:

```bash
aiman run reviewer --scope project --task "Review the current diff" --json
```

For background execution:

```bash
aiman run reviewer --scope project --task "Review the current diff" --detach --json
aiman runs show <run-id> --json
aiman runs logs <run-id> --follow
aiman runs inspect <run-id> --json
```

Practical rule:

- let the main agent own orchestration
- let `aiman` own one specialist run plus the persisted evidence
- let the downstream provider discover deeper repo context natively from the configured bootstrap files

## How Runs Work

When you run an agent, `aiman`:

1. Resolves the agent from project or user scope.
2. Validates provider-specific requirements.
3. Renders `prompt.md` from the agent body and runtime placeholders.
4. Freezes an immutable launch snapshot in `run.md`.
5. Launches the provider CLI.
6. Captures stdout, stderr, and final result.
7. Lets you inspect the saved run later with `runs` commands.

For detached runs, the worker reloads from the saved launch snapshot instead of re-reading the mutable agent file later.

Each run is stored under:

```text
~/.aiman/runs/<run-id>/
  run.md
  prompt.md
  stdout.log
  stderr.log
  artifacts/
```

`aiman` also keeps a global SQLite index at `~/.aiman/aiman.db`, so runs commands work from any working directory and do not depend on scanning a project-local runs folder.

## Providers, Permissions, and MCPs

### Providers

Current providers:

- `codex`
- `gemini`

### Modes

Agents declare their intended execution mode in frontmatter:

- `safe`
- `yolo`

If the caller passes an explicit mode override internally, it must still match the agent file. `aiman` will not silently widen or narrow access.

Provider behavior stays explicit:

- Codex `safe`: `codex exec --sandbox read-only`
- Codex `yolo`: `codex exec --sandbox workspace-write`
- Gemini `safe`: `gemini --approval-mode plan`
- Gemini `yolo`: `gemini --approval-mode auto_edit`
- Codex also uses per-command `--config` overrides so repo `AGENTS.md`, prompt-shaping project Codex instructions, and repo-defined Codex agent roles do not leak into authored `aiman` agents.
- Gemini also uses a child-local settings overlay passed only to the spawned run so `context.fileName` uses the shared configured bootstrap file names for the repo.

### Runtime context configuration

`aiman` no longer appends a managed runtime-context section into the prompt. Instead, it configures shared bootstrap context file names for the repo and lets the downstream provider discover them natively.

## Project vs User Scope

`aiman` can load agents from two places:

- project scope
- user scope

Default lookup prefers project scope when both define the same name. Use `--scope project` or `--scope user` when you want to force one side.

Home-level `~/.aiman` stays user scope only. It does not make `$HOME` count as a project root by itself, so project-specific agents still win only when you are actually inside a project that defines them.

## Human vs Machine Surfaces

`aiman` has both human-friendly text output and machine-friendly JSON output.

- Use normal command output when you're working in a terminal.
- Use `--json` when a wrapper or another tool needs structured data.
- Use `aiman` only from a real TTY when you want the interactive OpenTUI workbench.
- Use `aiman runs stop <run-id>` when you need to stop one active run from a non-TTY flow.

For automation and agentic tooling, prefer:

- `aiman runs list`
- `aiman runs show`
- `aiman runs logs`
- `aiman runs inspect`

## Development

### Useful commands

```bash
bun run dev
bun run install:global
bun run test
bun run test:provider-contract
bun run lint
bun run typecheck
bun run build
```

### Internal docs

If you want the deeper implementation details, start here:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`docs/agent-authoring.md`](./docs/agent-authoring.md)
- [`docs/agent-baseline.md`](./docs/agent-baseline.md)
- [`docs/cli.md`](./docs/cli.md)
- [`docs/agent-runtime.md`](./docs/agent-runtime.md)
- [`MEMORY.md`](./MEMORY.md)
