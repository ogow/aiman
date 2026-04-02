# Ink UI Docs Index

Upstream source used for the local copy:

- Docs tree: `https://github.com/vadimdemedes/ink-ui/tree/main/docs`
- Raw doc pattern: `https://raw.githubusercontent.com/vadimdemedes/ink-ui/main/docs/<slug>.md`
- README: `https://raw.githubusercontent.com/vadimdemedes/ink-ui/main/readme.md`

## Quick Use

- List available docs: `node scripts/fetch-doc.mjs --list`
- Fetch one doc: `node scripts/fetch-doc.mjs text-input`
- PascalCase also works: `node scripts/fetch-doc.mjs TextInput`
- Fetch theming guide: `node scripts/fetch-doc.mjs readme`
- Read the full local set under `references/upstream-docs/`

## Component Map

| Component       | Doc slug         | Reach for it when you need...                                     |
| --------------- | ---------------- | ----------------------------------------------------------------- |
| `TextInput`     | `text-input`     | Single-line freeform text input, including autocomplete scenarios |
| `EmailInput`    | `email-input`    | Email entry with provider-domain autocomplete                     |
| `PasswordInput` | `password-input` | Masked secret input such as passwords or API keys                 |
| `ConfirmInput`  | `confirm-input`  | A `Y/n` style confirmation step                                   |
| `Select`        | `select`         | One choice from a scrollable option list                          |
| `MultiSelect`   | `multi-select`   | Multiple choices from a scrollable option list                    |
| `Spinner`       | `spinner`        | Indeterminate loading or waiting UI                               |
| `ProgressBar`   | `progress-bar`   | Determinate progress from `0` to `100`                            |
| `Badge`         | `badge`          | Compact status labeling                                           |
| `StatusMessage` | `status-message` | Richer status with explanatory text                               |
| `Alert`         | `alert`          | High-attention informational, warning, or error messaging         |
| `OrderedList`   | `ordered-list`   | Numbered item rendering                                           |
| `UnorderedList` | `unordered-list` | Bulleted item rendering                                           |

## Practical Notes

- `Select` and `MultiSelect` docs describe uncontrolled usage driven by callbacks.
- `ConfirmInput` exposes `onConfirm` and `onCancel`, plus `defaultChoice` and `submitOnEnter`.
- `ProgressBar` expects a numeric value between `0` and `100`.
- Each component doc links both a `Theme` file and an `Example code` file. Read those next when the Markdown doc is not enough.
- Local files live at `references/upstream-docs/<slug>.md`, except the package README which is `references/upstream-docs/README.md`.

## Theming Workflow

1. Fetch `readme`.
2. Read the theming section for `ThemeProvider`, `defaultTheme`, and `extendTheme`.
3. Fetch the component doc you need.
4. Open that doc's linked `theme.ts` file if a style slot or config key is unclear.
5. For custom components, mirror the README's `useComponentTheme` pattern instead of inventing a new theming shape.
