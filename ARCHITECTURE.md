# Architecture

`aiman` is currently a small CLI-only project that manages specialist agents for external parent agents such as Codex, Gemini, or Claude Code.

## Current Shape

- [src/cli.ts](/Users/ogow/Code/aiman/src/cli.ts) is the executable entrypoint.
- [src/lib/cli.ts](/Users/ogow/Code/aiman/src/lib/cli.ts) builds the shared `yargs` instance.
- [src/cmd/index.ts](/Users/ogow/Code/aiman/src/cmd/index.ts) registers top-level command modules.
- [src/cmd/list.ts](/Users/ogow/Code/aiman/src/cmd/list.ts) lists available specialist agents.
- [src/cmd/show.ts](/Users/ogow/Code/aiman/src/cmd/show.ts) shows one specialist agent.
- [src/cmd/run.ts](/Users/ogow/Code/aiman/src/cmd/run.ts) is the primary execution entrypoint for running one specialist on behalf of an external caller.
- [src/cmd/inspect.ts](/Users/ogow/Code/aiman/src/cmd/inspect.ts) exposes persisted run inspection and log access through one debug command.
- [src/lib/agents.ts](/Users/ogow/Code/aiman/src/lib/agents.ts) loads the small agent catalog from `.aiman/agents/`, validates frontmatter, and resolves agents by file id or listed name.
- [src/lib/report.ts](/Users/ogow/Code/aiman/src/lib/report.ts) parses optional run-level `report.md` handoff files, preserves the Markdown body, and resolves referenced artifacts inside each run directory.
- [src/lib/runs.ts](/Users/ogow/Code/aiman/src/lib/runs.ts) orchestrates one specialist run from validation through subprocess completion.
- [src/lib/run-store.ts](/Users/ogow/Code/aiman/src/lib/run-store.ts) owns persisted run files under `.aiman/runs/` plus the slim external result envelope.
- [src/lib/providers/index.ts](/Users/ogow/Code/aiman/src/lib/providers/index.ts) selects the strict provider adapters for `codex` and `gemini`.
- [src/lib/providers/shared.ts](/Users/ogow/Code/aiman/src/lib/providers/shared.ts) keeps the shared prompt, environment, and result-normalization helpers small and boring.

## Conventions

- Keep the CLI bootstrap thin.
- Prefer one command module per command or subcommand.
- Keep user-facing behavior simple and explicit.
- Prefer a flat command surface when the behavior does not need nested namespaces.
- Add focused utility modules in `src/lib/` when behavior is shared or worth testing independently.
- Keep agent loading catalog-based and simple; the repo is small enough that clarity matters more than micro-optimizing file lookups.
- Keep run persistence boring and explicit; store files on disk instead of hiding state behind extra abstractions.
- Keep structured specialist handoff file-first: optional `report.md` plus `artifacts/` live inside each run directory.
- Keep authored agent prompts provider-native; only execution metadata is normalized.
- Keep orchestration outside `aiman`; the caller chooses which specialist to run and what to do next.
- Return slim machine-readable output from `aiman run ... --json`; keep full execution metadata on disk and expose it through `aiman inspect`.
- Avoid adding runtime APIs before the CLI or tests actually need them.
