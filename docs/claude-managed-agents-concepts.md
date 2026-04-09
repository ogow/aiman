# Claude Managed Agents Concepts For `aiman`

This note keeps the comparison practical. The goal is not to turn `aiman` into a hosted managed-agent platform. The goal is to borrow the concepts that improve clarity, operator trust, and maintainability without making the CLI heavier.

## Keep

- Keep the current split between authored agent contract and runtime/provider implementation.
- Keep provider rights and environment behavior runtime-owned instead of declaring them in agent frontmatter.
- Keep the CLI small: one way to define agents, one way to run them, one run ledger, and one inspection surface.
- Keep shared repo context configured at repo scope instead of per-agent context lists.

These align well with Claude Managed Agents' separation of agent definition, environment, and session lifecycle, but fit `aiman`'s local-first model better.

## Borrow Next

### 1. Descriptive Capability Contracts

Claude agents make tools and integrations explicit. `aiman` should borrow the visibility, not the hosted control plane.

Good next step:

- add an optional descriptive capability section to authored agents or `agent show`
- keep it informational only
- use it to say things like "expects web access", "expects MCP-backed repo tools", or "writes files in the workspace"

Do not:

- reintroduce per-agent `permissions`, `skills`, `requiredMcps`, or `contextFiles` as runtime-enforced frontmatter

### 2. Version Visibility

Claude treats agents as versioned resources. `aiman` does not need a service-backed version API, but it would benefit from a lighter version story when authored agents get more widely reused.

Good next step:

- expose a stable content digest or authored version marker in `agent show` and the launch snapshot

### 3. Event Clarity

Claude sessions are event-driven. `aiman` already persists enough state for inspection, but active-run feedback is still coarser than it could be.

Good next step:

- improve streaming and inspection around foreground and detached runs without inventing long-lived hosted sessions

## Avoid

- Avoid per-agent environment declarations like managed cloud containers.
- Avoid per-agent tool arrays that duplicate what the provider already knows natively.
- Avoid session-first abstractions that hide the filesystem-backed `run.json` contract.
- Avoid turning the CLI into a large orchestration surface. That belongs in harness scripts, not the core binary.

## Current Conclusion

`aiman` is strongest when it stays small and opinionated:

- authored agents own the task contract
- the runtime owns launch rights and persistence
- providers own native tool discovery and execution details

That means the best Claude-inspired changes are the ones that improve visibility and contracts, not the ones that recreate Anthropic's hosted platform inside the CLI.
