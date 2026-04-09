# Agent Runtime

`aiman` is a small local agent-run recorder. It launches one authored specialist agent, persists one canonical `run.json` ledger plus any supporting files, and makes that state easy to inspect through `aiman run` and `aiman runs ...`.

## Runtime Boundaries

Current responsibilities:

- load authored agents from project scope, user scope, and the built-in `build` and `plan` agents
- render the provider prompt from the authored body plus explicit placeholder substitution
- append a runtime-enforced JSON result contract only for schema-mode agents
- load layered harness config and pass shared native context file names to the downstream provider
- launch and supervise the downstream CLI safely with explicit argv, cwd, and environment
- freeze one immutable launch snapshot before execution starts
- capture raw stdout/stderr logs
- persist one canonical `run.json`
- expose persisted state through `aiman runs show`, `aiman runs logs`, `aiman runs inspect`, and the default TUI

Things `aiman` does not do:

- no workflow ownership or agent orchestration
- no hidden routing or retry policy
- no session-sharing or export/import platform
- no SQLite run index
- no markdown run documents

## Execution Flow

Current flow:

1. The caller chooses an agent name and invokes `aiman run <agent>`.
2. `aiman` resolves the agent from project scope or user scope. Project scope wins on name collisions unless `--scope` is passed.
3. `aiman` loads the shared repo-level `contextFileNames` setting from layered config.
4. `aiman` renders the final prompt, appends the schema contract only when the agent uses `resultMode: "schema"`, freezes an immutable `launch` snapshot, writes an initial running `run.json`, and chooses foreground or detached execution.
5. The downstream provider discovers configured bootstrap context files natively as part of its own repo workflow.
6. The active `aiman` process drains stdout and stderr into persisted logs while the provider subprocess runs, then persists the final `run.json`, validating structured output only when the agent uses `resultMode: "schema"`.
7. Operator-facing reads derive whether the run is still active from the stored supervising `pid` plus a fresh heartbeat instead of trusting `status: running` alone.

## Agent Model

Each agent is a Markdown file with frontmatter plus a provider-native body.

The body remains the authored task contract. `aiman` substitutes explicit placeholders when present. For schema-mode agents it also appends a strict runtime JSON result contract. Supported runtime placeholders today are:

- `{{task}}`
- `{{cwd}}`
- `{{runId}}`
- `{{runFile}}`
- `{{artifactsDir}}`

`{{task}}` is the expected placeholder for runnable agents created by `aiman agent create`.

Supported frontmatter for new authoring work:

- required `name`
- required `provider`
- required `description`
- required `reasoningEffort` for Codex; optional for Gemini
- recommended `resultMode`
- optional informational `capabilities`

`model` is provider-specific:

- `codex`: required and must name an explicit model
- `gemini`: required; use an explicit model id or `auto` to let Gemini choose its automatic default model

`reasoningEffort` is provider-specific:

- `codex`: `none`, `low`, `medium`, or `high`
- `gemini`: `none`

Agents that use `permissions`, `contextFiles`, `skills`, or `requiredMcps` are invalid.
Agents that use `mode` are also invalid; provider rights are a runtime concern, not authored agent frontmatter.
When present, `capabilities` is a small descriptive list for operator visibility only and does not change runtime behavior.

## Result Modes

Supported modes:

- `text`: default. The final provider answer is stored as `finalText`; operator surfaces may also use a derived `summary` for compact listings.
- `schema`: opt-in. The final provider answer must be valid JSON with the following required top-level keys:
  - `summary`
  - `outcome`
  - `result`

Optional schema-mode top-level keys:

- `next`

`next`, when present, must be an object. Use it only when there is a clear next step for a human or another agent. Supported fields are:

- optional `task`
- optional `agent`
- optional `inputs`

If the provider exits successfully but the final message does not satisfy that contract, `aiman` records the run as an error.

For authored-agent debugging, the usual inspection order is:

1. `aiman runs show <run-id>`
2. `aiman runs inspect <run-id> --stream prompt`
3. `aiman runs inspect <run-id> --stream run`
4. `aiman runs inspect <run-id> --stream stdout|stderr`

## Runtime Context

`aiman` does not inject a managed project-context section into prompts. Instead, the harness config can define a shared ordered `contextFileNames` list for the whole repo, for example `["AGENTS.md", "CONTEXT.md"]`.

