# Architecture

`aiman` is a small human-first terminal workbench. It runs one agent at a time, persists one canonical run record, and exposes the same core behavior through an importable package API, a CLI, and the default OpenTUI workbench.

## Current Shape

- [src/index.ts](/Users/ogow/Code/aiman/src/index.ts) is the package root. External scripts should import `createAiman()` from here instead of reaching into internal modules.
- [src/api/client.ts](/Users/ogow/Code/aiman/src/api/client.ts) is the public facade. It binds one resolved project root and exposes grouped `agents`, `projectContext`, `runs`, and `workbench` methods.
- [src/api/types.ts](/Users/ogow/Code/aiman/src/api/types.ts) defines the script-facing package surface without exposing the full internal `lib/` type graph.
- [src/cli.ts](/Users/ogow/Code/aiman/src/cli.ts) is the executable entrypoint.
- [src/lib/cli.ts](/Users/ogow/Code/aiman/src/lib/cli.ts) builds the shared `yargs` instance and sends `aiman` with no args into the interactive app.
- [src/cmd/index.ts](/Users/ogow/Code/aiman/src/cmd/index.ts) registers the public `agent`, `run`, and `runs` surfaces plus the hidden detached-worker command.
- The command handlers under [src/cmd/](/Users/ogow/Code/aiman/src/cmd) are thin adapters over the package facade. They should stay presentation-focused and avoid embedding domain logic.
- [src/cmd/internal-run.ts](/Users/ogow/Code/aiman/src/cmd/internal-run.ts) remains the hidden worker command for detached runs.
- [src/lib/config.ts](/Users/ogow/Code/aiman/src/lib/config.ts) loads layered home and project `aiman` config, including the shared native context file list used by all agents in a repo.
- [src/lib/agents.ts](/Users/ogow/Code/aiman/src/lib/agents.ts) owns the strict agent catalog, validation, and agent-file creation.
- [src/lib/project-context.ts](/Users/ogow/Code/aiman/src/lib/project-context.ts) remains the helper for operator-facing inspection of repo guidance, but run launches now rely on provider-native context discovery instead of injecting that content into prompts.
- [src/lib/runs.ts](/Users/ogow/Code/aiman/src/lib/runs.ts) owns run preparation, detached launch, hidden-worker execution, foreground execution, and stop behavior.
- [src/lib/run-store.ts](/Users/ogow/Code/aiman/src/lib/run-store.ts) owns persisted run files under `~/.aiman/runs/`, including the canonical `run.md` record and operator-facing derived read state.
- [src/lib/run-index.ts](/Users/ogow/Code/aiman/src/lib/run-index.ts) keeps the global SQLite run index in sync with `run.md`.
- [src/lib/run-doc.ts](/Users/ogow/Code/aiman/src/lib/run-doc.ts) reads and writes Markdown run documents with `gray-matter`.
- [src/lib/run-output.ts](/Users/ogow/Code/aiman/src/lib/run-output.ts) reads and follows persisted stdout/stderr without a daemon layer.
- [src/lib/run-render.ts](/Users/ogow/Code/aiman/src/lib/run-render.ts) centralizes the human-readable plain-text views used by the non-TTY CLI.
- [src/lib/providers/](/Users/ogow/Code/aiman/src/lib/providers) contains the provider adapters and shared prompt assembly helpers.
- [src/lib/paths.ts](/Users/ogow/Code/aiman/src/lib/paths.ts) centralizes project-root discovery, scoped agent roots, the global run layout, and the run-index location.
- [src/tui/aiman-app.tsx](/Users/ogow/Code/aiman/src/tui/aiman-app.tsx) is the OpenTUI workbench controller. It manages workspace state, keyboard routing, async refresh, launching, and stop actions.
- [src/tui/workbench-shell.tsx](/Users/ogow/Code/aiman/src/tui/workbench-shell.tsx) contains the shared workbench chrome.
- [src/tui/workbench-workspaces.tsx](/Users/ogow/Code/aiman/src/tui/workbench-workspaces.tsx) contains the `start`, `agents`, `tasks`, and `runs` workspace views.
- [src/tui/workbench-model.ts](/Users/ogow/Code/aiman/src/tui/workbench-model.ts) holds the stable view-model helpers and shared workbench enums.

## Boundaries

- Treat [src/index.ts](/Users/ogow/Code/aiman/src/index.ts) and [src/api/client.ts](/Users/ogow/Code/aiman/src/api/client.ts) as the stable script-facing contract.
- Keep `src/cmd/` thin. If logic is worth testing or reuse, move it into `src/lib/` or the public facade.
- Keep provider-neutral domain behavior in `src/lib/`; keep React and TSX inside `src/tui/`.
- Keep run persistence file-first and explicit. `run.md` is canonical; prompt/log/artifact paths are derived from the run directory.
- Keep repo bootstrap context shared at the harness level through layered config; agents should not override context file names individually.
- Keep the workbench keyboard-first and deterministic. Launch-critical task entry should not depend on hidden renderer focus state.
- Prefer forward-only cleanup over compatibility shims while the project is still moving quickly.
