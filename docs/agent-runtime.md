# Agent Runtime

`aiman` is a small local profile-run recorder. It launches one authored specialist profile, persists one canonical run record, and makes that run easy to inspect through the `run` and `sesh` commands.

## Runtime Boundaries

Current responsibilities:

- load authored profiles from project scope, user scope, and the built-in `build` and `plan` profiles
- render the provider prompt from the authored body plus explicit placeholder substitution
- attach the repo's `AGENTS.md#Aiman Runtime Context` when that section exists
- attach any selected local `aiman` skills
- launch and supervise the downstream CLI safely with explicit argv, cwd, and environment
- freeze one immutable launch snapshot before execution starts
- capture logs and persist one canonical `run.md`
- expose persisted state through `aiman run show`, `aiman run logs`, `aiman run inspect`, `aiman sesh ...`, and the default TUI

Things `aiman` does not do:

- no workflow ownership or agent orchestration
- no hidden routing or retry policy
- no session-sharing or export/import platform
- no network protocol or daemon layer
- no separate task queue or memory system

## Execution Flow

Current flow:

1. The caller chooses a profile name and invokes `aiman run <profile>`.
2. `aiman` resolves the profile from project scope or user scope. Project scope wins on name collisions unless `--scope` is passed.
3. `aiman` reads only `AGENTS.md#Aiman Runtime Context` from the repo when that section exists.
4. `aiman` resolves any declared or explicitly selected local skills from `.aiman/skills/` or `~/.aiman/skills/`.
5. `aiman` renders `prompt.md`, freezes an immutable `launch` snapshot, writes an initial running `run.md`, and chooses foreground or detached execution.
6. The active `aiman` process drains stdout and stderr into persisted logs while the provider subprocess runs, then normalizes the result and persists the final `run.md`.
7. Operator-facing reads derive whether the run is still active from the stored supervising `pid` plus a fresh heartbeat instead of trusting `status: running` alone.

## Profile Model

Each profile is a Markdown file with frontmatter plus a provider-native body.

The body is the full authored prompt contract. `aiman` does not append a hidden runtime footer. Instead, it substitutes explicit placeholders when present. Supported runtime placeholders today are:

- `{{task}}`
- `{{cwd}}`
- `{{mode}}`
- `{{runId}}`
- `{{runFile}}`
- `{{artifactsDir}}`

`{{task}}` is the expected placeholder for runnable profiles created by `aiman profile create`.

Supported frontmatter for new authoring work:

- required `name`
- required `provider`
- required `description`
- required `model`
- required `mode`
- required `reasoningEffort`
- optional `skills`

`reasoningEffort` is provider-specific:

- `codex`: `none`, `low`, `medium`, or `high`
- `gemini`: `none`

Use `none` when the selected provider or model does not support configurable reasoning effort.

Profiles that use `permissions`, `contextFiles`, or `requiredMcps` are invalid. Rewrite them to the current contract instead of relying on fallback parsing.

For authoring guidance on turning that contract into a reliable reusable specialist, see `docs/agent-authoring.md`.

## Runtime Context And Skills

`aiman` appends shared repo guidance only from `AGENTS.md#Aiman Runtime Context`.

- If that section is missing, no repo runtime context is attached.
- The rest of `AGENTS.md` is not attached.
- Keep the section short, stable, and repo-wide.

`skills`, when present, is a YAML list of local `aiman` skill names.

- `aiman` resolves those names from `.aiman/skills/` and `~/.aiman/skills/`.
- The selected skill bodies are attached to the prompt as explicit run context.
- The launch snapshot records the active skill names for later inspection.

## Provider Isolation

Current provider behavior:

- Codex `safe` runs use `codex exec --sandbox read-only`.
- Codex `yolo` runs use `codex exec --sandbox workspace-write`.
- Gemini `safe` runs use `gemini --approval-mode plan`.
- Gemini `yolo` runs use `gemini --approval-mode auto_edit`.
- Codex launches blank project-doc, instruction, and agent-role prompt inputs so repo `AGENTS.md`, prompt-shaping `.codex` settings, and repo-defined Codex agent roles do not leak into authored `aiman` profiles beyond the explicit runtime-context section.
- Gemini launches use a child-local settings overlay so ambient `GEMINI.md`-style prompt files do not leak into authored `aiman` profiles beyond the explicit runtime-context section.

Operator-facing surfaces should describe those rights explicitly so the caller can tell whether a run is safe, yolo, read-only, or write-enabled.

## Run Storage

All execution state lives under the global home store `~/.aiman/runs/<run-id>/`.

`aiman` also keeps a SQLite run index at `~/.aiman/aiman.db`. That index stores run ids, `projectRoot`, status, pid/heartbeat, and the resolved run directory so `sesh list`, `show`, `logs`, `inspect`, and the default workbench can find runs from any working directory without rescanning project-local directories.

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
- `.stop-requested`: optional stop request marker written by `aiman run stop <run-id>` or the default OpenTUI workbench; active workers poll for it and stop the provider subprocess when present, including Windows command-processor launch trees for `.cmd` / `.bat` shims
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
- provider, model, and effective mode
- working directory, launch mode, timeout, and kill grace period
- provider command, argv summary, prompt transport, and allowlisted environment key names
- agent-file digest and prompt digest
- declared skill names and the attached `AGENTS.md#Aiman Runtime Context` path when present

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
- Codex launches also blank project-doc, developer-instruction, and agent-role inputs on the CLI so authored `aiman` prompts do not inherit extra repo prompt-shaping inputs beyond `AGENTS.md#Aiman Runtime Context`, while still keeping project-native MCP registration available
- Gemini launches also inject a child-local settings overlay via `GEMINI_CLI_SYSTEM_SETTINGS_PATH` so Gemini context-file loading uses an impossible filename instead of ambient project prompt files, while still keeping project-native `.gemini/settings.json` MCP registration available
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
- prefer the run directory over side-channel IPC; `logs` and the default workbench observe the same persisted files that `inspect` reads
- enforce per-run timeout and kill escalation
- persist failures as normal run results
- keep human activity indicators indeterminate and TTY-only instead of inventing percent-complete progress
- keep the CLI thin and the filesystem layout explicit

Repo rule:

- prefer forward-only cleanup over backward-compatibility shims while the project is changing quickly

That means docs and code should describe the current contract, not keep stale compatibility branches alive just because older behavior once existed.

## Provider Contract Verification

The strict prompt-isolation claim is only as good as the real provider CLIs. `aiman` keeps adapter wiring tests for argv and env assembly, but the live contract check is `bun run test:provider-contract`.

That smoke-test suite:

- uses the real Codex and Gemini CLIs
- creates temp repos with sentinel `AGENTS.md` and `GEMINI.md` files
- verifies that ambient repo instruction files stay out of authored `aiman` runs
- verifies that only the explicit `AGENTS.md#Aiman Runtime Context` section appears
- skips explicitly when the required CLI or auth is unavailable instead of silently passing
