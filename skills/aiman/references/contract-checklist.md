# Contract Checklist

Lock these answers before drafting or revising an `aiman` agent.

## Job

- What exact outcome does the agent own?
- What is explicitly out of scope?
- Is this a human-facing specialist, a parent-agent helper, or automation support?
- Why should this exist as a named agent instead of a one-off task prompt?

## Evidence And Decisions

- What evidence must the agent gather before it can decide?
- What should it do when required evidence is missing?
- What are the explicit stop conditions?

## Output And Result Mode

- What should a good run return: findings, a patch, a plan, a report, or a short answer?
- Should the agent be `text` or `schema`?
- If `text`, what must the final answer always cover?
- If `schema`, what fields belong inside `result`?
- If `schema`, what `outcome` values are allowed and when should optional `next` appear?
- What belongs in `artifacts/` instead of inline output?

## Runtime

- Which provider and model fit the work best?
- What `reasoningEffort` matches that provider?
- Should the agent expose informational `capabilities` for operator visibility?

## Repo Fit

- What host-repo files should be read first?
- Which repo rules belong in shared bootstrap context instead of the agent body?
- Is there already another agent that should own this job?

## Validation

- What `aiman agent show` output would confirm the contract?
- What should `aiman agent check` catch if the file is malformed?
- What is the smallest smoke task that proves the agent behaves correctly?
- Which failure would tell you the boundary or expected output is still too vague?

If any answer is missing and cannot be inferred safely, ask a short follow-up question before writing the final file.
