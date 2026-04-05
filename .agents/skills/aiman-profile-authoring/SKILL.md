---
name: aiman-profile-authoring
description: Use when creating, reviewing, or refining aiman specialist profiles so they follow the current profile contract, choose the right mode, and produce reliable prompts.
---

# Aiman Profile Authoring

Use this skill when the task is to create, review, or tighten an authored `aiman` specialist profile.

## Read First

Open only the smallest relevant files:

- `docs/agent-authoring.md` for the current authoring checklist
- `docs/cli.md` for the live `aiman profile ...` and `aiman run ...` commands
- `docs/agent-runtime.md` when runtime behavior or prompt attachment matters
- `docs/agent-baseline.md` when deciding what belongs in shared repo bootstrap context such as `AGENTS.md`
- `docs/examples/` when a narrow starter shape is more useful than freehand prompt writing

## Current Contract

- The public authored unit is a profile under `.aiman/profiles/<name>.md` or `~/.aiman/profiles/<name>.md`.
- New profiles should use required frontmatter only: `name`, `provider`, `description`, `model`, `mode`, and `reasoningEffort`.
- `mode` must be `safe` or `yolo`.
- `reasoningEffort` is provider-specific: `codex` allows `none|low|medium|high`, while `gemini` currently allows only `none`.
- Profiles that use `permissions`, `contextFiles`, `skills`, or `requiredMcps` are invalid and should be rewritten.
- Runnable profiles should include `{{task}}`.
- A reliable profile body usually uses these sections: `Role`, `Task Input`, `Instructions`, `Constraints`, and `Expected Output`.

## Runtime Context

- `aiman` does not inject a managed runtime-context section into the prompt.
- Shared repo bootstrap context is configured at the harness level through `contextFileNames`, usually pointing at files such as `AGENTS.md`.
- All agents in the same repo share that same configured context file list.
- Use `docs/agent-baseline.md` as a drafting reference for what belongs in shared repo bootstrap context.

## Workflow

1. Lock the contract: owned job, provider, model, mode, output shape, and what shared repo guidance should live in the configured context files.
2. Keep one profile focused on one concrete specialty.
3. Create or revise the file with `aiman profile create`, then tighten the body around the exact outcome.
4. State what the profile should do when evidence is missing instead of letting it guess.
5. Validate with `aiman profile show` and `aiman profile check`.
6. Run one small smoke task with `aiman run <profile> --task ...`.
7. If shared repo guidance is missing, update the repo bootstrap context file such as `AGENTS.md` instead of copying the same rules into every profile.

## Strong Defaults

- Start with `provider: codex`, `model: gpt-5.4-mini`, `mode: safe`, and `reasoningEffort: medium` unless the task clearly needs something else.
- For `gemini`, use `reasoningEffort: none`.
- Switch to `mode: yolo` only for profiles that are expected to edit or write files.
- Prefer plain, direct instructions over clever framing.
- Keep profile frontmatter minimal; repo context belongs in shared context files, not extra profile fields.

## Bad Smells

- Generic "help with anything" prompts.
- Implicit write access or a mode that does not match the job.
- New profiles authored with legacy `permissions:`.
- Repeating large repo instructions in every profile instead of keeping them in shared repo bootstrap context such as `AGENTS.md`.
- Inventing per-profile `contextFiles` or `skills` settings instead of using the repo's shared `contextFileNames` configuration.
