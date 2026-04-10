# Hardening Checklist

Lock these answers before rewriting the agent body.

## Job

- What exact outcome does the agent own?
- What is out of scope?
- Why should this exist as a named agent instead of a one-off task prompt?

## Caller And Result

- Is the real caller a human, another agent, or automation?
- Should the result be `text` or `schema`?
- If `schema`, what fields must always exist inside `result`?
- If `text`, what must the final answer always cover?

## Evidence And Stop Rules

- What evidence must the agent gather before deciding?
- What should it do when required evidence is missing?
- What should make it stop instead of continuing to explore?
- What would count as `blocked`, `partial`, `done`, or another stable outcome if those values exist?

## Smoke Tasks

- What is the smallest happy-path task?
- What is the smallest blocked-path task?
- Which failure would prove the contract is still too vague?

If any of these answers stay fuzzy, narrow the agent before adding more instructions.
