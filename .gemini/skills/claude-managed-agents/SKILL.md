---
name: claude-managed-agents
description: Comprehensive high-fidelity reference skill for Claude Managed Agents. Covers core architecture, agent/environment/session configuration, toolsets, Files API, Vision, MCP/Vaults, and Research Preview features (Outcomes, Memory, Multiagent).
---

# Claude Managed Agents Reference

Use this skill when you need to research, adapt, or implement patterns inspired by Claude's Managed Agents architecture. This skill provides a comprehensive bridge between Claude's hosted-agent paradigm and the `aiman` project's local-first or hybrid goals.

## Reference Modules

Read the specific module for the task at hand to maintain a lean context:

- **[references/core-concepts.md](references/core-concepts.md)**: High-level architecture, how it works, and key benefits.
- **[references/quickstart.md](references/quickstart.md)**: Step-by-step CLI/SDK implementation guide.
- **[references/agent-configuration.md](references/agent-configuration.md)**: Defining agents, versioning, and lifecycle management.
- **[references/environments.md](references/environments.md)**: Cloud containers, package management, and networking modes.
- **[references/sessions-and-events.md](references/sessions-and-events.md)**: Session lifecycle, status machine, and the SSE event protocol.
- **[references/tool-use-and-permissions.md](references/tool-use-and-permissions.md)**: Pre-built toolsets, permission policies, and custom tools.
- **[references/files-and-vision.md](references/files-and-vision.md)**: Files API, mounting resources, and Vision (Images/PDFs) capabilities.
- **[references/mcp-and-vaults.md](references/mcp-and-vaults.md)**: MCP connectors, credential vaults, and GitHub repo mounting.
- **[references/advanced-features.md](references/advanced-features.md)**: Research Preview features: Outcomes, Multiagent sessions, and Memory stores.
- **[references/prompt-engineering.md](references/prompt-engineering.md)**: Advanced prompting (XML tags, Adaptive Thinking, investigative loops).
- **[references/skill-authoring.md](references/skill-authoring.md)**: Best practices for creating skills and enterprise governance.

## How to Apply These Ideas in Aiman

When the goal is to improve `aiman` using these references:

1. **Identify the Gap**: Determine which area of `aiman` (e.g., state persistence, multi-agent coordination) needs refinement.
2. **Consult the Reference**: Read the corresponding module above to understand the industry-standard solution.
3. **Map to Aiman Architecture**: Translate "managed" concepts into "local-first" or "file-system-native" solutions.
4. **Draft a Proposal**: Create a strategy that incorporates the pattern (e.g., "adopting an SSE-style event log for run logs").
5. **Verify Against Archetype**: Ensure the new implementation remains compatible with existing `aiman` contracts like `run.json`.

## Common Use Cases

- Implementing persistent long-term memory for local agents.
- Designing a standardized tool execution and confirmation protocol.
- Enhancing the workbench with real-time streaming status updates.
- Adopting Model Context Protocol (MCP) for extensible tool integration.
