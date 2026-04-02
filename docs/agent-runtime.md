# Agent Runtime

`aiman` is a small local specialist-run recorder. It launches one authored specialist, persists one canonical run record, and makes that run easy to inspect through the `sesh` inspection commands.

## Runtime Boundaries

Current responsibilities:

- load authored agents from project scope and user scope
- validate the selected agent against the chosen provider adapter
- render the provider prompt from the authored body plus explicit placeholder substitution
- launch and supervise the downstream CLI safely with explicit argv, cwd, and environment
- freeze one immutable launch snapshot before execution starts
- capture logs and persist one canonical `run.md`
- expose persisted state through `aiman sesh show`, `aiman sesh logs`, `aiman sesh inspect`, and `aiman sesh top`

Things `aiman` does not do:

- no workflow ownership or agent orchestration
- no hidden routing or retry policy
- no session-sharing or export/import platform
- no network protocol or daemon layer
- no separate task queue or memory system

## Execution Flow

Current flow:

1. The caller chooses an agent name and invokes `aiman run <agent>`.
2. `aiman` resolves the agent from project scope or user scope. Project scope wins on name collisions unless `--scope` is passed.
3. `aiman` validates provider runtime preconditions, renders `prompt.md`, freezes an immutable `launch` snapshot, writes an initial running `run.md`, and chooses one of two execution paths.
4. Foreground `aiman run` executes the provider inline and stores the supervising `aiman` process pid plus a rolling heartbeat in `run.md`, while detached `aiman run --detach` launches a hidden worker command that owns the same run directory, persists its own pid/heartbeat, and reuses the snapshotted launch metadata already written to disk.
5. The active `aiman` process drains stdout and stderr into persisted logs while the provider subprocess runs, then normalizes the result and persists the final `run.md`.
6. Operator-facing reads derive whether the run is still active from the stored supervising `pid` plus a fresh heartbeat instead of trusting `status: running` alone.
7. The caller can list active runs through `aiman sesh list`, inspect compact status through `aiman sesh show`, tail output through `aiman sesh logs`, stop one active run through `aiman agent stop <run-id>`, open the dashboard through `aiman sesh top --filter active|historic|all`, or inspect the full persisted record through `aiman sesh inspect`.

`aiman sesh top` is intentionally a human-only TTY dashboard. It now opens in a list-first view, uses Enter to focus one run, and can stop the selected active run with `s`. Agentic and automated flows should use `list`, `show`, `logs`, `inspect`, and `agent stop` instead of trying to drive that screen-oriented surface.

## Agent Model

Each agent is a Markdown file with frontmatter plus a provider-native body.

The body is now the full authored prompt contract. `aiman` does not append a hidden runtime footer. Instead, it substitutes explicit placeholders when present. Supported runtime placeholders today are:

- `{{task}}`
- `{{cwd}}`
- `{{mode}}`
- `{{runId}}`
- `{{runFile}}`
- `{{artifactsDir}}`

`{{task}}` is the expected placeholder for runnable agents created by `aiman agent create`.

For authoring guidance on turning that contract into a reliable reusable agent, see `docs/agent-authoring.md`.

Supported frontmatter today:

- `name`
- `provider`
- `description`
- required `permissions`
- required `model`
- optional `reasoningEffort`
- optional `requiredMcps`
- optional `contextFiles`
- optional `skills`

Current provider behavior:

