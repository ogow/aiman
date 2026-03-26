# Contributing

## Setup

1. Install dependencies with `npm install`.
2. Run `npm run check` before opening a pull request.

## Development commands

- `npm start -- agent list` runs the CLI from source.
- `npm run lint` runs static analysis.
- `npm run typecheck` runs TypeScript checks without building.
- `npm test` runs the test suite.
- `npm run build` compiles the CLI to `dist/`.
- `npm run coverage` generates a coverage report with `c8`.
- `npm run check` runs the full local quality gate.

## Project layout

- `src/` contains the CLI entrypoint, command modules, and runtime code.
- `test/` contains end-to-end and unit tests using Node's built-in test runner.
- `docs/` contains architecture, storage, and roadmap notes.
- `.aiman/` contains workspace-local agent and run state during development.

## Pull requests

- Keep changes focused on one concern.
- Add or update tests for behavior changes.
- Update docs when command behavior, configuration, or storage expectations change.
- Include a short summary and note how you verified the change.
