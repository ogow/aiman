# `aiman`

> **The human-first agent workbench.** AUTHOR agents as simple Markdown files, RUN them with a reliable engine, and INSPECT everything through a dedicated TUI.

`aiman` is a lightweight terminal engine for running one agent at a time. It focuses on keeping a trustworthy, structured record of every run, making it the perfect "engine" for project-specific orchestration and loops.

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Create your first Agent

```bash
bun run dev agent create reviewer \
  --description "Reviews project diffs" \
  --instructions "Analyze the current changes and report bugs." \
  --provider codex \
  --model gpt-5.4-mini \
  --reasoning-effort medium
```

### 3. Run the Agent

```bash
bun run dev run reviewer --task "Check my latest commit"
```

### 4. Open the Workbench

Run without arguments to enter the interactive TUI:

```bash
bun run dev
```

---

## 🧠 Core Concepts

- **Agent**: A Markdown file (`.md`) with YAML frontmatter. It defines a specialist's identity, model, and instructions.
- **Run**: A single execution of an agent. `aiman` records the prompt, logs, artifacts, and a canonical `result.json`.
- **Harness**: The project-level environment (context files and safety rules) where agents operate.
- **Orchestration**: Coordination logic (like loops) handled by project-local scripts that call the `aiman` API.

---

## 🛠 Usage

### The Interactive Workbench (TUI)

Launch `aiman` with no arguments to manage agents, track active runs, and inspect results in a keyboard-first terminal interface.

### CLI Command Groups

- **`aiman agent <command>`**: List, create, show, and check agent definitions.
- **`aiman run <agent>`**: Execute an agent in the foreground or detached mode.
- **`aiman runs <command>`**: Browse history, follow logs, or inspect the technical details of a run.

### Global Installation

To use `aiman` as a global command in any repo:

```bash
bun run install:global
aiman --help
```

---

## 🔄 Orchestration & Flows

`aiman` is designed to be consumed programmatically. You can build autonomous loops by importing the `aiman` API into your own scripts.

- **[Ralph Wiggum Loop](./examples/ralph-loop.ts)**: The simplest autonomous pattern—an agent suggests its own next tasks until the job is done.
- **[The Blueprint Loop](./examples/blueprint-loop.ts)**: A more structured example using specialized roles (Planner/Generator) and deterministic test checks.
- **[Orchestration Guide](./docs/orchestration.md)**: Detailed guidance on building loops, harnesses, and flows.

---

## 🧑‍💻 Development

```bash
bun run check      # Run formatting, linting, typecheck, and tests
bun run format     # Fix code style
bun run build      # Build the project
bun run test       # Run the test suite
```

### Internal Documentation

- [**Architecture**](./ARCHITECTURE.md) - How the engine is built.
- [**Agent Runtime**](./docs/agent-runtime.md) - Details on execution and results.
- [**Agent Authoring**](./docs/agent-authoring.md) - How to write effective specialists.
- [**Memory**](./MEMORY.md) - Project truths and daily logs.
