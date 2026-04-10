# Agent Selection

Use this reference when deciding whether a project should add a new `aiman` agent or just handle the work as a one-off task.

## A Good Agent Candidate

Create a dedicated agent when most of these are true:

- The work is repeatable.
- The boundaries are narrow and stable.
- The expected output shape is consistent.
- The project benefits from a named specialist with a predictable bar.
- A caller will likely run the same kind of task again.
- You can describe when the agent should stop.
- You can describe what it should do when evidence is missing.

Examples:

- a change reviewer that reports findings in a fixed format
- a read-only security auditor for a scoped area
- a migration planner that produces a concrete rollout plan
- a documentation drift checker with a short operator-facing report

## A Bad Agent Candidate

Do not create a new agent just because a task is important.

Bad candidates usually look like:

- "general software engineer"
- "help with anything in this repo"
- a one-time task with no stable reuse pattern
- a specialty whose output changes wildly from one run to the next
- a role that only exists because the current task prompt is poorly written
- work that cannot name a clear stop condition
- work that depends on too much hidden repo knowledge to encode cleanly

## Boundary Test

Ask these questions:

- Can I describe the agent's job in one sentence?
- Can I list obvious non-goals?
- Would a future caller know when to choose this agent over another one?
- Could I write one smoke task that demonstrates success?
- Can I describe what the agent should do if key evidence is missing?
- Can I describe what a good final answer must contain every time?

If those answers are weak, tighten the scope before creating the file.

## Split Or Merge

Split an agent into two when:

- the work mixes unrelated specialties
- the outputs need different formats
- the decision standards are materially different
- one half needs `text` while the other truly needs `schema`
- one half would need different stop conditions or missing-evidence behavior

Keep one agent when:

- the job is one coherent specialty
- the same evidence and output style apply across runs
- the provider choice stays consistent
- the same stop conditions and acceptance bar apply across runs