- Home config lives at `~/.aiman/config.json`.
- Repo config lives at `<repo>/.aiman/config.json`.
- Repo config overrides home config.
- When configured, all agents in the same repo use the same file names.
- Agents do not override those file names individually.

## Provider Isolation

Current provider behavior:

- Codex runs use `codex exec --sandbox workspace-write`.
- Gemini runs use `gemini --approval-mode yolo`.
- Codex launches pin non-interactive approval behavior to `approval_policy="never"`.
- Codex launches preserve native `AGENTS.md` handling, pass additional configured bootstrap file names through `project_doc_fallback_filenames`, blank other Codex prompt-shaping inputs such as `developer_instructions`, `instructions`, and `agents`, and grant the run `artifacts/` directory as an explicit extra writable root via `--add-dir`.
- Gemini launches use a child-local settings overlay so Gemini sees the shared configured bootstrap file names through its native `context.fileName` setting, include the run `artifacts/` directory in Gemini's workspace via `--include-directories`, and request `--output-format json`.

## Run Storage

All execution state lives under the global home store:

```text
~/.aiman/runs/
  2026-04-07/
    20260407T101530Z-reviewer-ab12cd34/
      run.json
      stdout.log
      stderr.log
      artifacts/
```

File roles:

- `run.json`: canonical persisted run ledger
- `.stop-requested`: optional stop request marker written by `aiman runs stop <run-id>` or the default OpenTUI workbench
- `stdout.log` / `stderr.log`: raw subprocess output when those streams contain data
- `artifacts/`: optional directory for run-side files produced or referenced during the run

The runtime scans the filesystem directly. There is no separate database index.

For operator-facing reads, the runtime also derives whether the run is still active from the stored supervising `pid` plus a fresh heartbeat:

- active means the `aiman` process supervising that run still exists and has refreshed its heartbeat recently
- inactive means the run is already terminal, or the supervising process died before the run reached a terminal record
- when a run is inactive but still recorded as `running`, `status` and `inspect` show a warning instead of adding a new persisted lifecycle state

## `run.json` Contract

`run.json` stores the canonical machine-readable run state. Core fields include:

- `schemaVersion`
- `runId`
- `status`
- `agent`
- `agentPath`
- `agentScope`
- `provider`
- `launchMode`
- optional `model`
- `cwd`
- `projectRoot`
- `startedAt`
- optional `heartbeatAt`
- optional `endedAt`
- optional `durationMs`
- optional `exitCode`
- optional `signal`
- optional `pid`
- optional `summary`
- required `resultMode`
- optional `outcome`
- optional `finalText`
- optional `structuredResult`
- optional `next`
- `artifacts`
- `logs`
- optional `error`
- required `launch`

The `launch` object is the immutable evidence record for the run. It freezes:

- resolved agent identity and path
- any authored informational `capabilities`
- provider and model
- working directory, launch mode, timeout, and kill grace period
- provider command, argv summary, prompt transport, allowlisted environment key names, and the rendered prompt
- agent-file digest and prompt digest
- the effective configured native `contextFileNames`

## Provider Adapters

The cross-provider contract stays small:

```ts
type ProviderAdapter = {
   id: string;
   detect(agent: AgentDefinition): Promise<ValidationIssue[]>;
   validateAgent(agent: AgentDefinition): ValidationIssue[];
   prepare(agent: AgentDefinition, input: PreparedRunInput): PreparedInvocation;
   parseCompletion(input: CompletedRunInput): Promise<ProviderCompletion>;
};
```

Current adapter behavior:

- both adapters resolve a concrete CLI executable from `PATH`, including Windows `PATHEXT` shims such as `.cmd`
- both use explicit argv instead of shell command strings
- both run with an allowlisted environment
- both normalize provider-specific terminal output into one shared completion shape
- shared runtime code writes `run.json` and validates schema-mode output when required
- Codex requires the persisted last-message file for a successful run
- Gemini requires valid structured stdout from `--output-format json`

## Safety and Simplification Rules

Current runtime rules:

- use `spawn()`, not shell-interpolated strings
- keep argv explicit
- drain stdout and stderr continuously
- prefer the run directory over side-channel IPC
- enforce per-run timeout and kill escalation
- on Unix, supervise provider runs as their own process group so timeout and stop handling can terminate MCP helper descendants that inherited stdio
- persist failures as normal run results
- keep the CLI thin and the filesystem layout explicit

Repo rule:

- prefer forward-only cleanup over backward-compatibility shims while the project is changing quickly
