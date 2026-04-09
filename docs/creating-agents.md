# Creating Agents

Agents in `aiman` are specialized Markdown files that define a specific identity, model, and instructions for a task. They are the core building blocks of your workflow.

## What is an Agent?

An agent is an authored specialist. Instead of writing a long prompt every time, you define a reusable specialist that "owns" a specific job, such as reviewing code, explaining an implementation, or running a build.

### Core Philosophy
1.  **One Agent, One Job**: A good agent has a narrow specialty and a clear bar for success.
2.  **Explicit Instructions**: Use direct, prescriptive language. Avoid "be helpful" or vague personas.
3.  **Structured Boundaries**: Use XML tags (like `<task>`, `<instructions>`) to keep instructions separate from variable data.
4.  **Defined Stopping Points**: Explicitly tell the agent when to stop so it doesn't over-research or wander.

## Common Use Cases

| Specialty | Job | Result Mode |
| :--- | :--- | :--- |
| **Reviewer** | Inspects a change for bugs or style issues. | `schema` or `text` |
| **Architect** | Explains an implementation approach for a task. | `text` |
| **Auditor** | Scans a file for security risks or leaks. | `schema` |
| **Maintainer** | Checks documentation or memory for consistency. | `schema` |
| **Builder** | Runs a build/test suite and reports failures. | `schema` |

## How to Create an Agent

### 1. The Scaffold
Use the CLI to create a structured starting point:

```bash
aiman agent create reviewer \
  --description "Reviews project diffs" \
  --provider codex \
  --model gpt-5.4-mini \
  --reasoning-effort medium
```

### 2. Define the Body
Open the created file (e.g., `.aiman/agents/reviewer.md`) and refine the body using these recommended sections:

*   **Role**: Define who the agent is (e.g., "You are the project change reviewer").
*   **Task Input**: Wrap the `{{task}}` placeholder in XML tags.
*   **Instructions**: Provide sequential steps for the task.
*   **Constraints**: List what the agent should *not* do.
*   **Stop Conditions**: Define when the agent is finished.
*   **Expected Output**: Describe the final deliverable (Text or JSON).

### 3. Choose the Result Mode
*   **`text` (Default)**: Use this for human-readable reports, briefs, and explanations.
*   **`schema`**: Use this when you need a stable JSON output for automation or chaining.

## Best Practice: Structural XML
Always wrap your task input and complex instructions in XML tags. This is the most reliable way to prevent the model from confusing its instructions with the data it is processing.

```md
## Task Input
<task>
{{task}}
</task>
```

## Testing Your Agent
Before putting an agent into regular use:
1.  **Check**: Run `aiman agent check <name>` to catch structural errors.
2.  **Smoke Test**: Run a small task with `aiman run <name> --task "..."`.
3.  **Inspect**: Use `aiman runs inspect <run-id> --stream prompt` to see exactly what the model received.

For a deeper dive into reliable authoring, see [Agent Authoring Reference](./agent-authoring.md).
