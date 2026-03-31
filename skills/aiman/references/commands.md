# Aiman Commands

Use this file when you need the concrete command surface or exact flags.

These commands are `aiman` CLI commands, not host-agent commands. Use them the same way whether the current host agent is Codex, Gemini, OpenCode, or another client.

## Command Choice

- Discover agents: `aiman agent list`
- Inspect one agent: `aiman agent show <agent>`
- Create a new agent file: `aiman agent create <name> ...`
- Discover skills: `aiman skill list`
- Install a skill bundle: `aiman skill install [source]`
- Run an agent now: `aiman run <agent> ...`
- List live or recent sessions: `aiman sesh list`
- Read compact run status: `aiman sesh show <runId>`
- Read or follow logs: `aiman sesh logs <runId>`
- Inspect persisted evidence: `aiman sesh inspect <runId>`
- Do not use from agents: `aiman sesh top`

## Global Flags

- `-h`, `--help`
- `-v`, `--version`

## `aiman agent list`

List available specialist agents.

Flags:

- `--scope project|user`: limit listing to one scope
- `--json`: print machine-readable output

## `aiman agent show <agent>`

Show one specialist agent.

Flags:

- `--scope project|user`: resolve from one scope only
- `--json`: print machine-readable output

Use this before running an unfamiliar agent so you can confirm:

- provider
- permissions
- declared skills
- required MCPs

## `aiman agent create <name>`

Create an authored agent file.

Required flags:

- `--scope project|user`
- `--provider codex|gemini`
- `--description <text>`
- `--model <id>`

Optional flags:

- `--permissions read-only|workspace-write`
- `--instructions <text>`
- `--reasoning-effort low|medium|high`
- `--force`
- `--json`

Behavior notes:

- `--permissions` defaults to `read-only`.
- Instructions can come from `--instructions` or stdin.
- New runnable agents should include `{{task}}`.

## `aiman skill list`

List available skills.

Flags:

- `--scope project|user`: limit listing to one scope
- `--json`: print machine-readable output

## `aiman skill install [source]`

Install one reusable skill bundle.

Flags:

- `--scope project|user`: install into one scope; defaults to `project`
- `--path <repo-subdir>`: choose one bundled skill inside a repo when needed
- `--force`: replace an existing installed copy
- `--json`: print machine-readable output

Behavior notes:

- Omitting `source` installs the default `aiman` skill from `https://github.com/ogow/aiman`.
- `<source>` can also be a local directory or a git URL.
- For git URLs, `aiman` clones the repo's `main` branch.
- If the repo exposes exactly one bundled skill, `aiman` installs it automatically.
- If the repo exposes multiple bundled skills, pass `--path skills/<name>`.

## `aiman run <agent>`

Run one specialist agent.

Flags:

- `--task <text>`: task text; use stdin for larger input
- `--cwd <path>`: working directory for the downstream provider
- `--scope project|user`: resolve the agent from one scope only
- `--mode read-only|workspace-write`: must match the agent file's declared permissions
- `--detach`: launch in the background and return immediately
- `--json`: print machine-readable output

Behavior notes:

- Foreground run is the default and preferred path.
- `--task` and stdin are mutually exclusive.
- A conflicting `--mode` fails instead of silently changing permissions.

## `aiman sesh list`

List sessions.

Flags:

- `--all`: include recent finished runs
- `--limit <n>`: default `20`
- `--json`: print machine-readable output

Default behavior:

- without `--all`, this shows active runs only

## `aiman sesh show <runId>`

Show the compact human-friendly status for one run.

Flags:

- `--json`

Use this when you want a quick answer before opening raw logs or the full inspection view.

## `aiman sesh logs <runId>`

Show persisted session output.

Flags:

- `--stream all|stdout|stderr`
- `-f`, `--follow`
- `--tail <n>`: default `40`
- `--json`

Use `--stream stderr` first when launch or provider execution failed.

## `aiman sesh inspect <runId>`

Inspect one persisted session record.

Flags:

- `--stream run|prompt|stdout|stderr`
- `--json`

Use streams as focused evidence views:

- `--stream run`: read canonical `run.md`
- `--stream prompt`: read the exact rendered prompt
- `--stream stdout`: read captured stdout
- `--stream stderr`: read captured stderr

## `aiman sesh top`

Interactive dashboard.

Flags:

- `--filter active|historic|all`

Rule:

- Do not use this command from agents, wrappers, or automation. It is a real-TTY human surface.
