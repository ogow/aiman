---
name: aiman-agent-authoring
description: Use when creating, reviewing, or refining authored `aiman` agents so they fit the host project, follow the current agent contract, and produce reliable outputs.
---

# Aiman Agent Authoring

Use this skill when the task is to create, review, or tighten an authored `aiman` agent.

The goal is not just to produce a valid Markdown file. The goal is to produce an agent that owns one clear job, matches the host repo's way of working, and behaves predictably under repeated use.

## Read First

Open only the smallest relevant files in the host repo:

- `AGENTS.md` for repo norms, writing style, and routing guidance
- `MEMORY.md` and the latest `.agents/memories/YYYY-MM-DD.md` when the repo keeps active agent memory
- `docs/agent-authoring.md` when the repo already documents its preferred `aiman` authoring contract
- `docs/cli.md` or equivalent for the live `aiman agent ...` commands
- `docs/agent-baseline.md` or equivalent when deciding what belongs in shared bootstrap context such as `AGENTS.md`
- `README.md`, `ARCHITECTURE.md`, `package.json`, and the target code area when you need to understand what specialists the project actually needs

If the repo does not have those files, infer carefully from the codebase and the user's stated goal instead of pretending the files exist.

## Decide Whether A New Agent Should Exist

Before drafting anything, confirm that the job deserves its own agent:

- It owns one repeatable specialty.
- The expected output shape is stable enough to encode.
- The project will likely use it more than once.
- Its boundaries are clearer as a named specialist than as a one-off task prompt.

If that is still unclear, read [references/agent-selection.md](references/agent-selection.md).

## Current Agent Contract

New authored `aiman` agents should use required frontmatter only:

- `name`
- `provider`
- `description`
- `mode`
- `reasoningEffort`

Rules:

- `model` is required for every agent.
- For `gemini`, `model` may be a concrete model id or `auto`.
- `model: auto` is valid only for `gemini`.
- `mode` must be `safe` or `yolo`.
- Use `safe` for read-only or approval-gated work.
- Use `yolo` only when the agent is expected to edit or write files.
- `reasoningEffort` is provider-specific.
- For `codex`, use `none`, `low`, `medium`, or `high`.
- For `gemini`, use `none`.
- Runnable agents should include `{{task}}`.
- Agents that declare legacy fields such as `permissions`, `contextFiles`, `skills`, or `requiredMcps` should be rewritten to the current contract.

## Contract-First Workflow

1. Read the host repo context that matters for the agent's job.
2. Lock the contract before writing:
   - what exact job the agent owns
   - what it explicitly does not own
   - who will call it
   - what a good result looks like
   - whether it should be `safe` or `yolo`
   - which provider and model are the best fit
   - what stable repo guidance belongs in shared bootstrap context instead of the agent body
   - what small smoke task can verify the contract
3. If one of those answers is truly unknown and cannot be inferred safely, ask short focused follow-up questions instead of guessing.
4. Create the first scaffold with `aiman agent create`.
5. Tighten the body around one concrete specialty and one explicit output shape.
6. Validate with `aiman agent show` and `aiman agent check`.
7. Run one small `aiman run <agent> --task ...` smoke task when local validation is possible.
8. Refine the body if the answer shape, boundaries, or reliability are off.

Use [references/contract-checklist.md](references/contract-checklist.md) when working through step 2.

## Prompt Shape

A reliable authored agent usually has these sections:

1. `Role`
2. `Task Input`
3. `Instructions`
4. `Constraints`
5. `Expected Output`

That shape keeps the agent explicit about what it is, what changes per run, what rules stay fixed, and what the caller should receive back.

Use [references/prompt-template.md](references/prompt-template.md) when drafting from scratch.

## Strong Defaults

- Start with one agent owning one concrete specialty.
- Start with `provider: codex`, `model: gpt-5.4-mini`, and `reasoningEffort: medium` unless the job clearly needs something else.
- For `gemini`, use `reasoningEffort: none` and set `model: auto` unless you need to pin one explicitly.
- Prefer direct instructions over persona-heavy prose.
- Tell the agent what to do when evidence is missing instead of letting it improvise.
- Put stable repo guidance in shared bootstrap context such as `AGENTS.md`, not inline in every agent.
- Keep output requirements concrete enough that a reviewer can tell whether the run succeeded.

## Bad Smells

- A generic "help with anything" agent.
- One agent trying to own several unrelated jobs.
- Output requirements buried in long prose.
- Large copies of repo rules pasted into every agent.
- Hidden assumptions about repo context, tools, or write access.
- Legacy frontmatter fields preserved out of convenience.

## Expected Outcome

When you use this skill well, the result should be:

- one focused authored `aiman` agent file
- a clear reason that this agent should exist
- a contract that matches the host repo and real usage
- a short validation path using `aiman agent show`, `aiman agent check`, and a smoke run
