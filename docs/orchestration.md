# Orchestration Guide

`aiman` is a low-level engine designed to run one agent at a time. To achieve autonomous goals, you should build simple scripts that consume the `aiman` API.

## Pattern 1: The Ralph Wiggum Loop (Simplest)

This is the preferred starting point for most tasks. You run a single agent repeatedly, and in each turn, the agent provides a `handoff.nextTask` suggestion. The loop continues until the agent stops suggesting tasks.

### Why it works:
- **Low Overhead**: No complex state machine to manage.
- **Agent-Led**: The agent decides what it needs to do next based on the actual state of the repo.
- **Zero Config**: Works with any standard agent that respects the JSON success contract.

See [`examples/ralph-loop.ts`](../examples/ralph-loop.ts) for a standalone implementation.

---

## Pattern 2: The Blueprint Harness (Advanced)

As your tasks get more complex, you may want to move away from purely agent-led loops and toward **deterministic harnesses**. 

### The 5 Principles of Blueprints:
1.  **Interleave Deterministic and Agentic Nodes**: Run hardcoded shell commands (`bun test`, `git push`) between agent runs to ensure operational steps never fail.
2.  **Specialized Personas**: Route work through a Planner (writes `Plan.md`), a Generator (writes code), and an Evaluator (verifies result).
3.  **Context Resets**: Use fresh `aiman` runs for every step to prevent "context rot" in long chat threads.
4.  **Cap the Self-Correction**: Limit automated fix attempts (e.g., max 2 retries) before escalating to a human.
5.  **Progressive Disclosure**: Keep `AGENTS.md` short; only load deep skill mechanics when explicitly triggered.

See [`examples/blueprint-loop.ts`](../examples/blueprint-loop.ts) for a robust implementation of this pattern.

---

## Instructions for Agents

If you are an AI agent helping to build a flow in this repository:

1.  **Start with a Ralph Loop**: Don't over-engineer unless the task requires strict validation or multiple specialists.
2.  **Use the `createAiman` API**: It is the most reliable way to interact with the engine.
3.  **State via Files**: Communicate between loop iterations by reading and writing repository files (`Plan.md`, `Error.md`).
