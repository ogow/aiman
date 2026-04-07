# Authoring Agents

Use this guide when creating or refining authored `aiman` agents.

The goal is not just to produce a valid Markdown file. The goal is to produce an agent that is easy to understand, correctly configured, and reliable under repeated use.

## Start With The Contract

Before writing the file, lock down the runtime contract:

- What job should the agent own, and what should it explicitly not own?
- Who will call it: a human, a parent agent, or automation?
- What should a successful answer look like: short text, structured findings, a patch, artifacts, or a report?
- Which provider and model are the best fit for that job?
- What stable repo guidance belongs in the repo's shared bootstrap context files such as `AGENTS.md`?
- What small smoke task can verify that the authored contract works?

If one of those answers is unknown, ask follow-up questions before creating the agent instead of guessing.

## How To Think About Agents

Create a dedicated agent only when the job deserves a named specialist:

- it owns one repeatable specialty
- the boundaries are clear enough to explain in a few lines
- the expected `result` shape is stable enough for another agent to consume
- the same style of task will likely happen more than once

A strong authored agent owns:

- one clear job
- one explicit bar for success
- one compact blocked path when evidence is missing
- one predictable handoff to the next stage

Good framing questions:

- What exact outcome should this agent own?
- What should it explicitly not own?
- What evidence must exist before it decides?
- What should another agent be able to learn from `result.json` without rereading logs?
- When should it stop instead of continuing to explore?

The practical rule is: keep the outer transport contract strict and the task-specific `result` flexible.
`aiman` owns the shared JSON success envelope. The authored body should define the task-specific `resultType`, `result` shape, and stop behavior.

## Current Frontmatter Contract

New authored agents should use:

- required `name`
- required `provider`
- required `description`
- required `reasoningEffort` (optional for Gemini)

`model` is provider-specific:

- `codex`: required and must name an explicit model
- `gemini`: required; use an explicit model id or `auto` to let Gemini choose its automatic default model

`reasoningEffort` is provider-specific:

- `codex`: required; use `none`, `low`, `medium`, or `high`
- `gemini`: optional; defaults to `none` if omitted

Use `none` when the selected provider or model does not support configurable reasoning effort.

Agents that use `permissions`, `contextFiles`, or `requiredMcps` are invalid. Rewrite them to the current contract instead of preserving the old fields.

## Strong Defaults

Use these defaults unless there is a clear reason not to:

- For `codex`, start with `reasoningEffort: medium` unless the task clearly needs less or more depth.
- For `gemini`, `reasoningEffort` is optional and defaults to `none`.
- For `gemini`, use `model: auto` when you want Gemini's automatic model selection instead of pinning one explicitly.
- Make one agent own one concrete specialty.
- Keep the body explicit and direct instead of clever or generic.
- Include `{{task}}` for runnable agents.
- Put reusable repo guidance in the repo's shared context files such as `AGENTS.md`, not inline in every agent.

## Check Before First Use

Use `aiman agent check <name>` before the first smoke run.

- Blocking errors fail the command with exit code `1`.
- Warnings still exit `0`.
- The check is static only: no live provider launch and no auth requirement.

Treat it as the contract check for the file itself. Use the smoke run only after the static contract is clean enough to be worth exercising.

## Shape A Reliable Prompt

A strong authored agent usually has these sections:

1. `Role`
2. `Task Input`
3. `Instructions`
4. `Constraints`
5. `Stop Conditions`
6. `Expected Output`

That shape helps reliability because the agent can separate:

- what it is
- what changes per run
- what rules are stable
- what the caller expects back

## What To Put In The Body

Good agent bodies usually:

- name the specialty clearly
- explain the decision standard or bar for quality
- describe the exact structured output shape
- state what to do when evidence is missing
- tell the agent when it should stop
- keep repo-specific guidance small and explicit

`aiman` appends one runtime-enforced JSON success contract automatically. The authored body should still describe the expected result shape clearly, but it should not rely on free-form prose output. Use `{{artifactsDir}}` only when the body needs to reference the exact run artifact path directly.

Good `Expected Output` guidance usually names:

- the intended `resultType`
- the fields that should appear inside `result`
- the meaning of `handoff.outcome` when a few values are especially useful
- what belongs in `artifacts/` instead of inline JSON

For example, a build-oriented agent can stay flexible without being vague:

- `resultType: "build.v1"`
- `result.changedFiles`
- `result.workCompleted`
- `result.verification`
- `result.remainingWork`
- `result.notes`
- `handoff.outcome: "done" | "blocked" | "needs_followup"`

Avoid bodies that:

- try to cover many unrelated jobs
- depend on hidden repo context
- bury the required output format in long prose
- silently assume extra repo-specific rules the caller cannot see
- ask the model to improvise missing requirements that the caller should supply

## Debug Authored Agents

Use the fastest possible loop:

1. Run `aiman agent check <name>`.
2. Run one tiny smoke task with `aiman run <name> --task ...`.
3. Read `aiman runs show <run-id>`.
4. Read `aiman runs inspect <run-id> --stream prompt`.
5. Read `aiman runs inspect <run-id> --stream run`.
6. Read `aiman runs inspect <run-id> --stream stdout|stderr` only when the failure is still unclear.

What to look for:

- vague `result`: tighten `Expected Output`
- wandering behavior: add `Stop Conditions`
- guessing: add explicit missing-evidence behavior
- malformed success JSON: make the body describe the task-specific result more clearly and avoid encouraging extra prose

Use [docs/agent-debugging.md](/Users/ogow/Code/aiman/docs/agent-debugging.md) for the full debugging playbook.

## Use Runtime Context Deliberately

If the repo needs shared `aiman` guidance, put it in the shared bootstrap context files configured for the repo, usually `AGENTS.md`.

Good runtime-context content:

- build and verification commands
- important paths
- project terminology
- stable safety rules

Do not put these there:

- task-specific instructions
- volatile planning notes
- prompt text that belongs in one agent only

If the extra context is task-specific rather than repo-wide, keep it in `{{task}}` instead.

## Follow-Up Questions For Parent Agents

When a parent agent is asked to create an `aiman` agent and the contract is still fuzzy, it should ask focused follow-up questions like:

- What exact outcome should this agent own?
- Which provider or model do you want, if any?
- What should the output look like on a good run?
- Does the repo need anything added to the repo's shared context files such as `AGENTS.md`?
- Should it optimize for speed, depth, or strict formatting?

Prefer short, high-signal questions with recommended defaults instead of open-ended brainstorming.

## Reliability Checklist

Before calling the agent done, verify:

- the frontmatter is complete and current
- the body includes `{{task}}`
- the body makes the task-specific `result` shape clear enough that another agent can consume it from `result.json`
- any desired read-only or conservative behavior is stated in the body
- `reasoningEffort` matches the selected provider
- `model` is explicit and valid for the selected provider, including `model: auto` only for Gemini agents
- `aiman agent show <name>` matches the intended contract
- `aiman agent check <name>` has no blocking errors
- one small `aiman run <name> --task ...` smoke test behaves as expected

## Practical Workflow

1. Gather the missing requirements.
2. Create the first scaffold with `aiman agent create`.
3. Tighten the body around one concrete outcome.
4. Verify with `aiman agent show`.
5. Run `aiman agent check`.
6. Run a small smoke task.
7. Refine the body if the answer shape or reliability is off.

## Example Agents

Start from one of these when you want a reliable narrow shape instead of inventing one from scratch:

- `docs/examples/targeted-build-specialist.md`
- `docs/examples/project-change-reviewer.md`
- `docs/examples/standalone-daily-doc-checker.md`
- `docs/examples/read-only-security-auditor.md`
