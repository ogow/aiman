# Agent Runtime

`aiman` is a small local agent-run recorder. It launches one authored specialist agent, persists one canonical run record, and makes that run easy to inspect through `aiman run` and `aiman runs ...`.

## Runtime Boundaries

Current responsibilities:

- load authored agents from project scope, user scope, and the built-in `build` and `plan` agents
- render the provider prompt from the authored body plus explicit placeholder substitution
- load layered harness config and pass shared native context file names to the downstream provider
- launch and supervise the downstream CLI safely with explicit argv, cwd, and environment
- freeze one immutable launch snapshot before execution starts
- capture logs and persist one canonical `run.md`
- expose persisted state through `aiman runs show`, `aiman runs logs`, `aiman runs inspect`, and the default TUI

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
3. `aiman` loads the shared repo-level `contextFileNames` setting from layered config.
4. `aiman` renders `prompt.md`, freezes an immutable `launch` snapshot, writes an initial running `run.md`, and chooses foreground or detached execution.
5. The downstream provider discovers configured bootstrap context files natively as part of its own repo workflow.
6. The active `aiman` process drains stdout and stderr into persisted logs while the provider subprocess runs, then normalizes the result and persists the final `run.md`.
7. Operator-facing reads derive whether the run is still active from the stored supervising `pid` plus a fresh heartbeat instead of trusting `status: running` alone.

## Agent Model

Each agent is a Markdown file with frontmatter plus a provider-native body.

The body is the full authored prompt contract. `aiman` does not append a hidden runtime footer. Instead, it substitutes explicit placeholders when present. Supported runtime placeholders today are:

- `{{task}}`
- `{{cwd}}`
- `{{mode}}`
- `{{runId}}`
- `{{runFile}}`
- `{{artifactsDir}}`

`{{task}}` is the expected placeholder for runnable agents created by `aiman agent create`.

Supported frontmatter for new authoring work:

- required `name`
- required `provider`
- required `description`
- required `mode`
- required `reasoningEffort`

`model` is provider-specific:

- `codex`: required and must name an explicit model
- `gemini`: required; use an explicit model id or `auto` to let Gemini choose its automatic default model

`reasoningEffort` is provider-specific:

- `codex`: `none`, `low`, `medium`, or `high`
- `gemini`: `none`

Use `none` when the selected provider or model does not support configurable reasoning effort.

Agents that use `permissions`, `contextFiles`, `skills`, or `requiredMcps` are invalid. Rewrite them to the current contract instead of relying on fallback parsing.

For authoring guidance on turning that contract into a reliable reusable specialist, see `docs/agent-authoring.md`.

## Runtime Context

`aiman` no longer injects a managed project-context section into prompts. Instead, the harness config can define a shared ordered `contextFileNames` list for the whole repo, for example `["AGENTS.md", "CONTEXT.md"]`.

- Home config lives at `~/.aiman/config.json`.
- Repo config lives at `<repo>/.aiman/config.json`.
- Repo config overrides home config.
- When configured, all agents in the same repo use the same file names.
- Agents do not override those file names individually.
- When configured, the downstream provider treats those files as native bootstrap context when they exist.
- When not configured, `aiman` leaves bootstrap file selection to the downstream provider's native behavior.

## Provider Isolation

Current provider behavior:

- Codex `safe` runs use `codex exec --sandbox read-only`.
- Codex `yolo` runs use `codex exec --sandbox workspace-write`.
- Gemini `safe` runs use `gemini --approval-mode plan`.
- Gemini `yolo` runs use `gemini --approval-mode auto_edit`.
- Codex launches pin non-interactive approval behavior to `approval_policy="never"` so `codex exec` does not inherit interactive approval defaults from local config.
- Codex launches preserve native `AGENTS.md` handling, pass additional configured bootstrap file names through `project_doc_fallback_filenames`, blank other Codex prompt-shaping inputs such as `developer_instructions`, `instructions`, and `agents`, and grant the run `artifacts/` directory as an explicit extra writable root via `--add-dir`.
- Gemini launches use a child-local settings overlay so Gemini sees the shared configured bootstrap file names through its native `context.fileName` setting.

Operator-facing surfaces should describe those rights explicitly so the caller can tell whether a run is safe, yolo, read-only, or write-enabled.

## Run Storage

All execution state lives under the global home store `~/.aiman/runs/<run-id>/`.

`aiman` also keeps a SQLite run index at `~/.aiman/aiman.db`. That index stores run ids, `projectRoot`, status, pid/heartbeat, and the resolved run directory so `runs list`, `runs show`, `runs logs`, `runs inspect`, and the default workbench can find runs from any working directory without rescanning project-local directories.

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
- `.stop-requested`: optional stop request marker written by `aiman runs stop <run-id>` or the default OpenTUI workbench; active workers poll for it and stop the provider subprocess when present, including Windows command-processor launch trees for `.cmd` / `.bat` shims
- `stdout.log` / `stderr.log`: raw subprocess output when those streams contain data; for Codex runs, `stdout.log` is the JSONL event stream from `codex exec --json`
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
- the effective configured native `contextFileNames`

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
- Codex launches also preserve native `AGENTS.md` handling, pass additional configured bootstrap file names through the CLI, blank other repo prompt-shaping inputs while keeping project-native MCP registration available, request JSONL event output on stdout, pin `approval_policy="never"` for deterministic automation, and grant the external run `artifacts/` directory as an extra writable root
- Gemini launches also inject a child-local settings overlay via `GEMINI_CLI_SYSTEM_SETTINGS_PATH` so Gemini uses the shared configured bootstrap file names instead of provider defaults while still keeping project-native `.gemini/settings.json` MCP registration available, and request `--output-format json` so headless runs return one structured JSON object
- both run with an allowlisted environment
- both should make provider-specific rights legible to the operator instead of forcing them to reverse-engineer adapter flags
- both can reuse an already-rendered `prompt.md` during hidden-worker execution so detached runs do not have to reconstruct prompt state differently
- both rely on the authored agent body as the full prompt and only substitute explicit runtime placeholders
- both normalize final output into the shared `run.md` contract
- Codex requires the persisted last-message file for a successful run; if the provider exits successfully without writing it, `aiman` records an error instead of silently switching to stdout parsing, even though stdout is available as structured JSONL events
- Gemini requires valid structured stdout from `--output-format json`; `aiman` parses the final response from the JSON object's `response` field and surfaces the structured `error.message` when the CLI exits non-zero

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
- verifies that configured bootstrap context files appear natively
- verifies that non-configured context files stay out
- skips explicitly when the required CLI or auth is unavailable instead of silently passing
