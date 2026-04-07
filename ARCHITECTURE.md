# Architecture

`aiman` is a small human-first terminal workbench. It runs one agent at a time, persists one canonical run record, and exposes the same core behavior through an importable package API, a CLI, and the default OpenTUI workbench.

## Core Shape

- **Agent Management**: Owns the strict agent catalog, validation, and agent-file creation.
- **Execution Engine**: Manages run preparation, provider adapters (Codex, Gemini), and execution supervision.
- **Persistence**: Owns persisted run files under `~/.aiman/runs/`, including the canonical `result.json` record.
- **Workbench**: The interactive OpenTUI terminal application.
- **CLI**: Provides the `aiman` binary with `agent`, `run`, and `runs` command groups.
- **API**: Exposes the `createAiman()` package facade for programmatic use.

## Orchestration & Harnesses

`aiman` does not include a built-in orchestration engine. Instead, it is designed to be the "engine" for project-specific orchestration flows.

- **Harnesses**: Environment wrappers that provide context and validation for agent runs.
- **Loops**: Iterative patterns where an agent refines its work based on its own suggested next tasks.
- **Flows**: Chained specialists working together to achieve a goal.

Orchestration logic is maintained in standalone TypeScript scripts (e.g., `examples/ralph-loop.ts`) that import the `aiman` API. This keeps the core engine simple and allows for highly customized, project-specific coordination logic.

## Key Boundaries

- Treat `src/index.ts` and `src/api/client.ts` as the stable script-facing contract.
- Keep the CLI thin. If logic is worth testing or reuse, move it into the library or the public facade.
- Keep run persistence file-first and explicit. `result.json` is canonical; logs and `artifacts/` are supporting evidence.
