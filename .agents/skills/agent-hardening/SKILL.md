---
name: agent-hardening
description: Use when creating or repairing an authored `aiman` agent and you need help locking the contract, tightening prompt structure, running `aiman agent check`, choosing small smoke tasks, and diagnosing failed runs.
---

# Agent Hardening

Use this skill when the goal is to make one authored `aiman` agent more reliable without inventing new runtime features.

The job is to drive a disciplined workflow around the primitives `aiman` already has:

- `aiman agent create`
- `aiman agent show`
- `aiman agent check`
- `aiman run`
- `aiman runs show`
- `aiman runs inspect`

Do not default to proposing new CLI commands, harnesses, or runtime behavior. First try to fix the agent contract, the authored prompt, and the smoke-task workflow.

## When To Use This Skill

Use it when:

- a new authored agent needs a stronger contract before first use
- an existing agent wanders, guesses, or overproduces
- a schema agent fails because the final output is malformed
- an agent needs tighter missing-evidence or stop behavior
- you need a few small smoke tasks that quickly prove whether the agent is usable

Do not use it for general repo design, provider-runtime bugs, or broad eval-platform design unless the failure clearly cannot be fixed in the agent body or normal smoke-loop workflow.

## Required Workflow

1. Read the smallest relevant host context first:
   - top-level repo instructions such as `AGENTS.md`
   - active memory or task notes when present
   - the target agent file
   - nearby docs or existing agents only when they materially clarify the contract
2. Lock the contract before rewriting prompt prose. Use [references/hardening-checklist.md](references/hardening-checklist.md).
3. Decide whether the issue is primarily:
   - agent boundary and contract
   - prompt structure and output shape
   - smoke-task choice
   - provider/runtime behavior that the agent cannot reasonably control
4. Prefer the smallest fix:
   - tighten role, constraints, stop conditions, and expected output
   - add explicit missing-evidence behavior
   - reduce scope instead of adding more instructions
   - only escalate to runtime or harness changes when the failure is clearly outside the authored agent
5. Validate with existing `aiman` commands:
   - `aiman agent check <name>`
   - one tiny `aiman run <name> --task "..."`
   - `aiman runs show <run-id>`
   - `aiman runs inspect <run-id> --stream prompt`
   - `aiman runs inspect <run-id> --stream run`
   - read `stdout` or `stderr` only when the parsed result is still unclear
6. If the agent still fails, use [references/debug-loop.md](references/debug-loop.md) and make one more focused revision.

## Hardening Rules

- One agent should own one repeatable job.
- Use `schema` only when another tool or agent truly needs machine-readable output.
- The agent body must say what to do when required evidence is missing.
- The agent body must say when to stop.
- Keep success criteria concrete enough that a small smoke task can prove the contract.
- Do not test reliability with a huge task first.
- Do not overfit to one exact wording in the final answer; optimize for stable behavior and output shape.
- Do not paste large copies of repo rules into every agent. Put shared rules in repo context instead.

## Expected Output

When you use this skill, the result should include:

- a short diagnosis of the current reliability problem
- the concrete contract or prompt changes that fix it
- 2 to 3 tiny smoke tasks tailored to the agent
- the exact `aiman` validation commands to run next

If you revise an agent directly, keep the change minimal and explain which failure mode it addresses.
