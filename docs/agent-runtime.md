# Agent Runtime Design

`aiman` should stay simple in v1:

- `aiman` manages specialist agent definitions, execution, safety, and persisted run state.
- The parent agent lives outside `aiman`; it will usually be Codex, Gemini, or Claude Code.
- Providers are thin adapters around existing CLIs.
- `aiman` should return structured results to the caller through file-first run artifacts, not act like a built-in autonomous supervisor.

This keeps the boundary clean: the external parent agent decides which specialist to use and what to do with the result, while `aiman` focuses on reliable specialist execution.

## Research Takeaways

### 1. Avoid an internal peer mesh

Current multi-agent guidance is still useful here, but the important lesson is not "put the supervisor inside `aiman`." The useful lesson is to avoid uncontrolled peer-to-peer messaging and keep context bounded.

Implication for `aiman`:

- Do not let managed agents freely discover and message each other.
- Do not embed a built-in "main agent" that owns product logic.
- Let the external caller decide when to invoke one specialist versus another.

### 2. File-first structured handoff is safer than transcript forwarding

OpenAI's agent safety guidance recommends structured outputs between nodes so untrusted text does not silently become downstream control flow.

Implication for `aiman`:

- `aiman run <agent>` should keep its CLI result slim and let specialists optionally write a `report.md` handoff file with YAML frontmatter.
- Free-form Markdown body is fine as content, but the frontmatter should stay structured.
- If a specialist wants to suggest follow-up work, that suggestion should live in report frontmatter or body for the caller to inspect, not become an internal autonomous handoff.

### 3. Subprocess reliability matters more than orchestration cleverness

Node's `child_process` docs make the operational risks clear: `exec()` uses a shell, pipes can block if you do not drain them, and timeouts, kill signals, and abort handling must be explicit. `execFile()` avoids the shell by default and is more suitable for wrapping CLIs safely.

Implication for `aiman`:

- Use `spawn()` or `execFile()`, not shell command strings.
- Always drain `stdout` and `stderr`.
- Put every run behind timeout, cancellation, and exit-status handling.
- Persist enough state that callers can inspect what happened after the fact.

### 4. Keep interoperability ideas, not protocol complexity

Google's A2A work is useful because it models collaboration around capabilities, tasks, artifacts, and state updates. The useful part for `aiman` is the shape of the data, not the network protocol.

Implication for `aiman`:

- Mirror the useful concepts locally: agent card, run, artifact, and report metadata.
- Do not implement networked A2A in v1.
- Keep local schemas clean enough that a future bridge remains possible.

### 5. Provider-native hooks are useful guardrails

Claude Code's hooks docs show a practical pattern: let the downstream CLI expose useful controls, but keep your own safety model too.

Implication for `aiman`:

- Adapters should expose provider-native safety or approval features when available.
- `aiman` should still validate its own inputs and runtime behavior.
- Caller-side policy and runtime-side guardrails should complement each other.

## Recommended v1 Model

### Core objects

`agent`

- Reusable Markdown file with frontmatter and provider-native body.
- Body is passed through to the provider adapter as-is.

`run`

- One execution of one agent against one task.
- Has immutable input, logs, persisted metadata, and an optional `report.md` plus `artifacts/`.

`report`

- Optional Markdown handoff file written inside the run directory.
- Uses YAML frontmatter for machine-readable metadata and Markdown body for human-readable detail.

`provider adapter`

- Translates an `agent` plus `task` into a concrete CLI invocation.
- Knows how to prepare the CLI call and normalize the completed result.

`run store`

- Keeps the on-disk run layout boring and explicit.
- Owns `run.json`, `result.json`, `report.md`, prompt capture, and log lookup.

## Recommended v1 Execution Pattern

Use "external parent calls specialist" as the default.

Flow:

1. Codex, Gemini, Claude Code, or another caller decides which `aiman` agent to use.
2. The caller invokes `aiman run <agent> ...`.
3. `aiman` validates the agent and runtime preconditions.
4. The provider adapter executes the specialist in isolated context.
5. `aiman` returns a slim normalized result and persists logs, `report.md`, and metadata under `.aiman/runs/`.
6. The external caller decides whether to finish, invoke another specialist, or ask for approval.

That keeps the boundary small:

- Caller chooses the specialist.
- `aiman` runs the specialist safely.
- Caller owns the broader workflow.

## Local State Layout

Keep all execution state in repo-local `.aiman/`.

```text
.aiman/
  agents/
    code-reviewer.md
    researcher.md
  runs/
    20260328T143012Z-code-reviewer-ab12cd34/
      run.json
      prompt.md
      stdout.log
      stderr.log
      result.json
      report.md
      artifacts/
```

