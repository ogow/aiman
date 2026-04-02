---
name: ink-ui-docs
description: Use the bundled Ink UI docs to choose `@inkjs/ui` components, confirm props, follow example code, and apply theming correctly in Ink-based CLIs. Trigger when a task mentions Ink UI, `@inkjs/ui`, or components such as `TextInput`, `EmailInput`, `PasswordInput`, `ConfirmInput`, `Select`, `MultiSelect`, `Spinner`, `ProgressBar`, `Badge`, `StatusMessage`, `Alert`, `OrderedList`, or `UnorderedList`.
---

# Ink Ui Docs

Use this skill to work from the local copied `ink-ui` docs instead of guessing component behavior or prop names.

## Quick Start

1. Read `references/docs-index.md` to pick the right component doc.
2. Open the local Markdown under `references/upstream-docs/` or print it with `node scripts/fetch-doc.mjs <component>`.
3. Follow the local example and prop names exactly.
4. If styling is involved, read `references/upstream-docs/README.md` first, then inspect the component doc's `Theme` link.

## Workflow

- For component selection:
   - Use `references/docs-index.md` to match the user's intent to the right primitive.
- For props and examples:
   - Read the matching file in `references/upstream-docs/` and use that local doc as the source of truth.
- For theming:
   - Read `references/upstream-docs/README.md` and follow the `ThemeProvider`, `defaultTheme`, and `extendTheme` pattern.
   - If the component doc links a `theme.ts` file, inspect that next when a style slot or config key is unclear.
- For existing codebases:
   - Match the local code's import style and surrounding Ink patterns before changing structure.

## Practical Rules

- Preserve exported component names exactly as documented.
- Prefer the upstream doc over memory. Some components are uncontrolled and rely on callbacks rather than a controlled `value` prop.
- When a doc example is incomplete for the requested behavior, follow the linked example file or theme file from that doc next.
- Treat the local copies in `references/upstream-docs/` as the default reference set.

## Resources

- `references/docs-index.md`
   - Lean component map, common use cases, and local file names.
- `references/upstream-docs/`
   - Downloaded upstream README plus every Markdown doc from `docs/`.
- `scripts/fetch-doc.mjs`
   - Print a local doc by component name for quick lookup.

Use this as a local lookup skill backed by copied upstream docs.
