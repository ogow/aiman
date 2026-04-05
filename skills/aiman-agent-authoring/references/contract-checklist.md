# Contract Checklist

Lock these answers before drafting or revising an `aiman` agent.

## Job

- What exact outcome does the agent own?
- What is explicitly out of scope?
- Is this a human-facing specialist, a parent-agent helper, or automation support?

## Output

- What should a good run return: findings, a patch, a plan, a report, or a short answer?
- What structure should the output follow every time?
- What should the agent say when the evidence is incomplete?

## Runtime

- Should the agent be `safe` or `yolo`?
- Which provider and model fit the work best?
- What `reasoningEffort` matches that provider?

## Repo Fit

- What host-repo files should be read first?
- Which repo rules belong in shared bootstrap context instead of the agent body?
- Is there already another agent that should own this job?

## Validation

- What `aiman agent show` output would confirm the contract?
- What should `aiman agent check` catch if the file is malformed?
- What is the smallest smoke task that proves the agent behaves correctly?

If any answer is missing and cannot be inferred safely, ask a short follow-up question before writing the final file.
