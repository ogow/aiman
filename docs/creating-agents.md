# Creating and Using Agents

`aiman` is easiest to use when each agent owns one narrow job and stops cleanly.

The default workflow is:

1. Create one agent.
2. Run `aiman agent check <name>`.
3. Run one tiny smoke task.
4. Inspect the run only if the result is weak or malformed.

## Choose One Output Style

Use one of these two lanes:

- `text`: for normal human-readable answers. This is the default.
- `schema`: for strict JSON when another tool really needs to parse the result.

Do not choose `schema` just because it feels cleaner. If a human is the real reader, `text` is usually more reliable and easier to maintain.

## Create An Agent

The lightest path is:

```bash
aiman agent create reviewer
```

The create command now asks for the minimum needed information:

- provider: `codex` or `gemini`
- one-sentence description of the job
- output style: `text` or `json`

Advanced flags such as `--model`, `--reasoning-effort`, and `--timeout-ms` still exist, but the normal path should not need them.

Generated agents include:

- a narrow role
- `{{task}}` wrapped in `<task>...</task>`
- default missing-evidence guidance
- explicit stop conditions
- an expected output section

## Run The Static Check

Use:

```bash
aiman agent check reviewer
```

The check is meant to catch the common reliability problems quickly:

- missing `{{task}}`
- missing XML wrapper around `{{task}}`
- missing stop conditions
- missing missing-evidence guidance
- weak output-shape guidance

## Run One Tiny Smoke Task

Keep the first task small enough to debug in one pass:

```bash
aiman run reviewer --task "Review src/api/client.ts for correctness risks."
```

For JSON agents, use a tiny task that makes malformed output obvious quickly.

## Inspect Only When Needed

If the run is weak, malformed, or surprising:

1. `aiman runs show <run-id>`
2. `aiman runs inspect <run-id> --stream prompt`
3. `aiman runs inspect <run-id> --stream run`
4. `aiman runs inspect <run-id> --stream stdout|stderr`

If you want guided help tightening one agent, explicitly use `$agent-hardening`.

## Later Project Usage

`aiman` does not orchestrate project workflows for you. A project harness or a human should decide:

- which agent to run
- what task packet to send
- what checks must pass afterward
- what the next step is

That is intentional. `aiman` is the agent-definition and execution layer, not the project workflow engine.
