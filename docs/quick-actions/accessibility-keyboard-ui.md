---
type: quick-action
name: Accessibility + Keyboard UI
description: Audit or improve Specorator UI for keyboard access, focus visibility, labels, target size, and reduced-motion safety.
icon: keyboard
tags:
  - frontend
  - accessibility
  - keyboard
  - ui
---

Use this action to review or improve accessibility for any Specorator UI surface: chat, tool calls, modals, settings, dropdowns, tabs, inline edit, Agent Board, and approval/revision controls.

## 1. Identify the interactive surface

Read the TypeScript renderer/controller and CSS module for the target UI. If no target is given, inspect the current changes with `git diff --stat` and ask one question if the affected surface is still unclear.

## 2. Keyboard and focus checklist

Audit every interactive control for:

- Native `button`, `input`, `select`, or `textarea` where possible.
- Keyboard reachability without mouse-only behavior.
- Visible `:focus-visible` styles that are not hidden by sticky/floating UI.
- Predictable tab order.
- Escape/Enter/Arrow behavior for menus, dialogs, tabs, and pickers where applicable.
- Focus restoration after closing modals, dropdowns, popovers, or approval cards.
- No hover-only actions without a keyboard equivalent.

## 3. Semantics and labels checklist

Check for:

- Icon-only controls with accessible names (`aria-label`, visible label, or equivalent Obsidian API support).
- Correct expanded/selected/pressed states for toggle-like controls.
- Clear disabled states that do not trap focus.
- Status text that remains understandable without color alone.
- Tool-call and agent-status messages that are scannable by text, not just icons.

## 4. Size, motion, and theme checklist

Check for:

- Practical minimum target size of about 24x24 CSS px or enough spacing around small controls.
- No essential drag-only interaction without an alternative.
- `prefers-reduced-motion` handling for non-trivial animation.
- Color contrast that works in both Obsidian light and dark themes.
- Text truncation that preserves full meaning via title, tooltip, or expandable detail when needed.

## 5. Output format

If reviewing, return:

| Severity | File | Control/area | Finding | Fix |
|----------|------|--------------|---------|-----|

If implementing, follow `AGENTS.md` project workflow, make the smallest safe changes, and verify with:

```bash
npm run typecheck
npm run lint
npm run build:css
```

If a manual keyboard check is required, list the exact tab/keyboard path to test in Obsidian.
