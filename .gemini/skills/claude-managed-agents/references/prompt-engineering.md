# Prompt Engineering for Agents

Mastering Claude's behavior through advanced prompting techniques, XML structuring, and thinking control.

## Foundational Techniques

### XML Structuring
Use XML tags to wrap instructions, context, and examples. This reduces ambiguity and helps Claude parse complex prompts.
- `<instructions>`: Clear, step-by-step directives.
- `<context>`: Background information or codebase snapshots.
- `<examples>`: Multishot examples to steer tone and format.

### Role Prompting
Assign a specific role in the system prompt. Even a single sentence ("You are a senior DevOps engineer") significantly anchors performance.

## Adaptive Thinking

Claude 4.6+ uses `thinking: { type: "adaptive" }` to decide when and how much to reason.
- **Effort Parameter**: `low | medium | high | max`.
- Higher effort elicits deeper reasoning but increases latency.
- Recommended: `medium` for general tasks, `high` for complex coding or research.

## Agentic System Patterns

### Long-Horizon Reasoning
Claude excels at incremental progress. Encourage it to save state to markdown files (e.g., `progress.md`, `todo.md`) across turns.

### Autonomy vs. Safety
For destructive or hard-to-reverse actions (e.g., `rm -rf`, `git push --force`), instruct Claude to ask for confirmation first.

### Investigative Loop
- `<investigate_before_answering>`: Instruct Claude to read files BEFORE answering questions about them.
- Avoid speculation; prioritize grounded, hallucination-free answers.

## Prompt Guardrails

- **Admit Uncertainty**: Allow Claude to say "I don't know" to reduce hallucinations.
- **Direct Quotes**: For long context, ask Claude to extract word-for-word quotes before analysis.
- **Self-Correction**: Generation -> Review against criteria -> Refine.
- **Hallucination Minimization**: Use structured tags (`<thinking>`, `<answer>`) to separate reasoning from results.