- Codex supports `reasoningEffort` by mapping it to Codex CLI config as `model_reasoning_effort`.
- On Windows, Codex runs also set `allow_login_shell=false` and `shell_environment_policy.experimental_use_profile=false` so non-interactive `aiman` runs do not inherit user PowerShell profile behavior.
- Codex runs also override `project_doc_max_bytes=0`, `project_doc_fallback_filenames=[]`, `developer_instructions=""`, `instructions=""`, and `agents={}` so repo `AGENTS.md`, other prompt-shaping project instructions, and repo-defined Codex agent roles do not leak into authored `aiman` agents, while project `.codex` config can still supply MCP definitions.
- Gemini runs set a child-local settings overlay, passed only through the spawned process environment as `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, whose `context.fileName` points at an impossible filename. That keeps repo `AGENTS.md` / `GEMINI.md`-style context files from leaking into authored `aiman` agents while project `.gemini/settings.json` can still supply MCP definitions.
- Gemini rejects `reasoningEffort` during validation instead of silently ignoring it.
- Codex `read-only` runs use `--sandbox read-only`, while Codex `workspace-write` runs use `--sandbox workspace-write`.
- Gemini `read-only` runs use `--approval-mode plan`, while Gemini `workspace-write` runs use `--approval-mode auto_edit`.
- Operator-facing surfaces should describe those rights explicitly so the caller can tell whether a run is no-edit, write-enabled, or otherwise constrained.

`aiman agent create` writes a structured Markdown scaffold so new agents start from a consistent shape, including an explicit `{{task}}` slot instead of relying on runtime prompt appends. The scaffold also includes a commented `contextFiles` example that points at `docs/agent-baseline.md`, which keeps shared repo baseline context explicit instead of ambient.

`aiman agent check` is the static validation companion to that scaffold. It checks one authored file for blocking issues such as missing required frontmatter, unsupported provider settings, unsafe or missing `contextFiles`, duplicate declared entries, and a missing `{{task}}`, then reports structural warnings such as missing recommended sections or weak output-shape guidance. It does not execute the provider.

`permissions` is the agent-authored execution contract. Today it matches the run modes directly:

- `permissions: read-only`
- `permissions: workspace-write`

Foreground and detached runs should honor that declaration. If a caller passes `--mode` and it disagrees with the agent file, `aiman run` fails instead of silently changing the agent's access level.

`skills`, when present, is a YAML list of declared provider-native skills. `aiman` does not inline, resolve, or execute those skills itself. Instead, it records the declared names in the run's launch snapshot for inspection/debugging and leaves actual skill discovery and use to the downstream provider CLI.

`contextFiles`, when present, is a YAML list of repo-relative file paths. `aiman run` resolves those paths under the project root, fails fast for missing, duplicate, absolute, or escaping paths, and appends the file contents as a clearly labeled `Project Context` section in the rendered prompt. This is the opt-in path for repo-specific guidance; ambient repo `AGENTS.md` inheritance is intentionally not supported. For shared neutral repo guidance, the intended pattern is a small explicit baseline file such as `docs/agent-baseline.md`.

`requiredMcps`, when present, is a YAML list of MCP server names the authored agent expects the selected provider to have ready. `aiman` checks those names through the provider CLI before launch and fails fast when a required MCP is missing. In the current environment, Gemini can also report disconnected MCPs directly through `gemini mcp list`, while Codex preflight currently reads the structured `codex mcp list --json` output and treats `enabled` as the strongest available ready signal.

## Run Storage

All execution state lives under the global home store `~/.aiman/runs/<run-id>/`.

`aiman` also keeps a SQLite run index at `~/.aiman/aiman.db`. That index stores run ids, `projectRoot`, status, pid/heartbeat, and the resolved run directory so `sesh list`, `show`, `logs`, `inspect`, and `top` can find runs from any working directory without rescanning project-local directories.

Current layout:

```text
~/.aiman/
  aiman.db
  runs/
    code-reviewer-ab12cd34/
      run.md
      prompt.md
      stdout.log
      stderr.log
      artifacts/
