# TypeScript Style Rules

These rules adapt the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) for this repo.

Use this file when editing `.ts` files in `aiman`. Keep it practical: follow these rules first, then let Prettier handle formatting.

## Scope

- Treat this file as the repo's TypeScript style contract for agents and reviews.
- Prefer this focused ruleset over trying to apply every detail from the full Google guide.
- When the Google guide's example formatting differs from repo formatting, keep the repo's formatter output.

## Repo Rules

### Modules and imports

- Use ES module syntax only. Do not use `namespace`, `module`, `require`, or triple-slash references.
- Use named exports only. Do not add default exports.
- Prefer relative imports for code inside this repo.
- Use `import type` for type-only imports and `export type` for type-only re-exports.
- Prefer named imports for a few clear symbols. Prefer namespace imports only when they make a large API easier to read.

### Module design

- Export the smallest public API that the file actually needs.
- Do not use mutable exports such as `export let`.
- Do not create container classes with only static members for namespacing. Export functions, constants, and classes directly from the file instead.
- Keep files small and focused around one responsibility.

### File structure

- Keep files in this order when the sections exist: imports, then implementation.
- Separate top-level sections with a single blank line.
- Keep helper functions and small local types close to the code that uses them.

### Naming and readability

- Choose names that are clear without extra comments.
- Rename imports only when it avoids collisions or genuinely improves readability.
- Prefer simple control flow over clever fallback branches when the data set is small and local.

## What Agents Should Do

When editing TypeScript in this repo:

1. Follow the rules in this file.
2. Preserve the existing small-module structure unless a simplification clearly improves it.
3. Run the usual repo verification for the touched area when practical.

## Notes

- Prettier remains the source of truth for whitespace, quotes, and line wrapping.
- Some of these rules are social rules for agents and reviews, not hard linter checks yet.
- The repo enforces a narrow subset in [`.oxlintrc.json`](/Users/ogow/Code/aiman/.oxlintrc.json): no default exports, no `namespace`, no `require`-style imports, and no triple-slash references.
