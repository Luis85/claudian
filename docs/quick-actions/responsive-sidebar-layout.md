---
type: quick-action
name: Responsive Sidebar Layout
description: Review or improve Claudian UI behavior across narrow, medium, and wide Obsidian sidebar panes.
icon: panel-right
tags:
  - frontend
  - responsive
  - layout
  - obsidian
---

Use this action when a Claudian UI surface may overflow, crowd, collapse poorly, or assume a full browser viewport instead of an Obsidian pane.

## 1. Define pane scenarios

Evaluate the target surface across these mental sizes:

- **Narrow sidebar**: labels collapse, icons remain usable, no horizontal scroll.
- **Medium sidebar**: primary labels and controls fit comfortably.
- **Wide pane**: content uses space without becoming unreadably stretched.

If the UI also appears in modals or settings, include those containers separately.

## 2. Inspect layout implementation

Read the relevant CSS and renderer code. Check for:

- Fixed widths or heights that should use `min()`, `max()`, `clamp()`, flex, grid, or container-aware rules.
- Toolbars that overflow before labels/icons collapse.
- Chips, badges, tabs, and model selectors that wrap or truncate poorly.
- Message/tool-call content that forces horizontal scroll.
- Long file paths, model names, branch names, URLs, or command output.
- Elements positioned relative to viewport instead of the pane/container.

## 3. Prefer container-first design

Use these patterns before viewport-only media queries:

- Flex wrapping for toolbar groups and chips.
- `min-width: 0` on flex children that must shrink.
- `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` only where full text is recoverable.
- CSS custom properties for size thresholds when repeated.
- Container queries where they improve component behavior and are safe for the Obsidian/Electron runtime.

## 4. Produce a review or patch

If reviewing, return:

| Severity | File | Width scenario | Finding | Suggested fix |
|----------|------|----------------|---------|---------------|

If implementing, follow `AGENTS.md` project workflow and keep the patch focused on the target surface.

## 5. Verification

Run:

```bash
npm run build:css
```

If TypeScript changed, also run:

```bash
npm run typecheck
npm run lint
```

Report manual visual checks as a short list of pane widths/states to verify in Obsidian.
