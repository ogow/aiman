# Agent Authoring Reference

This technical reference provides deep-dive guidance for authors refining `aiman` specialists. For a beginner's guide to creating agents, see [Creating Agents](./creating-agents.md).

## Designing Reliable Specialists

The most effective agents are specialized, predictable, and structurally sound.

If you want guided help while creating or repairing an agent, explicitly use the shipped `$agent-hardening` skill. It drives the current `aiman` workflow with `agent check`, one tiny smoke task, and run inspection instead of requiring new CLI commands.

### 1. One Agent, One Specialty

Avoid "generalist" agents. A specialist that owns one clear outcome is easier to test and more reliable under repeated use.

- **Good**: `change-reviewer`, `implementation-architect`, `security-auditor`.
- **Bad**: `coding-assistant`, `general-helper`.

### 2. Choosing a Result Mode

| Mode         | Purpose                         | Provider Payload                                  |
| :----------- | :------------------------------ | :------------------------------------------------ |
| **`text`**   | Default. For human consumption. | Stored as `finalText`.                            |
| **`schema`** | For automation or chaining.     | Must be valid JSON matching the `aiman` contract. |

For `schema` mode, `aiman` automatically appends a contract that requires the model to return a JSON object containing:

- `summary`: A concise status sentence.
- `outcome`: A short status like `"done"`, `"blocked"`, or `"needs_followup"`.
- `result`: The task-specific structured findings.
- `next` (optional): An object suggesting the next agent or task.

### 3. Choosing a Timeout

- Omit `timeoutMs` for the normal case and keep the runtime default.
- Increase `timeoutMs` when the agent's job is legitimately longer-running.
- Use `timeoutMs: 0` only when hanging indefinitely is acceptable until a human or wrapper stops the run.

### 4. Using Structural XML

To increase robustness with Claude and Gemini providers, use XML tags to provide unambiguous boundaries:

- **`<task>`**: Wrap the `{{task}}` placeholder.
- **`<instructions>`**: Group the core task-specific steps.
- **`<context>` / `<documents>`**: Wrap any multi-file or large data inputs.
- **`<expected_output>`**: Clearly define what the model should deliver.

## Common Mistakes

- **Vague Success Criteria**: If you can't describe what a "good" run looks like, the agent will likely hallucinate or under-deliver.
- **No Missing-Evidence Path**: If the body never says what to do when context is missing, the model is more likely to guess.
- **Missing Stop Conditions**: Agents may over-research or "invent" follow-up work if they don't have clear instructions on when to stop.
- **Leaking Repo Rules**: Keep shared repo guidance (like build commands) in `AGENTS.md` instead of repeating them in every agent body.
- **Mixing Data and Instructions**: Without XML tags, a model might interpret part of your task input as a new instruction.

## The Authoring Workflow

1. **Read Repo Context**: Check `AGENTS.md` and `MEMORY.md` to ensure the new agent fits the current project standards.
2. **Lock the Contract**: Decide on the exact job, result mode, model, and timeout before drafting.
   - If the contract is still fuzzy, use `$agent-hardening` to tighten the job, missing-evidence path, stop conditions, and smoke-task choice before expanding the prompt.
3. **Create the Scaffold**: Use `aiman agent create` to ensure all required frontmatter is present.
4. **Static Check**: Run `aiman agent check <name>` often.
5. **Small Smoke Tasks**: Verify behavior with real-world, scoped tasks before full deployment.

For the live CLI command structure, see [CLI Notes](./cli.md).
