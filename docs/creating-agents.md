# Creating and Using Agents

Agents in `aiman` are specialized Markdown files that define a specific identity, model, and instructions for a task. This guide covers how to choose the right agent for your task, how to use them, and how to structure them for maximum reliability using XML.

---

## 1. When to Use What: The Decision Matrix

Before creating or running an agent, use this matrix to decide on your approach:

| Scenario                      | Use Case                                                                     | Agent Type     | Result Mode        |
| :---------------------------- | :--------------------------------------------------------------------------- | :------------- | :----------------- |
| **Exploring a new task**      | You need an implementation plan or an explanation of how code works.         | **Architect**  | `text`             |
| **Checking for errors**       | You want a second pair of eyes on your latest PR or commit.                  | **Reviewer**   | `text` or `schema` |
| **Running tests/linting**     | You want to automate your build and get a machine-readable failure report.   | **Builder**    | `schema`           |
| **Auditing security**         | You need to scan a file or diff specifically for sensitive leaks or secrets. | **Auditor**    | `schema`           |
| **Maintaining documentation** | You need to keep `README.md` or `MEMORY.md` in sync with the latest code.    | **Maintainer** | `schema`           |

### Choosing a Result Mode

- **Use `text`** when the final reader is a **human**. You want a clear, formatted report or a short answer.
- **Use `schema`** when the final reader is **another tool** (like an automated build script) or a "parent" agent. This ensures the output is always valid JSON.

### Choosing a Timeout

- **Omit `timeoutMs`** for most agents. That keeps the runtime default 5 minute safeguard.
- **Increase `timeoutMs`** for agents that legitimately need longer-running provider work.
- **Use `timeoutMs: 0`** only when you deliberately want no timeout and are comfortable with a run hanging until stopped.

---

## 2. Practical XML: Why and How to Use It

XML tags are the most reliable way to separate **instructions** from **data**. Because LLMs can sometimes confuse the task they are doing with the data they are processing, XML provides a hard boundary.

### When to use XML:

1. **Always wrap `{{task}}`**: If your task input contains Markdown headers (like `## Fix this`), the model might think those are instructions for the agent. Wrapping them in `<task>` tags prevents this.
2. **When instructions are complex**: If you have multiple sections of rules, use `<instructions>` and `<constraints>` to tell the model exactly what to focus on.
3. **When reading multiple files**: Wrap file contents in `<context>` or `<documents>` tags so the model knows exactly where each file starts and ends.

### Example XML Structure:

While Markdown headings (like `## Task Input`) can be helpful for human readability and editor navigation, they are optional for the model when you use XML tags for structure.

```md
<task_input>
{{task}}
</task_input>

<instructions>
1. Analyze the input provided in the <task_input> tags.
2. Cross-reference it with the context provided in your tools.
3. Stop immediately if the task is finished.
</instructions>
```

---

## 3. How to Use Your Agents

There are two primary ways to run your agents: through the CLI (for automation and quick tasks) or through the interactive TUI (for deep inspection).

### A. Via the CLI (Quick & Automation)

Use the `run` command to launch an agent directly. This is best for one-off tasks or if you are calling an agent from a script.

```bash
# Basic run
aiman run reviewer --task "Review the changes in src/api.ts"

# Detached run (background)
# Use this for long-running tasks like full project audits.
aiman run auditor --task "Scan the entire project for secrets" --detach
```

### B. Via the Workbench (TUI)

Run `aiman` with no arguments to enter the interactive workbench. This is best when you need to:

1. **Browse your agents**: Quickly see what specialists are available.
2. **Inspect active runs**: Follow logs and see artifacts in real-time.
3. **Review history**: Browse previous runs and their outcomes.

**TUI Shortcuts:**

- `a`: Go to the **Agents** workspace.
- `t`: Go to the **Tasks** workspace (to write your prompt).
- `Ctrl+L`: **Launch** the selected agent with your task.
- `r`: Go to the **Runs** workspace to see results.

---

## 4. The Creation Workflow

If you need a new specialist, follow these four steps:

1. **Scaffold**: Use `aiman agent create <name>` to generate the file with the correct frontmatter.
   - If you want help tightening the contract or expected output, explicitly use `$agent-hardening` before or after drafting.
2. **Role & XML**: Define the agent's role clearly and keep the scaffolded `<task>{{task}}</task>` wrapper unless you have a stronger XML shape.
3. **Missing Evidence Behavior**: Say what the agent should do when required evidence or context is missing. A good default is to stop and say it is blocked instead of guessing.
4. **Stopping Points**: Add explicit "Stop Conditions." (e.g., "Stop once you have identified the primary bug.")
5. **Runtime Budget**: Decide whether the default 5 minute timeout is enough. Only add `timeoutMs` when this agent genuinely needs a longer budget or no timeout.
6. **Verification**:
   - Run `aiman agent check <name>` to ensure the Markdown is valid.
   - Run a small "smoke task" using `aiman run <name> --task "Test task"`.
   - Inspect the rendered prompt with `aiman runs inspect <run-id> --stream prompt` to ensure the XML boundaries look correct.

The lightest reliable authoring path is:

1. draft with `aiman agent create`
2. tighten with `$agent-hardening` when the contract is still fuzzy
3. run `aiman agent check`
4. run one tiny smoke task

For the full technical reference, see [Agent Authoring Reference](./agent-authoring.md).
