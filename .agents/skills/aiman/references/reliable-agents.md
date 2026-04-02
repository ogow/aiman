# Designing Reliable Aiman Agents

Use this file when the task is not just "make an agent file" but "make an agent that another caller can trust."

## Requirement Questions

Ask these before creating or heavily rewriting an agent when the contract is unclear:

- What exact job should the agent own?
- What should it return on success?
- Who will call it most often: a human, a parent agent, or automation?
- What permissions does it actually need?
- Which provider and model should it use?
- What stable repo context should be attached through `contextFiles`?
- Does it require any provider-native skills?
- Does it require specific MCP servers?
- What small smoke test would prove the authored contract works?

If the answer is obvious from local context, proceed. If not, ask a short follow-up instead of guessing.

## Recommended Defaults

- choose `read-only` unless the task must edit files
- keep one agent focused on one specialty
- include `{{task}}` for runnable agents
- keep repo-specific guidance in `contextFiles`
- keep output instructions explicit and near the end of the body
- declare `requiredMcps` only when the workflow truly depends on them

## Good Prompt Shape

Prefer this structure:

1. `Role`
2. `Task Input`
3. `Instructions`
4. `Constraints`
5. `Expected Output`

This is the easiest shape for another caller to understand and debug later through `aiman sesh inspect`.

## Reliability Checks

Before considering the agent done:

- verify the frontmatter is complete
- verify the body still makes sense without hidden repo instructions
- verify `contextFiles` are explicit and stable
- verify permissions are no broader than necessary
- verify `aiman agent show <name>` matches the intended contract
- verify `aiman agent check <name>` has no blocking errors
- if safe, run one small smoke task and inspect the saved run

## Reusable Examples

Start from one of these narrow examples when you want a stable structure fast:

- `docs/examples/project-change-reviewer.md`
- `docs/examples/standalone-daily-doc-checker.md`
- `docs/examples/read-only-security-auditor.md`
