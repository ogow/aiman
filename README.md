# aiman

![aiman banner](docs/aiman-banner.svg)

`aiman` is a lightweight CLI for reusable coding agents.

It keeps a small registry of provider-specific agent prompts, runs those agents through local CLIs like `codex`, `claude`, or `gemini`, and stores run state locally in the repo so the work stays close to the codebase.

## Why This Exists

- Reuse the same specialists across projects without copying prompts around by hand.
- Keep agent prompts provider-native instead of forcing one fake universal format.
- Run agents through the CLIs you already use.
- Keep execution state local in `.aiman/` so runs and traces stay attached to the repo they belong to.

## Install

```bash
npm install
```

Run the CLI locally with:

```bash
npm start -- agent list
```

Or invoke it directly:

```bash
tsx src/cli.ts agent list
```

## Core Model

`aiman` manages two things:

- `agent`: a reusable Markdown file that describes a specialist
- `run`: one execution of that agent against a task

Authored agents are intentionally small:

```md
---
name: code-reviewer
provider: codex
description: Reviews code for risks and quality
model: gpt-5.4
reasoningEffort: medium
---

Review the current change carefully.
Focus on correctness, regressions, and missing tests.
Use provider-native references like @files or $skills when that CLI supports them.
```

The Markdown body is passed through as-is to the downstream CLI.

## CLI Usage

### Agent commands

```bash
aiman agent list
aiman agent get code-reviewer
aiman agent create --name code-reviewer --provider codex --model gpt-5.4 --reasoning-effort high --prompt "Review the working tree for regressions."
```

You can also provide prompt text from a file or stdin:

```bash
aiman agent create --name reviewer --provider codex --prompt-file prompt.md
cat prompt.md | aiman agent create --name reviewer --provider codex
```

### Run commands

```bash
aiman run spawn --agent code-reviewer --task "Review the current changes before release."
aiman run list
aiman run get <run-id>
aiman run wait <run-id> --timeout-ms 30000
aiman run cancel <run-id>
aiman run logs <run-id> --limit 100
```

You can also provide task text from a file or stdin:

```bash
aiman run spawn --agent code-reviewer --task-file task.md
git diff | aiman run spawn --agent code-reviewer
```

Add `--json` to any command for stable machine-readable output.

## Quality Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run coverage
npm run check
```

`npm run check` is the main local quality gate. It runs formatting checks, linting, type-checking, tests, and a production build.

## How It Works

1. `aiman` loads agents from:
   - `~/.aiman/agents/*.md`
   - `<workspace>/.aiman/agents/*.md`
2. If an agent exists in both places, the project copy wins.
3. When you spawn a run, `aiman`:
   - resolves the visible agent
   - prepends repo instructions from `AGENTS.md` when present
   - adds the task prompt
   - asks the provider adapter how to invoke the CLI
   - stores run metadata in `.aiman/state.json`
   - appends trace events in `.aiman/traces/<run-id>.jsonl`
   - launches a detached worker so later `run wait`, `run cancel`, and `run logs` calls can inspect the same run

## Agent Format

Supported frontmatter:

- `name` required
- `provider` required
- `description` optional
- `model` optional
- `reasoningEffort` optional

Rules:

- Agent files must be Markdown files in `.aiman/agents/`.
- Frontmatter must be valid YAML.
- Unknown frontmatter keys are rejected.
- The Markdown body must be non-empty.
- `reasoningEffort` is validated against the selected provider/model pair, not globally.

## Project Layout

```text
.aiman/
  agents/
    code-reviewer.md
  state.json
  traces/
    <run-id>.jsonl
AGENTS.md
src/
test/
```

## Notes

- `AGENTS.md` is treated as repo-level instruction context and is prepended to the run prompt when present.
- Skills are not managed by `aiman`. Provider-native skills should stay in the standard skill folders used by the downstream CLI.
- `reasoningEffort` is structured execution metadata, not prompt text. Provider adapters validate and translate it per CLI, so the accepted values can differ by provider and model.
- The provider adapter decides how to invoke each CLI. Authored agent files stay focused on identity and prompt text.
- Runs can set an optional `timeoutMs` to fail and terminate long-running processes.

## Docs

- [architecture.md](/Users/ogow/Code/aiman/docs/architecture.md)
- [storage.md](/Users/ogow/Code/aiman/docs/storage.md)
- [roadmap.md](/Users/ogow/Code/aiman/docs/roadmap.md)
- [CONTRIBUTING.md](/Users/ogow/Code/aiman/CONTRIBUTING.md)
- [SECURITY.md](/Users/ogow/Code/aiman/SECURITY.md)
