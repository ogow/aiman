---
name: aiman
description: Use when creating, reviewing, or refining authored `aiman` agents so they fit the host project, follow the current agent contract, and produce reliable outputs.
---

# Aiman

Use this skill when the task is to create, review, or tighten an authored `aiman` agent.

The goal is not just to produce a valid Markdown file. The goal is to produce an agent that owns one clear job, is easy for another human to choose correctly, and behaves predictably under repeated use.

## Read First

This skill should work when installed in a home folder or any project. Do not assume the host repo has this repo's docs.

Open only the smallest relevant context in the host environment:

- the repo's top-level operator instructions if it has any, such as `AGENTS.md`
- active project memory or task notes if the repo keeps them
- existing authored agents if you need to match local patterns
- the local `aiman` CLI help output when command details matter
- the target code area, tests, configs, and package/runtime manifest that define the job the agent will serve
- the repo's README or architecture notes if they are needed to understand what specialists the project actually needs

If those files do not exist, infer carefully from the codebase and the user's stated goal instead of pretending they exist.

## Decide Whether A New Agent Should Exist

Before drafting anything, confirm that the job deserves its own agent:

- It owns one repeatable specialty.
- The expected output shape is stable enough to encode.
- The project will likely use it more than once.
- Its boundaries are clearer as a named specialist than as a one-off task prompt.
- You can describe when it should stop.
- You can describe what it should do when key evidence is missing.

If that is still unclear, read [references/agent-selection.md](references/agent-selection.md).

## Current Agent Contract

New authored `aiman` agents should use current frontmatter only:

- `name`
- `provider`
- `description`
- `model`
- `reasoningEffort` when required
- optional `resultMode`
- optional informational `capabilities`

Rules:

- `model` is required for every agent.
- For `codex`, `reasoningEffort` must be `none`, `low`, `medium`, or `high`.
- For `gemini`, `reasoningEffort` defaults to `none`.
- `resultMode` defaults to `text`.
- Use `resultMode: schema` only when another tool or agent needs machine-validated JSON.
- For `gemini`, `model` may be a concrete model id or `auto`.
- `model: auto` is valid only for `gemini`.
- Runnable agents should include `{{task}}`.
- Agents that declare legacy fields such as `mode`, `permissions`, `contextFiles`, `skills`, or `requiredMcps` should be rewritten to the current contract.
- `aiman` appends the outer JSON contract only for `resultMode: schema`; text-mode agents should optimize for a strong human answer and use `artifacts/` for larger work products.

## What Makes An Agent Reliable

Lock these decisions before you write or revise the file:

- one exact job the agent owns
- explicit non-goals so callers know when not to use it
- the intended caller: human, parent agent, or automation
- the evidence the agent must gather before deciding
- what the agent should do when required evidence is missing
- when the agent should stop instead of continuing to explore
- whether the result should be human-facing `text` or machine-facing `schema`
- what a good run must contain every time
- what belongs in shared repo bootstrap context instead of the agent body

If those answers are still fuzzy, the agent boundary is still fuzzy. Use [references/contract-checklist.md](references/contract-checklist.md) and tighten the contract before drafting.

## Contract-First Workflow

1. Read the host repo context that matters for the agent's job.
2. Lock the contract before writing:
   - what exact job the agent owns
   - what it explicitly does not own
   - who will call it
   - what a good result looks like
   - which provider and model are the best fit
   - whether the result should be `text` or `schema`
   - what the agent should do when evidence is missing
   - when the agent should stop
   - what stable repo guidance belongs in shared bootstrap context instead of the agent body
   - what small smoke task can verify the contract
3. If one of those answers is truly unknown and cannot be inferred safely, ask short focused follow-up questions instead of guessing.
4. Create the first scaffold with `aiman agent create`.
5. Tighten the body around one concrete specialty and one explicit output shape.
6. Use a reliable section shape with XML tags (headings are optional/human-only):
   - `<role>`
   - `<task_input>` (containing `{{task}}`)
   - `<instructions>`
   - `<constraints>`
   - `<stop_conditions>`
   - `<expected_output>`
