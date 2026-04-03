# Authoring Profiles

Use this guide when creating or refining authored `aiman` profiles.

The goal is not just to produce a valid Markdown file. The goal is to produce a profile that is easy to understand, correctly configured, and reliable under repeated use.

## Start With The Contract

Before writing the file, lock down the runtime contract:

- What job should the profile own, and what should it explicitly not own?
- Who will call it: a human, a parent agent, or automation?
- What should a successful answer look like: short text, structured findings, a patch, artifacts, or a report?
- Should it be `safe` or `yolo`?
- Which provider and model are the best fit for that job?
- Does it require any local `aiman` skills?
- What stable repo guidance belongs in `AGENTS.md#Aiman Runtime Context`?
- What small smoke task can verify that the authored contract works?

If one of those answers is unknown, ask follow-up questions before creating the profile instead of guessing.

## Current Frontmatter Contract

New authored profiles should use:

- required `name`
- required `provider`
- required `description`
- required `model`
- required `mode`
- required `reasoningEffort`
- optional `skills`

Use `mode: safe` for read-only or approval-gated work and `mode: yolo` only when the profile is expected to edit or write files.

`reasoningEffort` is provider-specific:

- `codex`: `none`, `low`, `medium`, or `high`
- `gemini`: `none`

Use `none` when the selected provider or model does not support configurable reasoning effort.

Profiles that use `permissions`, `contextFiles`, or `requiredMcps` are invalid. Rewrite them to the current contract instead of preserving the old fields.

## Strong Defaults

Use these defaults unless there is a clear reason not to:

- Start with `mode: safe`.
- For `codex`, start with `reasoningEffort: medium` unless the task clearly needs less or more depth.
- For `gemini`, use `reasoningEffort: none`.
- Make one profile own one concrete specialty.
- Keep the body explicit and direct instead of clever or generic.
- Include `{{task}}` for runnable profiles.
- Put reusable repo guidance in `AGENTS.md#Aiman Runtime Context`, not inline in every profile.
- Keep `skills` limited to real local `aiman` skill dependencies.

## Check Before First Use

Use `aiman profile check <name>` before the first smoke run.

- Blocking errors fail the command with exit code `1`.
- Warnings still exit `0`.
- The check is static only: no live provider launch and no auth requirement.

Treat it as the contract check for the file itself. Use the smoke run only after the static contract is clean enough to be worth exercising.

## Shape A Reliable Prompt

A strong authored profile usually has these sections:

1. `Role`
2. `Task Input`
3. `Instructions`
4. `Constraints`
5. `Expected Output`

That shape helps reliability because the profile can separate:

- what it is
- what changes per run
- what rules are stable
- what the caller expects back

## What To Put In The Body

Good profile bodies usually:

- name the specialty clearly
- explain the decision standard or bar for quality
- describe the exact output shape
- state what to do when evidence is missing
- keep repo-specific guidance small and explicit

Avoid bodies that:

- try to cover many unrelated jobs
- depend on hidden repo context
- bury the required output format in long prose
- silently assume write access
- ask the model to improvise missing requirements that the caller should supply

## Use Runtime Context Deliberately

If the repo needs shared `aiman` guidance, put it in `AGENTS.md#Aiman Runtime Context`.

Good runtime-context content:

- build and verification commands
- important paths
- project terminology
- stable safety rules

Do not put these there:

- task-specific instructions
- volatile planning notes
- prompt text that belongs in one profile only

If the extra context is task-specific rather than repo-wide, keep it in `{{task}}` instead.

## Follow-Up Questions For Parent Agents

When a parent agent is asked to create an `aiman` profile and the contract is still fuzzy, it should ask focused follow-up questions like:

- What exact outcome should this profile own?
- Should it be `safe` or `yolo`?
- Which provider or model do you want, if any?
- What should the output look like on a good run?
- Does the repo need anything added to `AGENTS.md#Aiman Runtime Context`?
- Does it depend on any local `aiman` skills?
- Should it optimize for speed, depth, or strict formatting?

Prefer short, high-signal questions with recommended defaults instead of open-ended brainstorming.

## Reliability Checklist

Before calling the profile done, verify:

- the frontmatter is complete and current
- the body includes `{{task}}`
- `mode` is no broader than necessary
- `reasoningEffort` matches the selected provider
- any declared `skills` actually exist
- `aiman profile show <name>` matches the intended contract
- `aiman profile check <name>` has no blocking errors
- one small `aiman run <name> --task ...` smoke test behaves as expected

## Practical Workflow

1. Gather the missing requirements.
2. Create the first scaffold with `aiman profile create`.
3. Tighten the body around one concrete outcome.
4. Add `skills` only when justified.
5. Verify with `aiman profile show`.
6. Run `aiman profile check`.
7. Run a small smoke task.
8. Refine the body if the answer shape or reliability is off.

## Example Profiles

Start from one of these when you want a reliable narrow shape instead of inventing one from scratch:

- `docs/examples/project-change-reviewer.md`
- `docs/examples/standalone-daily-doc-checker.md`
- `docs/examples/read-only-security-auditor.md`
