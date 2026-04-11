# Debugging Authored Agents

Use this guide when an authored `aiman` agent is vague, malformed, or failing unexpectedly.

If you want guided help while repairing one agent, explicitly use `$agent-hardening`. The skill is meant to drive the same loop below with the smallest possible fix.

The fastest path is:

1. run a very small smoke task
2. inspect the parsed result
3. inspect the rendered prompt
4. inspect the raw logs only if needed
5. tighten the authored Markdown file and repeat

## Start With A Tiny Task

Use a task that is small enough to debug in one pass:

- one narrow code change
- one small review
- one compact planning request

Avoid large tasks while debugging the authored contract. If the first task is huge, it is hard to tell whether the problem is prompt shape, missing context, or normal task complexity.

For example, when hardening a schema agent such as `site-mapper`, prefer a tiny task like `Map the public surface of https://example.com.` over a broad exploratory request. The smaller task makes malformed JSON, vague stop behavior, and output drift obvious much faster.

## The Main Debug Loop

1. Run `aiman agent check <name>`.
2. Run `aiman run <name> --task "<small concrete task>"`.
3. Read `aiman runs show <run-id>`.
4. Read `aiman runs inspect <run-id> --stream prompt`.
5. Read `aiman runs inspect <run-id> --stream run`.
6. Read `aiman runs inspect <run-id> --stream stdout` and `--stream stderr` if the failure is still unclear.

## What To Inspect

`aiman agent check <name>` is the fast static gate:

- frontmatter issues
- missing `{{task}}`
- missing XML wrapping around `{{task}}`
- missing recommended body sections
- missing missing-evidence guidance
- weak `Expected Output` structure

`aiman runs show <run-id>` is the first runtime read:

- parsed `summary`
- `finalText` for text-mode runs
- `structuredResult` for schema-mode runs
- `outcome`
- final error, if any

`aiman runs inspect <run-id> --stream prompt` shows the exact rendered prompt:

- whether the agent body says what you intended
- whether the task-specific `result` guidance is explicit enough
- whether the stop conditions are actually present

`aiman runs inspect <run-id> --stream run` shows the canonical `run.json`:

- final `status`
- `resultMode`
- optional `finalText`
- optional `structuredResult`
- `outcome`
- `artifacts`
- immutable `launch` snapshot

`aiman runs inspect <run-id> --stream stdout|stderr` shows raw provider behavior:

- extra prose that broke JSON success parsing
- tool or provider errors
- clues about why the run was blocked or malformed

## Common Failure Modes

The agent wanders:

- narrow `Role`
- add stronger `Constraints`
- add `Stop Conditions`

The agent guesses when evidence is missing:

- add explicit missing-evidence behavior
- tell it to return a blocked `outcome` instead of speculating

The agent returns vague structured output:

- define the fields inside `result`
- name the intended `outcome` values
- make `Expected Output` list-shaped and concrete

The run is hard to reuse:

- keep the important facts in `result`
- use `artifacts/` only for larger detail, not as the main contract
- move routing decisions into the surrounding harness instead of the authored agent

The provider appears successful but the run is still an error:

- inspect `stdout.log`
- check whether the final provider message satisfied the required schema-mode JSON envelope
- confirm the agent body did not encourage extra prose around the final JSON

## What Good Looks Like

A healthy authored agent usually has:

- one narrow role
- one small set of stable `outcome` values
- one explicit final deliverable
- one clear blocked path when information is missing
- one short stop rule that prevents endless exploration

If a human or harness can read the key outcome, final answer or structured result, and relevant artifacts from `run.json` without rereading logs, the contract is in good shape.
