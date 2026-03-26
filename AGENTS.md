# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the CLI and runtime code.
- `src/cli.ts` is the main executable entry point.
- `src/lib/` holds focused modules such as the agent registry, run store, runner, context assembly, and error handling.
- `test/` contains Node test files named `*.test.ts`.
- `docs/` contains the current architecture, storage, and roadmap docs, plus earlier conversation notes.
- `.aiman/` is runtime state, not source. It stores workspace-local agents, runs, and traces.

## Build, Test, and Development Commands

- `npm start`: runs the CLI from source with `tsx`.
- `npm run build`: compiles TypeScript to `dist/`.
- `npm run typecheck`: runs TypeScript without emitting build output.
- `npm run lint`: runs ESLint across `src/` and `test/`.
- `npm run format`: formats the repo with Prettier.
- `npm run format:check`: verifies formatting without changing files.
- `npm run coverage`: runs tests with `c8` coverage reporting.
- `npm run check`: runs format, lint, typecheck, tests, and build as one quality gate.
- `npm test`: runs the full test suite with Node’s built-in test runner.

Examples:

```bash
npm start
npm run build
npm run typecheck
npm run lint
npm run format:check
npm run coverage
npm run check
npm test
```

## Coding Style & Naming Conventions

- Use modern Node.js ESM with TypeScript source files.
- Prefer small single-purpose files in `src/lib/`.
- Use 2-space indentation and keep code straightforward over abstract.
- Use `camelCase` for variables and functions, `PascalCase` for classes, and kebab-free JSON agent names unless there is a strong reason otherwise.
- Keep error messages direct and user-facing; this repo already formats tool errors clearly.
- ESLint and Prettier are part of the default workflow; keep changes compliant with both.

## Testing Guidelines

- Tests use Node’s built-in `node:test` and `assert/strict`.
- Add or update tests for any behavior change in registry loading, run orchestration, storage, or tool handling.
- Name tests as `*.test.ts` and keep fixtures local to the test using temp directories.
- Run `npm test` before opening a PR.

## Commit & Pull Request Guidelines

- No reliable git history is available in this workspace, so use short imperative commit messages such as `Add project-precedence agent merge`.
- Keep commits focused on one concern.
- PRs should include:
- a short summary
- the behavior change
- test coverage notes
- any storage or CLI contract changes

## Architecture Notes

- Agents are loaded from both `~/.aiman/agents/` and `<repo>/.aiman/agents/`.
- If the same agent exists in both places, the project copy wins.
- Runs and traces always stay in the repo-local `.aiman/` directory.
- Skills are not managed by `aiman`; keep provider-native skills in `~/.agents/skills/` and `<repo>/.agents/skills/`.
- Agent configuration is authored as Markdown files with YAML frontmatter and a Markdown prompt body. The supported frontmatter is intentionally minimal: `name`, `provider`, and optional `description`/`model`/`reasoningEffort`. `reasoningEffort` is provider/model-specific, not a global enum.
