# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the MCP server and runtime code.
- `src/index.mjs` is the entry point.
- `src/lib/` holds focused modules such as the agent registry, run store, runner, context assembly, and error handling.
- `test/` contains Node test files named `*.test.mjs`.
- `docs/` contains the current architecture, storage, and roadmap docs, plus earlier conversation notes.
- `.aiman/` is runtime state, not source. It stores workspace-local agents, runs, and traces.

## Build, Test, and Development Commands

- `npm start`: runs the MCP server over stdio.
- `npm test`: runs the full test suite with Node’s built-in test runner.

Examples:

```bash
npm start
npm test
```

## Coding Style & Naming Conventions

- Use modern Node.js ESM with explicit `.mjs` modules.
- Prefer small single-purpose files in `src/lib/`.
- Use 2-space indentation and keep code straightforward over abstract.
- Use `camelCase` for variables and functions, `PascalCase` for classes, and kebab-free JSON agent names unless there is a strong reason otherwise.
- Keep error messages direct and user-facing; this repo already formats tool errors clearly.
- No formatter or linter is configured yet, so match the existing style closely.

## Testing Guidelines

- Tests use Node’s built-in `node:test` and `assert/strict`.
- Add or update tests for any behavior change in registry loading, run orchestration, storage, or tool handling.
- Name tests as `*.test.mjs` and keep fixtures local to the test using temp directories.
- Run `npm test` before opening a PR.

## Commit & Pull Request Guidelines

- No reliable git history is available in this workspace, so use short imperative commit messages such as `Add project-precedence agent merge`.
- Keep commits focused on one concern.
- PRs should include:
- a short summary
- the behavior change
- test coverage notes
- any storage or MCP tool contract changes

## Architecture Notes

- Agents are loaded from both `~/.aiman/agents/` and `<repo>/.aiman/agents/`.
- If the same agent exists in both places, the project copy wins.
- Runs and traces always stay in the repo-local `.aiman/` directory.
- Skills are not managed by `aiman`; keep provider-native skills in `~/.agents/skills/` and `<repo>/.agents/skills/`.
- Agent configuration is authored as Markdown files with YAML frontmatter and a Markdown prompt body. The supported frontmatter is intentionally minimal: `name`, `provider`, and optional `description`/`model`.
