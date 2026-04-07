---
name: aiman-profile-authoring
description: Use when creating, reviewing, or refining authored aiman agents so they follow the current contract, choose clear boundaries, and produce reliable structured results.
---

# Aiman Agent Authoring

Use this skill when the task is to create, review, or tighten an authored `aiman` specialist agent.

## Read First

Open only the smallest relevant files:

- `docs/agent-authoring.md` for the current authoring checklist
- `docs/agent-debugging.md` for the practical debugging workflow
- `docs/cli.md` for the live `aiman agent ...`, `aiman run ...`, and `aiman runs ...` commands
- `docs/agent-runtime.md` when runtime behavior, `result.json`, or provider parsing matters
- `docs/agent-baseline.md` when deciding what belongs in shared repo bootstrap context such as `AGENTS.md`
- `docs/examples/` when a narrow starter shape is more useful than freehand prompt writing
- `references/agent-design.md` when the real question is how to think about agent boundaries and output contracts
- `references/debugging.md` when an agent is weak, vague, or failing and needs a structured debug pass

## Current Contract

- The public authored unit is an agent under `.aiman/agents/<name>.md` or `~/.aiman/agents/<name>.md`.
- New agents should use required frontmatter only: `name`, `provider`, `description`, `model`, and `reasoningEffort` when the provider requires it.
- `reasoningEffort` is provider-specific: `codex` allows `none|low|medium|high`, while `gemini` defaults to `none`.
- Agents that use `permissions`, `contextFiles`, `skills`, or `requiredMcps` are invalid and should be rewritten.
- Runnable agents should include `{{task}}`.
- A reliable agent body usually uses these sections: `Role`, `Task Input`, `Instructions`, `Constraints`, `Stop Conditions`, and `Expected Output`.
- `aiman` enforces the outer JSON success envelope at runtime. The authored body should define the task-specific `result` shape and the intended `handoff` behavior.

## Runtime Context

- `aiman` does not inject a managed runtime-context section into the prompt.
- Shared repo bootstrap context is configured at the harness level through `contextFileNames`, usually pointing at files such as `AGENTS.md`.
- All agents in the same repo share that same configured context file list.
- Use `docs/agent-baseline.md` as a drafting reference for what belongs in shared repo bootstrap context.

## How To Think About Agents

Use an authored agent only when the job deserves a named specialist:

- one repeatable specialty, not a generic helper
- a stable enough output shape that another agent can consume it
- clear ownership boundaries, including what the agent explicitly does not own
- a caller that benefits from predictable handoff instead of ad hoc prose

Design the contract before you draft the Markdown file:

- what exact job the agent owns
- what evidence it must gather before deciding
- what should go in `result`
- what another agent should learn from `handoff`
- when the agent should stop instead of continuing to explore

The rule of thumb is: strict transport contract, flexible agent contract.
`aiman` owns the outer JSON envelope. The authored body owns the specific `resultType`, `result` shape, and stop behavior.

## Workflow

1. Lock the contract: owned job, provider, model, output shape, stop conditions, and what shared repo guidance should live in the configured context files.
2. Keep one agent focused on one concrete specialty.
3. Create or revise the file with `aiman agent create`, then tighten the body around the exact outcome.
4. State what the agent should do when evidence is missing instead of letting it guess.
5. Validate with `aiman agent show` and `aiman agent check`.
6. Run one small smoke task with `aiman run <agent> --task ...`.
7. Inspect the recorded `result.json`, rendered prompt, and logs when the smoke run is vague, malformed, or blocked.
8. If shared repo guidance is missing, update the repo bootstrap context file such as `AGENTS.md` instead of copying the same rules into every agent.

## Strong Defaults

- Start with `provider: codex`, `model: gpt-5.4-mini`, and `reasoningEffort: medium` unless the task clearly needs something else.
- For `gemini`, use `reasoningEffort: none`.
- If the agent should stay read-only or conservative, say that in the body instead of relying on frontmatter.
- Prefer plain, direct instructions over clever framing.
- Keep frontmatter minimal; repo context belongs in shared context files, not extra agent fields.
- Put the real specificity into `Expected Output`:
   - the `resultType`
   - the fields expected inside `result`
   - allowed `handoff.outcome` values when useful
   - what counts as blocked or incomplete

## Debugging Workflow

When an authored agent is weak or failing:

1. Run `aiman agent check <name>` to catch frontmatter and body-shape issues.
2. Run a tiny smoke task with `aiman run <name> --task ...`.
3. Inspect `aiman runs show <run-id>` for the parsed `summary`, `resultType`, `result`, `handoff`, and terminal error.
4. Inspect `aiman runs inspect <run-id> --stream prompt` to confirm the actual rendered prompt matches the intended contract.
5. Inspect `aiman runs inspect <run-id> --stream run` to read the canonical `result.json`.
6. Inspect `aiman runs inspect <run-id> --stream stdout|stderr` when the provider output or parsing looks suspicious.
7. Tighten the authored body based on the failure mode:
   - vague `result`: make `Expected Output` more explicit
   - wandering behavior: add `Stop Conditions`
   - guessing: add clearer missing-evidence rules
   - malformed success JSON: clarify that the body must fill the runtime envelope with the expected task-specific fields

## Bad Smells

- Generic "help with anything" prompts.
- Implicit write access expectations or hidden behavior rules that are not stated in the body.
- Agents authored with legacy `permissions:` or `mode:`.
- Repeating large repo instructions in every agent instead of keeping them in shared repo bootstrap context such as `AGENTS.md`.
- Inventing per-agent `contextFiles` or `skills` settings instead of using the repo's shared `contextFileNames` configuration.
- `Expected Output` that only says "be concise" or "return a good answer" without describing the task-specific `result`.
