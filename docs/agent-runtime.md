# Agent Runtime

`aiman` is a small local agent runner. It launches one authored specialist, records one canonical `run.json`, and makes the run easy to inspect.

## Runtime Boundaries

`aiman` does:

- load authored agents from project, user, and built-in scopes
- render prompts from authored Markdown plus runtime placeholders
- apply provider defaults for omitted agent settings
- append the strict JSON contract only for schema-mode agents
- launch Codex or Gemini safely
- persist logs, artifacts, and one canonical `run.json`
- expose runs through `aiman run` and `aiman runs ...`

`aiman` does not:

- own project workflow
- route between agents
- decide retries or follow-up work
- replace a project harness

## Authored Agent Model

New agent authoring should think in this public shape:

- required `name`
- required `provider`
- required `description`
- optional `resultMode`
- optional `model`
- optional `reasoningEffort`
- optional `timeoutMs`
- Markdown body containing `{{task}}`

Provider defaults:

- Codex defaults to `model: gpt-5.4-mini` and `reasoningEffort: medium`
- Gemini defaults to `model: auto` and `reasoningEffort: none`

Supported runtime placeholders:

- `{{task}}`
- `{{cwd}}`
- `{{runId}}`
- `{{runFile}}`
- `{{artifactsDir}}`

## Result Modes

`text`

- default mode
- stores the final answer as `finalText`

`schema`

- strict JSON mode
- requires these top-level keys:
   - `summary`
   - `outcome`
   - `result`

The public JSON contract is intentionally small. Follow-up routing belongs outside the authored agent.

Compatibility note:

- the runtime still tolerates older schema payloads that include optional `next`
- authored agents should no longer teach or depend on that field in the normal product path

## Run Storage

Runs live under:

```text
~/.aiman/runs/<YYYY-MM-DD>/<timestamp-run-id>/
```

Typical files:

- `run.json`
- `stdout.log`
- `stderr.log`
- `artifacts/`

`run.json` is the canonical machine-readable record. Logs and artifacts are supporting evidence.

## Provider Isolation

- Codex runs use `codex exec --sandbox workspace-write --skip-git-repo-check`
- Gemini runs use `gemini --approval-mode yolo`
- both providers run with explicit argv and an allowlisted environment
- provider adapters normalize provider-specific output into one shared completion shape

The adapter layer is where provider quirks should be handled. Agent authors should not need provider-specific prompt hacks for normal success parsing.

## Debugging Order

When a run is weak or malformed:

1. `aiman runs show <run-id>`
2. `aiman runs inspect <run-id> --stream prompt`
3. `aiman runs inspect <run-id> --stream run`
4. `aiman runs inspect <run-id> --stream stdout|stderr`
