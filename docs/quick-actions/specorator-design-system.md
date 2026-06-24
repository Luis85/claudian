---
type: quick-action
name: Claudian Design System
description: Review or update Claudian UI against its CSS tokens, naming conventions, theme compatibility, and reusable style patterns.
icon: swatch-book
tags:
  - frontend
  - design-system
  - css
  - obsidian
---

Use this action when a Claudian UI change needs design-system consistency, token cleanup, CSS refactoring, or a style audit.

## 1. Inspect the local design system

Read these first:

- `src/style/CLAUDE.md`
- `src/style/index.css`
- `src/style/base/variables.css`
- The CSS module(s) and TypeScript renderers for the target UI.

Summarize the existing pattern before recommending changes.

## 2. Audit for consistency

Check the target files for:

- Hardcoded colors that should use Obsidian or Claudian variables.
- Repeated spacing/radius/shadow values that should become a semantic variable.
- Selectors missing the `.claudian-` prefix.
- CSS modules not imported by `src/style/index.css`.
- One-off component patterns that duplicate existing modules.
- Dark/light theme mismatches.
- `!important` usage that can be avoided.
- Generic class names that may collide with Obsidian or themes.

## 3. Recommend the smallest useful system change

Return findings in this format:

| Severity | File | Issue | Suggested change |
|----------|------|-------|------------------|

Classify severity as `major`, `minor`, or `nit`. Prefer small, durable changes over a broad redesign.

## 4. If implementation is requested

Follow `AGENTS.md` project workflow. Make changes in this order:

1. Add or reuse semantic variables.
2. Update selectors/classes.
3. Register any new CSS module in `src/style/index.css`.
4. Update `src/style/CLAUDE.md` only if a new convention is introduced.
5. Run relevant verification.

Do not introduce a third-party component library, Tailwind, Sass, CSS-in-JS, or external font dependency unless the user explicitly asks and the trade-off is documented.

## 5. Verification

Run:

```bash
npm run build:css
```

If TypeScript rendering code changed, also run:

```bash
npm run typecheck
npm run lint
```
