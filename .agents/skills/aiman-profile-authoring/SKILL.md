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
- `docs/agent-baseline.md` when deciding what belongs in `AGENTS.md#Aiman Runtime Context`
- `docs/examples/` when a narrow starter shape is more useful than freehand prompt writing

## Current Contract

- The public authored unit is a profile under `.aiman/profiles/<name>.md` or `~/.aiman/profiles/<name>.md`.
- New profiles should use required frontmatter only: `name`, `provider`, `description`, `model`, `mode`, and `reasoningEffort`.
- `mode` must be `safe` or `yolo`.
- `reasoningEffort` is provider-specific: `codex` allows `none|low|medium|high`, while `gemini` currently allows only `none`.
- The only profile-level optional field you should add in new authoring work is `skills:`.
- Profiles that use `permissions`, `contextFiles`, or `requiredMcps` are invalid and should be rewritten.
- Runnable profiles should include `{{task}}`.
- A reliable profile body usually uses these sections: `Role`, `Task Input`, `Instructions`, `Constraints`, and `Expected Output`.

## Runtime Context

- `aiman` auto-attaches only `AGENTS.md#Aiman Runtime Context` when that section exists.
- Do not rely on broad `AGENTS.md` inheritance or old profile-level `contextFiles` behavior.
- Keep the runtime-context section short, stable, and repo-wide.
- Use `docs/agent-baseline.md` as a drafting reference for what belongs in that runtime-context section.

## Workflow

1. Lock the contract: owned job, provider, model, mode, output shape, and whether any local skills are truly needed.
2. Keep one profile focused on one concrete specialty.
3. Create or revise the file with `aiman profile create`, then tighten the body around the exact outcome.
4. State what the profile should do when evidence is missing instead of letting it guess.
5. Validate with `aiman profile show` and `aiman profile check`.
6. Run one small smoke task with `aiman run <profile> --task ...`.
7. If shared repo guidance is missing, update `AGENTS.md#Aiman Runtime Context` instead of copying the same rules into every profile.

## Strong Defaults

- Start with `provider: codex`, `model: gpt-5.4-mini`, `mode: safe`, and `reasoningEffort: medium` unless the task clearly needs something else.
- For `gemini`, use `reasoningEffort: none`.
- Switch to `mode: yolo` only for profiles that are expected to edit or write files.
- Prefer plain, direct instructions over clever framing.
- Keep `skills:` short and limited to real local skill dependencies.

## Bad Smells

- Generic "help with anything" prompts.
- Implicit write access or a mode that does not match the job.
- New profiles authored with legacy `permissions:`.
- Repeating large repo instructions in every profile instead of keeping them in `AGENTS.md#Aiman Runtime Context`.
- Declared `skills:` names that do not exist under `.aiman/skills` or `~/.aiman/skills`.