```

File roles:

- `run.md`: canonical persisted run record with deterministic frontmatter plus the final Markdown body
- `prompt.md`: rendered prompt sent to the provider
- `.stop-requested`: optional stop request marker written by `aiman agent stop <run-id>` or the `sesh top` dashboard; active workers poll for it and stop the provider subprocess when present, including Windows command-processor launch trees for `.cmd` / `.bat` shims
- `stdout.log` / `stderr.log`: raw subprocess output when those streams contain data
- `artifacts/`: optional directory for run-side files referenced from `run.md`

The runtime derives prompt/log/artifact file paths from the run directory. Those paths are not duplicated in `run.md`.

For operator-facing reads, the runtime also derives whether the run is still active from the stored supervising `pid` plus a fresh heartbeat:

- active means the `aiman` process supervising that run still exists and has refreshed its heartbeat recently
- inactive means the run is already terminal, or the supervising process died before the run reached a terminal record
- when a run is inactive but still recorded as `running`, `status` and `inspect` show a warning instead of adding a new persisted lifecycle state

## `run.md` Contract

`run.md` frontmatter stores current runtime metadata such as:

- `runId`
- `status`
- `agent`
- `agentScope`
- `agentPath`
- `provider`
- `launchMode`
- `model`
- optional `reasoningEffort`
- `mode`
- `cwd`
- `projectRoot`
- `startedAt`
- optional `endedAt`
- optional `durationMs`
- optional `exitCode`
- optional `signal`
- optional `errorMessage`
- optional `usage`
- required `launch`

The `launch` object is the immutable evidence record for the run. It freezes:

- resolved agent identity and path
- provider, model, reasoning effort, permissions, and effective mode
- working directory, launch mode, timeout, and kill grace period
- provider command, argv summary, prompt transport, and allowlisted environment key names
- agent-file digest and prompt digest
- declared skill names and explicit `contextFiles` paths

Authored or agent-produced frontmatter can also include task-specific fields like:

- `kind`
- `summary`
- `artifacts`
- other structured metadata that should be preserved alongside the run

The Markdown body is the final human-readable result.

Legacy project-local `.aiman/runs/` directories are not auto-imported into the SQLite index in the current forward-only design.

## Provider Adapters

The cross-provider contract stays small:

```ts
type ProviderAdapter = {
   id: string;
   detect(agent: AgentDefinition): Promise<ValidationIssue[]>;
   validateAgent(agent: AgentDefinition): ValidationIssue[];
   prepare(agent: AgentDefinition, input: PreparedRunInput): PreparedInvocation;
   parseCompletedRun(input: CompletedRunInput): Promise<PersistedRunRecord>;
};
```

Current adapter behavior:

- both adapters resolve a concrete CLI executable from `PATH`, including Windows `PATHEXT` shims such as `.cmd`
- both use explicit argv instead of shell command strings
- Windows `.cmd` and `.bat` provider shims are relaunched through an explicit escaped `cmd.exe /d /s /c` command line so npm-style wrappers still launch without mangling prompt arguments, and stop/timeout handling must terminate that command-processor launch tree rather than only the wrapper process
- Windows Codex launches also pin the Codex CLI away from login-shell and user-profile shell behavior so provider-side PowerShell commands do not depend on user profile loading
- Codex launches also blank project-doc, developer-instruction, and agent-role inputs on the CLI so authored `aiman` prompts do not inherit repo `AGENTS.md`, prompt-shaping `.codex` instruction keys, or malformed repo role definitions, while still keeping project-native MCP registration available
- Gemini launches also inject a child-local settings overlay via `GEMINI_CLI_SYSTEM_SETTINGS_PATH` so Gemini context-file loading uses an impossible filename instead of project `AGENTS.md` / `GEMINI.md`, while still keeping project-native `.gemini/settings.json` MCP registration available
- both run with an allowlisted environment
- both should make provider-specific rights legible to the operator instead of forcing them to reverse-engineer adapter flags
- both can reuse an already-rendered `prompt.md` during hidden-worker execution so detached runs do not have to reconstruct prompt state differently
- both rely on the authored agent body as the full prompt and only substitute explicit runtime placeholders
- both normalize final output into the shared `run.md` contract
- Codex requires the persisted last-message file for a successful run; if the provider exits successfully without writing it, `aiman` records an error instead of silently switching to stdout parsing
- Gemini uses stdout as the final answer text

## Safety and Simplification Rules

Current runtime rules:

- use `spawn()`, not shell-interpolated strings
- keep argv explicit
- drain stdout and stderr continuously
- prefer the run directory over side-channel IPC; `logs` and `top` observe the same persisted files that `inspect` reads
- enforce per-run timeout and kill escalation
- persist failures as normal run results
- keep human activity indicators indeterminate and TTY-only instead of inventing percent-complete progress
- keep the CLI thin and the filesystem layout explicit

Repo rule:

- prefer forward-only cleanup over backward-compatibility shims while the project is changing quickly

That means docs and code should describe the current contract, not keep stale compatibility branches alive just because older behavior once existed.

## Provider Contract Verification

The strict prompt-isolation claim is only as good as the real provider CLIs. `aiman` keeps adapter wiring tests for argv and env assembly, but the live contract check is `npm run test:provider-contract`.

That smoke-test suite:

- uses the real Codex and Gemini CLIs
- creates temp repos with sentinel `AGENTS.md` and `GEMINI.md` files
- verifies that ambient repo instruction files stay out of authored `aiman` runs
- verifies that explicit baseline context from `contextFiles` still appears
- skips explicitly when the required CLI or auth is unavailable instead of silently passing