7. Make the body say what to do when evidence is missing instead of letting the model improvise.
8. Validate with `aiman agent show` and `aiman agent check`.
9. Run one small `aiman run <agent> --task ...` smoke task when local validation is possible.
10.   Refine the body if the answer shape, stop behavior, or boundary discipline are off.

Use [references/prompt-template.md](references/prompt-template.md) when drafting from scratch.

## Result Mode Choice

Pick one mode deliberately:

- Use `text` when a human is the real reader and the best output is a concise answer, review, plan, or explanation.
- Use `schema` when another tool, script, or parent agent needs fixed machine-readable structure.
- Do not choose `schema` just because structure feels cleaner. If the real consumer is human, text mode is usually stronger and easier to maintain.

For `schema` agents:

- Describe the task-specific fields expected inside `result`.
- Name the allowed `outcome` values if they matter.
- Say whether optional `next` should appear.
- Do not re-specify the entire outer runtime envelope; `aiman` already enforces it.

## Prompt Shape

A reliable authored agent is built on a foundation of XML tags. While Markdown headings (e.g., `# Instructions`) can be helpful for human readability and editor navigation, they are optional for the model. Use these XML sections to define the agent's logic:

1. `<role>`
2. `<task_input>`
3. `<instructions>`
4. `<constraints>`
5. `<stop_conditions>`
6. `<expected_output>`

### Structural Integrity with XML

To increase agent robustness, especially when the task contains Markdown or mixed data, use XML tags for all structural boundaries. This provides a "hard" closing signal that prevents the model from conflating instructions with user data.

- **Wrap `{{task}}` in `<task>` or `<input>` tags.** This prevents the model from conflating the task's user-supplied Markdown with the agent's core instructions.
- **Use `<instructions>` and `<constraints>` tags** when the rules are dense enough that boundaries matter.
- **Use `<context>` or `<documents>` tags** when an agent receives multi-file input or complex repo state.
- **Use `<expected_output>` tags** when the final answer shape needs to stay unambiguous.
- Do not ask for hidden chain-of-thought or private reasoning. Ask for concise visible conclusions, checks, or decision criteria instead.

## Strong Defaults

- Start with one agent owning one concrete specialty.
- Start with `provider: codex`, `model: gpt-5.4-mini`, and `reasoningEffort: medium` unless the job clearly needs something else.
- For `gemini`, use `reasoningEffort: none` and set `model: auto` unless you need to pin one explicitly.
- Start with `resultMode: text` unless downstream automation truly needs structured output.
- Prefer direct instructions over persona-heavy prose.
- Tell the agent what to do when evidence is missing instead of letting it improvise.
- Add explicit `Stop Conditions`; missing stop rules are a reliability problem.
- Put stable repo guidance in shared bootstrap context such as `AGENTS.md`, not inline in every agent.
- Keep `Expected Output` concrete enough that a reviewer can tell whether the run succeeded.
- If the agent should stay read-only or conservative, say that in the body instead of inventing frontmatter controls.

## Bad Smells

- A generic "help with anything" agent.
- One agent trying to own several unrelated jobs.
- Output requirements buried in long prose.
- No stated behavior for missing evidence.
- No `Stop Conditions`, so the agent keeps exploring or overproducing.
- Large copies of repo rules pasted into every agent.
- Hidden assumptions about repo context, tools, or write access.
- Legacy frontmatter fields preserved out of convenience.
- `schema` mode chosen without a real machine consumer.
- `Expected Output` that says "be helpful" or "be concise" without describing the actual deliverable.

## Expected Outcome

When you use this skill well, the result should be:

- one focused authored `aiman` agent file
- a clear reason that this agent should exist
- a contract that matches the host repo and real usage
- clear stop behavior and missing-evidence behavior
- an output shape that another human or tool can trust
- a short validation path using `aiman agent show`, `aiman agent check`, and a smoke run
