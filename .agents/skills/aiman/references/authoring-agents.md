# Authoring Aiman Agents

Use this file when creating or updating agent files for `aiman`.

## Agent File Shape

An `aiman` agent is a Markdown file with YAML frontmatter and a provider-native prompt body.

Required frontmatter:

- `name`
- `provider`
- `description`
- `permissions`
- `model`

Optional frontmatter:

- `reasoningEffort`
- `contextFiles`
- `skills`
- `requiredMcps`

## Prompt Contract

- The body is the full authored prompt contract.
- `aiman` does not append a hidden runtime footer.
- Use explicit placeholders only when the body needs them.

Supported placeholders:

- `{{task}}`
- `{{cwd}}`
- `{{mode}}`
- `{{runId}}`
- `{{runFile}}`
- `{{artifactsDir}}`

Rule:

- Runnable agents should include `{{task}}`.

## Permissions

Allowed values:

- `read-only`
- `workspace-write`

Behavior:

- The agent file is the source of truth.
- `aiman run --mode ...` must match the file's declared permissions.
- A mismatch fails fast instead of silently widening or narrowing access.

## Skills

Use `skills:` when the authored agent expects installed skills to be available through the downstream runtime.

Behavior:

- `aiman` records the declared names in launch metadata
- actual skill discovery and use stay with the downstream provider runtime

Use `aiman skill list` to confirm the exact resolved name before declaring it.

## Context Files

Use `contextFiles:` for stable repo guidance that should be attached explicitly.

Behavior:

- entries must be repo-relative
- entries must stay under the project root
- duplicates and missing files fail fast
- attached file contents are appended as a labeled `Project Context` section

Prefer `contextFiles` for baseline docs, architecture notes, or narrow subsystem references. Keep task-specific guidance in `{{task}}` instead.

## Requirement Checklist

Before creating the file, make sure you know:

- the exact job the agent should own
- the expected output shape
- whether it truly needs `workspace-write`
- the intended provider and model
- whether stable repo guidance should be attached through `contextFiles`
- whether provider-native `skills` are needed
- whether `requiredMcps` should fail fast before launch
- what a small smoke task should look like

## Required MCPs

Use `requiredMcps:` when the authored agent requires named MCP servers to be ready before launch.

Behavior:

- `aiman run` checks those names through the selected provider CLI before launch
- launch fails fast when a requirement is not met

## Authoring Workflow

1. Gather the missing contract details first
2. Create the file with `aiman agent create <name> ...`
3. Open the generated file and refine the body
4. Ensure the body includes `{{task}}` for runnable agents
5. Add `contextFiles:`, `skills:`, or `requiredMcps:` manually if needed
6. Run `aiman agent show <name>` to verify the authored contract
7. Run `aiman agent check <name>` to catch blocking errors and structural warnings
8. Run the agent with a small task before using it broadly

## Practical Defaults

- Start with `permissions: read-only`
- Keep one agent focused on one specialty
- Prefer a direct, explicit body over clever templating
- Keep descriptions short and concrete so `agent list` output stays readable
- Add `reasoningEffort` only when the selected provider supports it
- Put reusable repo guidance in `contextFiles`, not inline in every task
- Make constraints, uncertainty handling, and expected output shape explicit

## Static Validation

`aiman agent check <name>` is the static authoring validator.

- blocking errors exit `1`
- warnings still exit `0`
- `--json` returns separate `errors` and `warnings`
- the command does not run the provider or probe MCP state
