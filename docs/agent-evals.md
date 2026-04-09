# Agent Evals

Use this guide when a smoke task is no longer enough and you want repeatable confidence in an authored agent.

## Smoke Tasks First

Start with one tiny smoke task:

- one narrow task
- one obvious expected outcome
- one quick inspection loop through `aiman runs show` and `aiman runs inspect`

Do this before you build a fixed eval suite. Smoke tasks are the fastest way to catch broken prompt shape, missing context, or malformed schema output.

## When To Add A Fixed Eval Suite

Add a fixed eval suite when an agent:

- is reused often
- is important enough that regressions matter
- has a stable contract another human or script depends on
- needs consistency checks across several representative tasks

For `aiman`, keep eval logic in a harness script, not in the core runtime.

## Example Harness

Use the standalone example at `examples/eval-harness.ts`.

It runs one agent against a JSON suite using `createAiman()` and checks:

- terminal `status`
- optional `outcome`
- required substrings in `summary` or `finalText`
- required top-level keys in `structuredResult`

Use the sample suite at `examples/eval-suite.sample.json` as the starting shape.

## Practical Workflow

1. Write or refine the agent.
2. Pass `aiman agent check`.
3. Pass one tiny smoke task.
4. Create a small fixed suite, usually 5 to 20 cases.
5. Run the harness after meaningful prompt changes.
6. Expand the suite only when real failures show a gap.

## What To Measure

Pick a small set of criteria that match the agent's job:

- quality of the final answer
- correctness of `outcome`
- output-shape stability
- blocked-path behavior when evidence is missing
- latency only after quality is good enough

Do not try to turn every authored agent into a full benchmark. Start small and keep the suite representative.