Recommended file roles:

- `run.json`: persisted status snapshot for the run.
- `prompt.md`: rendered prompt sent to the downstream CLI.
- `stdout.log` / `stderr.log`: raw subprocess output for debugging.
- `result.json`: normalized final result.
- `report.md`: optional structured handoff file with YAML frontmatter plus Markdown body.
- `artifacts/`: optional files referenced from the report.

Future additions can include `input.json` or `events.ndjson` if the calling pattern needs richer orchestration data.

## Communication Model

Do not model `aiman` as agents talking to each other internally.

Model it as an external caller delegating a bounded task to one specialist and receiving a slim runtime result plus optional `report.md` back.

Example report frontmatter:

```md
---
kind: code-review
status: success
summary: Found two likely regressions in the patch
artifacts: []
suggested_next_steps:
   - Verify the latest provider CLI flag names before applying the fix
---
```

Why this is safer:

- The caller remains in control.
- `aiman` does not invent hidden routing policy.
- Structured report metadata can be inspected before it becomes new work.
- You avoid prompt injection moving through uncontrolled transcript replay.

## Provider Adapter Contract

Keep the cross-provider contract very small.

Suggested internal shape:

```ts
type ProviderAdapter = {
   id: string;
   detect(): Promise<ValidationIssue[]>;
   validateAgent(agent: AgentDefinition): ValidationIssue[];
   prepare(agent: AgentDefinition, input: PreparedRunInput): PreparedInvocation;
   parseCompletedRun(input: CompletedRunInput): Promise<PersistedRunRecord>;
};
```

Important adapter responsibilities:

- Resolve the executable path.
- Build argv without going through a shell.
- Set cwd and an allowlisted environment.
- Parse provider-native machine-readable output when supported.

Do not force one fake universal prompt format. The only universal layer should be execution metadata plus the optional `report.md` handoff contract.

## Safety Rules

These should be hard requirements in v1:

- Launch CLIs with `spawn()` or `execFile()`, never shell-interpolated strings.
- Use explicit arg arrays and explicit cwd.
- Allowlist environment variables passed into child processes.
- Apply per-run timeouts and cancellation via runtime controls.
- Drain `stdout` and `stderr` continuously.
- Record exit code, signal, start time, end time, and duration.
- Persist failures as normal run results so callers can inspect them.
- Require explicit approval for destructive modes when the task requests write, shell, or network access beyond policy.
- Cap concurrency so one repo cannot accidentally fan out into runaway local subprocesses.

## What To Avoid

- No built-in "main agent" inside `aiman`.
- No peer-to-peer free-form agent mesh in v1.
- No autonomous routing policy hidden inside the runtime.
- No universal prompt DSL that rewrites provider-native instructions.
- No hidden daemon requirement for normal local use.
- No shell-based command assembly.
- No transcript-forwarding as the default communication mechanism.

## Minimal CLI Surface

Keep the first command set small:

- `aiman list`
- `aiman show <agent>`
- `aiman run <agent> --task "..."`
- `aiman inspect <run-id>`

Nice next steps after that:

- Add richer report validation when callers want stricter machine-readable follow-up data.
- Expand artifact helpers if specialists need more than file-path references in reports.

I would avoid adding a large orchestration DSL early. Most of the value is in stable agent files, stable run storage, and safe adapter execution.

## Recommended Build Order

1. Implement agent file loading and validation.
2. Implement one provider adapter well.
3. Implement repo-local run storage under `.aiman/runs/`.
4. Implement safe subprocess execution with logs, timeout, and cancel.
5. Implement file-first `report.md` handoff support for external callers.
6. Add a second provider adapter only after the first one is operational.

## Bottom Line

The reliable version of `aiman` is not "a network of agents talking freely," and it is not "the main orchestrator."

It is:

- a local agent manager,
- a few reusable specialist files,
- thin CLI adapters,
- structured file-first handoff returned to the caller,
- and durable local run state.

That gives external parent agents the cheapness and provider-native behavior they want without burying product-level orchestration inside `aiman`.

## Sources

- [LangChain multi-agent docs](https://docs.langchain.com/oss/python/langchain/multi-agent)
- [OpenAI safety in building agents](https://developers.openai.com/api/docs/guides/agent-builder-safety/)
- [Google A2A announcement](https://developers.googleblog.com/a2a-a-new-era-of-agent-interoperability/)
- [A2A protocol repository](https://github.com/a2aproject/A2A)
- [Node.js child_process docs](https://nodejs.org/api/child_process.html)
- [Claude Code hooks docs](https://code.claude.com/docs/en/hooks)
