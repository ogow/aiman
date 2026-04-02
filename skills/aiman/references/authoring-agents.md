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

Resolution behavior:

- project scope first: `<repo>/.agents/skills/`
- user scope second: `~/.agents/skills/`

Use `aiman skill list` to confirm the exact resolved name before declaring it.

## Required MCPs

Use `requiredMcps:` when the authored agent requires named MCP servers to be ready before launch.

Behavior:

- `aiman run` checks those names through the selected provider CLI before launch
- launch fails fast when a requirement is not met

## Authoring Workflow

1. Create the file with `aiman agent create <name> ...`
2. Open the generated file and refine the body
3. Ensure the body includes `{{task}}` for runnable agents
4. Add `skills:` or `requiredMcps:` manually if needed
5. Run `aiman agent show <name>` to verify the authored contract
6. Run the agent with a small task before using it broadly

## Practical Defaults

- Start with `permissions: read-only`
- Prefer a direct, explicit body over clever templating
- Keep descriptions short and concrete so `agent list` output stays readable
- Add `reasoningEffort` only when the selected provider supports it
