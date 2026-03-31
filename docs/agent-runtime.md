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
7. The caller can list active runs through `aiman sesh list`, inspect compact status through `aiman sesh show`, tail output through `aiman sesh logs`, open the dashboard through `aiman sesh top --filter active|historic|all`, or inspect the full persisted record through `aiman sesh inspect`.

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

Supported frontmatter today:

- `name`
- `provider`
- `description`
- required `permissions`
- optional `model`
- optional `reasoningEffort`
- optional `requiredMcps`
- optional `skills`

Current provider behavior:

- Codex supports `reasoningEffort` by mapping it to Codex CLI config as `model_reasoning_effort`.
- Gemini rejects `reasoningEffort` during validation instead of silently ignoring it.
- Codex `read-only` runs use `--sandbox read-only`, while Codex `workspace-write` runs use `--sandbox workspace-write`.
- Gemini `read-only` runs use `--approval-mode plan`, while Gemini `workspace-write` runs use `--approval-mode auto_edit`.
- Operator-facing surfaces should describe those rights explicitly so the caller can tell whether a run is no-edit, write-enabled, or otherwise constrained.

`aiman agent create` writes a structured Markdown scaffold so new agents start from a consistent shape, including an explicit `{{task}}` slot instead of relying on runtime prompt appends.

`permissions` is the agent-authored execution contract. Today it matches the run modes directly:

- `permissions: read-only`
- `permissions: workspace-write`

Foreground and detached runs should honor that declaration. If a caller passes `--mode` and it disagrees with the agent file, `aiman run` fails instead of silently changing the agent's access level.

`skills`, when present, is a YAML list of required provider-native skills. `aiman` does not inline or execute those skills itself. Instead, it preflights the declared names against `<repo>/.agents/skills/` first and `~/.agents/skills/` second, then freezes the resolved skill metadata into the run's launch snapshot so later `inspect` output shows what was available at launch time.

`requiredMcps`, when present, is a YAML list of MCP server names the authored agent expects the selected provider to have ready. `aiman` checks those names through the provider CLI before launch and fails fast when a required MCP is missing. In the current environment, Gemini can also report disconnected MCPs directly through `gemini mcp list`, while Codex preflight currently reads the structured `codex mcp list --json` output and treats `enabled` as the strongest available ready signal.

## Run Storage

All execution state lives under repo-local `.aiman/runs/<run-id>/`.

Current layout:

```text
.aiman/
  runs/
    20260328T143012Z-code-reviewer-ab12cd34/
      run.md
      prompt.md
      stdout.log
      stderr.log
      artifacts/
```

File roles:

- `run.md`: canonical persisted run record with deterministic frontmatter plus the final Markdown body
- `prompt.md`: rendered prompt sent to the provider
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
- optional `model`
- optional `reasoningEffort`
- `mode`
- `cwd`
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
- resolved declared skills, including scope, file path, and file digest

Authored or agent-produced frontmatter can also include task-specific fields like:

- `kind`
- `summary`
- `artifacts`
- other structured metadata that should be preserved alongside the run

The Markdown body is the final human-readable result.

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

- both adapters resolve a concrete CLI executable from `PATH`
- both use explicit argv instead of shell command strings
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
