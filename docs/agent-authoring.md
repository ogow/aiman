# Authoring Agents

Use this guide when creating or refining authored `aiman` agents.

The goal is not just to produce a valid agent file. The goal is to produce an agent that is easy to understand, safe to run, and reliable under repeated use.

## Start With The Contract

Before writing the file, lock down the runtime contract:

- What job should the agent own, and what should it explicitly not own?
- Who will call it: a human, a parent agent, or automation?
- What should a successful answer look like: short text, structured findings, a patch, artifacts, or a report?
- What permissions does it actually need: `read-only` or `workspace-write`?
- Which provider and model are the best fit for that job?
- What stable repo context should be attached through `contextFiles`?
- Does it require provider-native `skills`?
- Does it require specific `requiredMcps` to be ready before launch?
- What small smoke task can verify that the authored contract works?

If one of those answers is unknown, ask follow-up questions before creating the agent instead of guessing.

## Strong Defaults

Use these defaults unless there is a clear reason not to:

- Start with `permissions: read-only`.
- Make one agent own one concrete specialty.
- Keep the body explicit and direct instead of clever or generic.
- Include `{{task}}` for runnable agents.
- Put reusable repo guidance in `contextFiles`, not inline in every task.
- Declare `requiredMcps` when the workflow depends on them.
- Keep `skills` limited to provider-native capabilities the agent truly depends on.

## Check Before First Use

Use `aiman agent check <name>` before the first smoke run.

- Blocking errors fail the command with exit code `1`.
- Warnings still exit `0`.
- The check is static only in v1: no live provider launch, no MCP probing, no auth requirements.

Treat it as the contract check for the file itself. Use the smoke run only after the static contract is clean enough to be worth exercising.

## Shape A Reliable Prompt

A strong authored agent usually has these sections:

1. `Role`
2. `Task Input`
3. `Instructions`
4. `Constraints`
5. `Expected Output`

That shape helps reliability because the agent can separate:

- what it is
- what changes per run
- what rules are stable
- what the caller expects back

## What To Put In The Body

Good agent bodies usually:

- name the specialty clearly
- explain the decision standard or bar for quality
- describe the exact output shape
- state what to do when evidence is missing
- keep repo-specific guidance explicit and small

Avoid bodies that:

- try to cover many unrelated jobs
- depend on hidden repo context
- bury the required output format in long prose
- silently assume write access
- ask the model to improvise missing requirements that the caller should supply

## Use `contextFiles` Deliberately

Attach only stable files that genuinely improve the run:

- repo baseline docs
- architecture summaries
- style guides
- narrow subsystem references

Do not use `contextFiles` for:

- temporary task instructions
- volatile planning notes
- broad router files you do not want in every run

If the extra context is task-specific rather than stable, keep it in `{{task}}` instead.

## Follow-Up Questions For Parent Agents

When a parent agent is asked to create an `aiman` agent and the contract is still fuzzy, it should ask focused follow-up questions like:

- What exact outcome should this agent own?
- Should it be `read-only` or `workspace-write`?
- Which provider or model do you want, if any?
- What should the output look like on a good run?
- Which repo docs or paths should be attached with `contextFiles`?
- Does it depend on any MCP servers or installed skills?
- Should it optimize for speed, depth, or strict formatting?

Prefer short, high-signal questions with recommended defaults instead of open-ended brainstorming.

## Reliability Checklist

Before calling the agent done, verify:

- the frontmatter is complete and valid
- the body includes `{{task}}` when it should
- permissions are no broader than necessary
- `contextFiles` are explicit, repo-relative, and stable
- `skills` and `requiredMcps` are truly required
- `aiman agent show <name>` matches the intended contract
- `aiman agent check <name>` has no blocking errors
- one small `aiman run <name> --task ...` smoke test behaves as expected

## Practical Workflow

1. Gather the missing requirements.
2. Create the first scaffold with `aiman agent create`.
3. Tighten the body around one concrete outcome.
4. Add `contextFiles`, `skills`, or `requiredMcps` only when justified.
5. Verify with `aiman agent show`.
6. Run `aiman agent check`.
7. Run a small smoke task.
8. Refine the body if the answer shape or reliability is off.

## Example Agents

Start from one of these when you want a reliable narrow shape instead of inventing one from scratch:

- `docs/examples/project-change-reviewer.md`
- `docs/examples/standalone-daily-doc-checker.md`
- `docs/examples/read-only-security-auditor.md`
