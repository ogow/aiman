# Architecture

`aiman` is currently a small CLI-only project that manages specialist agents for external parent agents such as Codex, Gemini, or Claude Code.

## Current Shape

- [src/cli.ts](/Users/ogow/Code/aiman/src/cli.ts) is the executable entrypoint.
- [src/lib/cli.ts](/Users/ogow/Code/aiman/src/lib/cli.ts) builds the shared `yargs` instance.
- [src/cmd/index.ts](/Users/ogow/Code/aiman/src/cmd/index.ts) registers top-level command modules.
- [src/cmd/list.ts](/Users/ogow/Code/aiman/src/cmd/list.ts) lists available specialist agents.
- [src/cmd/create.ts](/Users/ogow/Code/aiman/src/cmd/create.ts) creates structured project-scope or user-scope agent files.
- [src/cmd/show.ts](/Users/ogow/Code/aiman/src/cmd/show.ts) shows one specialist agent.
- [src/cmd/run.ts](/Users/ogow/Code/aiman/src/cmd/run.ts) is the primary execution entrypoint for running one specialist on behalf of an external caller.
- [src/cmd/inspect.ts](/Users/ogow/Code/aiman/src/cmd/inspect.ts) exposes persisted run inspection and log access through one debug command.
- [src/lib/agents.ts](/Users/ogow/Code/aiman/src/lib/agents.ts) loads the small agent catalog from both project and user scope, validates frontmatter, resolves agents with project precedence, and scaffolds new agent files.
- [src/lib/run-doc.ts](/Users/ogow/Code/aiman/src/lib/run-doc.ts) reads and writes the canonical `run.md` file with `gray-matter`, while resolving any referenced artifacts inside each run directory.
- [src/lib/runs.ts](/Users/ogow/Code/aiman/src/lib/runs.ts) orchestrates one specialist run from validation through subprocess completion, timeout handling, log capture, and persisted result writing.
- [src/lib/run-store.ts](/Users/ogow/Code/aiman/src/lib/run-store.ts) owns persisted run files under `.aiman/runs/`, with `run.md` as the canonical record plus run-directory-derived prompt/log/artifact paths.
- [src/lib/providers/index.ts](/Users/ogow/Code/aiman/src/lib/providers/index.ts) selects the strict provider adapters for `codex` and `gemini`.
- [src/lib/providers/shared.ts](/Users/ogow/Code/aiman/src/lib/providers/shared.ts) keeps the shared prompt, environment allowlist, and result-normalization helpers small and boring.
- [src/lib/paths.ts](/Users/ogow/Code/aiman/src/lib/paths.ts) centralizes project/user agent roots and run-directory layout.
- [src/lib/task-input.ts](/Users/ogow/Code/aiman/src/lib/task-input.ts) enforces the CLI task-input contract for `--task` vs stdin.

## Conventions

- Keep the CLI bootstrap thin.
- Prefer one command module per command or subcommand.
- Keep user-facing behavior simple and explicit.
- Prefer a flat command surface when the behavior does not need nested namespaces.
- Add focused utility modules in `src/lib/` when behavior is shared or worth testing independently.
- Keep agent loading catalog-based and simple; the repo is small enough that clarity matters more than micro-optimizing file lookups.
- Keep agent scope explicit on creation, but let lookup consider both project and user scope by default and prefer project scope on name collisions.
- Keep run persistence boring and explicit; store files on disk instead of hiding state behind extra abstractions.
- Keep the canonical run record file-first: `run.md` carries deterministic frontmatter plus the final Markdown body, and `artifacts/` remains optional.
- Keep prompt/log/artifact files optional and inspectable rather than mandatory outputs, but derive their default locations from the run directory instead of duplicating path metadata in `run.md`.
- Keep authored agent prompts provider-native; only execution metadata is normalized.
- Keep provider-specific options honest: Codex supports `reasoningEffort` through CLI config, while unsupported providers should fail clearly instead of silently ignoring it.
- Prefer forward-only cleanup over backward-compatibility shims while the project is still changing quickly.
- Keep orchestration outside `aiman`; the caller chooses which specialist to run and what to do next.
- Return slim machine-readable output from `aiman run ... --json`; keep full execution metadata on disk and expose it through `aiman inspect`.
- Avoid adding runtime APIs before the CLI or tests actually need them.
