# Aiman Debugging

Use this file when a run failed, looks stuck, or needs forensic inspection.

## First Principles

- Prefer reading persisted evidence before rerunning anything.
- Use the session commands, not the TTY dashboard.
- Treat `aiman sesh inspect` plus `--stream ...` as the closest thing to trace inspection.

## Quick Triage

1. Find the run.
   - `aiman sesh list`
   - `aiman sesh list --all`
2. Read compact status.
   - `aiman sesh show <runId>`
3. Read the most relevant evidence.
   - `aiman sesh logs <runId> --stream stderr`
   - `aiman sesh inspect <runId> --stream prompt`
   - `aiman sesh inspect <runId> --stream run`
4. Stop it when the issue is an active stuck run.
   - `aiman agent stop <runId>`

## Common Debug Paths

### Suspect prompt problems

- Read `aiman sesh inspect <runId> --stream prompt`
- Confirm the agent body actually rendered the placeholders you expected
- Check that `{{task}}` was present in the agent body when a task was supplied

### Suspect launch or provider problems

- Read `aiman sesh logs <runId> --stream stderr`
- Read `aiman sesh inspect <runId> --stream run`
- Confirm provider, mode, cwd, launch mode, and error message

### Suspect permission or mode mismatch

- Run `aiman agent show <agent>`
- Confirm the agent's declared `permissions`
- Compare with the `mode` recorded in `run.md`
- Remember: `aiman run --mode ...` must match the agent file, not override it

### Suspect missing skill or MCP preflight failure

- Run `aiman agent show <agent>`
- Check declared `skills` and `requiredMcps`
- Run `aiman skill list` to confirm the expected skill name exists in project or user scope
- If the failure is MCP-related, inspect the run error and the selected provider behavior

### Suspect stale or abnormal live state

- Use `aiman sesh show <runId>` or `aiman sesh inspect <runId>`
- Read the recorded status, pid-derived activity, and warning text
- Remember: current liveness depends on both the supervising `pid` and a fresh heartbeat

### Suspect stop or timeout behavior

- Use `aiman agent stop <runId>` for a non-TTY stop request
- Re-read `aiman sesh show <runId>` after the stop request
- On Windows, remember that `.cmd` / `.bat` provider wrappers should stop as a process tree, not just as a wrapper pid

## Minimal Forensic Sequence

When you need the most signal with the fewest commands:

1. `aiman sesh show <runId>`
2. `aiman sesh inspect <runId> --stream run`
3. `aiman sesh inspect <runId> --stream prompt`
4. `aiman sesh logs <runId> --stream stderr`
5. `aiman sesh logs <runId> --stream stdout`

## When To Rerun

Rerun only after you know what new information you expect to gain.

Good reasons:

- you changed the agent file
- you changed the task
- you fixed a provider, skill, or MCP precondition
- you need to compare foreground vs detached behavior

Weak reasons:

- you have not inspected the prior run yet
- you are hoping the same launch will behave differently without any change
