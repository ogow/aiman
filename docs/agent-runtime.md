# Agent Runtime

`aiman` is a small local runtime for authored specialist agents. It does not orchestrate a full multi-agent workflow itself. An external caller chooses an agent, invokes `aiman run`, and then decides what to do with the result.

## Runtime Boundaries

Current responsibilities:

- load authored agents from project scope and user scope
- validate the selected agent against the chosen provider adapter
- render the provider prompt
- execute the downstream CLI safely with explicit argv, cwd, and environment
- capture logs and persist one canonical `run.md`
- expose persisted state through `aiman inspect`

Things `aiman` does not do:

- no internal supervisor or peer-to-peer agent mesh
- no hidden routing policy
- no network protocol or daemon layer
- no separate task queue or memory system

## Execution Flow

Current flow:

1. The caller chooses an agent name and invokes `aiman run <agent>`.
2. `aiman` resolves the agent from project scope or user scope. Project scope wins on name collisions unless `--scope` is passed.
3. `aiman` validates provider runtime preconditions.
4. The provider adapter prepares a concrete CLI invocation.
5. `aiman` writes `prompt.md`, launches the subprocess with `spawn()`, drains stdout and stderr, and writes a running `run.md` state.
6. When the subprocess finishes, `aiman` normalizes the result and persists the final `run.md`.
7. The caller can inspect the run through `aiman inspect`.

## Agent Model

Each agent is a Markdown file with frontmatter plus a provider-native body.

Supported frontmatter today:

- `name`
- `provider`
- `description`
- optional `model`
- optional `reasoningEffort`

Current provider behavior:

- Codex supports `reasoningEffort` by mapping it to Codex CLI config as `model_reasoning_effort`.
- Gemini rejects `reasoningEffort` during validation instead of silently ignoring it.

`aiman create` writes a structured Markdown scaffold so new agents start from a consistent shape.

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

## `run.md` Contract

`run.md` frontmatter stores current runtime metadata such as:

- `runId`
- `status`
- `agent`
- `agentScope`
- `agentPath`
- `provider`
- `mode`
- `cwd`
- `startedAt`
- optional `endedAt`
- optional `durationMs`
- optional `exitCode`
- optional `signal`
- optional `errorMessage`
- optional `usage`

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
   detect(): Promise<ValidationIssue[]>;
   validateAgent(agent: AgentDefinition): ValidationIssue[];
   prepare(agent: AgentDefinition, input: PreparedRunInput): PreparedInvocation;
   parseCompletedRun(input: CompletedRunInput): Promise<PersistedRunRecord>;
};
```

Current adapter behavior:

- both adapters resolve a concrete CLI executable from `PATH`
- both use explicit argv instead of shell command strings
- both run with an allowlisted environment
- both normalize final output into the shared `run.md` contract
- Codex prefers the persisted last-message file over noisy stdout when available
- Gemini uses stdout as the final answer text

## Safety and Simplification Rules

Current runtime rules:

- use `spawn()`, not shell-interpolated strings
- keep argv explicit
- drain stdout and stderr continuously
- enforce per-run timeout and kill escalation
- persist failures as normal run results
- keep the CLI thin and the filesystem layout explicit

Repo rule:

- prefer forward-only cleanup over backward-compatibility shims while the project is changing quickly

That means docs and code should describe the current contract, not keep stale compatibility branches alive just because older behavior once existed.
