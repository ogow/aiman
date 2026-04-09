# Agent Design Reference

Use this reference when the real question is not "how do I write the Markdown?" but "should this be an agent at all, and what contract should it own?"

## Start With The Job

An authored `aiman` agent is worth creating when:

- the job is repeatable
- the boundaries are clearer as a named specialist
- the expected deliverable is stable enough for another human or agent to consume
- the same style of task will likely happen more than once

Avoid creating a dedicated agent when the work is:

- too broad to own cleanly
- a one-off prompt
- mostly human judgment with no stable deliverable shape
- likely to drift between several unrelated jobs

## Choose The Right Boundary

A strong agent owns:

- one concrete specialty
- one clear bar for success
- one predictable outcome
- one clear next step when useful

Ask these questions before authoring:

- What exact outcome should this agent own?
- What should it explicitly not own?
- Who is the caller: a human, a parent agent, or automation?
- What is the smallest useful thing another agent should learn from this run?
- What evidence must exist before the agent can decide?

## Design For The Next Agent

`aiman` supports two deliberate patterns: normal text answers and schema-validated structured results. The authored body should choose one and make the expected deliverable obvious.

Good `Expected Output` guidance usually names:

- for `text` agents: what the final answer should cover
- for `schema` agents: the fields inside `result`, the allowed `outcome` values, and whether `next` should appear
- what belongs in `artifacts/` instead of inline output

Another reader should normally be able to understand the run from:

- `summary`
- `finalText` or `structuredResult`
- optional `outcome`
- optional `next`
- `artifacts`

It should not need to scrape prose from logs to understand the outcome.

## Add Stop Conditions

Weak agents often wander because the body never tells them when to stop.

Good stop conditions sound like:

- stop when the requested change is implemented and you can summarize it from evidence
- stop when you have enough evidence to classify the task as blocked
- stop after targeted verification; do not keep investigating unrelated issues
- if required context is missing, return a blocked outcome instead of guessing

## Reliable Shapes By Agent Type

Build agent:

- owns implementing a scoped change
- for `schema` mode, `result` should usually include `changedFiles`, `workCompleted`, `verification`, `remainingWork`, `notes`
- `outcome` is often `done`, `blocked`, or `needs_followup`

Review agent:

- owns findings, not fixes
- for `schema` mode, `result` should usually include `findings`, `overallRisk`, `recommendedAction`
- `outcome` is often `approved`, `needs_changes`, or `blocked`

Plan agent:

- owns framing the work, not doing it
- for `schema` mode, `result` should usually include `goal`, `steps`, `risks`, `dependencies`
- `outcome` is often `ready`, `blocked`, or `needs_clarification`

## Bad Smells

- one agent tries to plan, build, review, and document everything
- `Expected Output` does not describe the task-specific deliverable
- the agent has no stated behavior for missing evidence
- the agent has no stop condition, so it keeps exploring forever
- the outcome is vague enough that the next agent still has to reread the whole task
