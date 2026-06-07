---
type: issue
id: issue-20260607-modal-header-title-meta
title: Work-order modal — header with editable inline title + meta row
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - modal
  - header
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Fill the modal header (padding `18px 26px ~16px`, bottom border `1px solid --border-color`). The header IS the editable title — the old separate Title `Setting` row was dropped in the frame slice.

Meta row (above title, `margin-bottom 9px`, gap 12):
- **ID chip** — monospace, `--font-ui-smaller`, `--text-muted`, bg `--background-modifier-hover`, border `--border-color`, padding `2px 8px`, `--radius-m` (e.g. `WO-204`).
- For `running`: live indicator = pulsing dot in status color + caption "Started Nm ago" (`--text-muted`, `--font-ui-smaller`). Pulse gated by `@media (prefers-reduced-motion: no-preference)`.
- For `done`: finished-at caption.

Title — `font-size 21px`, `--font-bold`, `line-height --line-height-tight`, letter-spacing `-.01em`, `text-wrap: pretty`, right padding 40px so it clears the close button. (Density variants `compact 19` / `comfy 23` from the brief are prototype-only; do not ship.) Editable when status ∈ `{inbox, ready, needs_fix}`: render as either an inline-growing `<input>` or `contenteditable="plaintext-only"` (the `plaintext-only` clamp is required if contenteditable is chosen — bare contenteditable allows rich-paste injection of marked-up DOM into a plain-text field). Hover bg `--background-modifier-hover`; focus bg `--input-bg` + `0 0 0 2px --color-accent-3`. Esc cancels (revert + blur); Enter commits (blur). On blur, if non-empty and changed, save via `onSaveFields(task, { title })`. Show a tiny "✎ Click title to rename" hint (`--text-faint`, `--font-smaller`) under it.

Accent gradient color reads from the status → color contract in [[2026-06-07-agent-board-redesign-plan]].

Close button — top-right, 30×30, `x` icon (`setIcon`), `--text-muted` → hover bg `--background-modifier-hover` + `--text-normal`.

2px accent line on the bottom edge: left-anchored gradient `linear-gradient(90deg, <statusColor> 0, <statusColor> 64px, transparent 240px)`. Falls back to `--border-color` when the status-color treatment is off.

#### Acceptance criteria

- [ ] Meta row renders ID chip + status-aware caption above title.
- [ ] Title is keyboard-focusable and editable inline in editable states; saves on blur when changed and non-empty.
- [ ] Title in non-editable states (`running`, `review`, `done`, `needs_handoff`, `failed`, `canceled`) renders as plain text — no contenteditable affordance.
- [ ] "✎ Click title to rename" hint shown only in editable states.
- [ ] 2px accent gradient renders along the bottom of the header.
- [ ] Pulse animation on the live indicator suppressed when user prefers reduced motion.
- [ ] Close button is keyboard-focusable with accessible name.
- [ ] If `contenteditable` is used, the element carries `contenteditable="plaintext-only"`; Esc cancels and Enter commits.
- [ ] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-modal-frame-sticky-shell]]
