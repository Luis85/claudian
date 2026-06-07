---
type: issue
id: issue-20260607-agent-board-redesign-a11y-audit
title: Agent Board redesign — accessibility + reduced-motion audit
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - accessibility
  - reduced-motion
  - cross-cutting
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Cross-cutting verification pass across slices 1–12. The per-slice work is required to ship its own a11y + reduced-motion plumbing; this slice is the closing audit that confirms nothing slipped through and that the surface is keyboard-traversable end to end.

Verification checklist:

- **Reduced motion**: every pulse / live animation is gated behind `@media (prefers-reduced-motion: no-preference)`. Specifically: modal header live indicator pulse; card title-row status dot pulse on live statuses; card live-strip freshness dot pulse; any Auto-run switch transition that animates.
- **Auto-run switch**: `role="switch"`, `aria-checked` reflects state, tooltip present, keyboard-operable.
- **Editable modal title**: keyboard-focusable, Esc cancels, Enter blurs to commit, hint visible only in editable states.
- **Properties sidebar value chips**: keyboard-operable via the transparent native `<select>` overlay; chevron icon is decorative (aria-hidden); label text carries the accessible name.
- **Card status dot + freshness dot**: aria-label per tier (Fresh / Stale / Very stale) preserved; non-color cue (glyph) preserved so color-blind users get the freshness signal.
- **Collapsed lanes**: `tabindex="0"`, Enter / Space toggle, `aria-expanded` reflects state.
- **Action cluster + ⋯ menu**: trigger has an accessible name; menu has `role="menu"`, items have `role="menuitem"`; Esc closes; outside-click closes; focus returns to the trigger when the menu closes.
- **Tabular-nums**: applied to Created / Updated / Attempts and to all time-based captions.
- **Tooltips**: status pill, assignee avatar, ID chip carry tooltips with full names / ids.
- **Keyboard walkthrough**: opening a card from the board, editing the title, tabbing through properties, reaching the footer actions, and closing the modal must all be possible without a mouse.

Failures discovered during the audit are fixed within the audit PR (not split out — the audit owns closure of these gaps).

#### Acceptance criteria

- [ ] Every checklist item above verified; failures fixed in the audit PR.
- [ ] Reduced-motion preference suppresses every pulse / live animation while leaving non-motion visuals intact.
- [ ] Keyboard-only walkthrough (open card → edit title → tab through properties → reach footer → close modal) passes.
- [ ] `npm run lint && npm run test && npm run build` green.

#### Blocked by

[[2026-06-07-modal-frame-sticky-shell]], [[2026-06-07-modal-header-title-meta]], [[2026-06-07-modal-properties-sidebar]], [[2026-06-07-modal-objective-acceptance]], [[2026-06-07-modal-activity-block]], [[2026-06-07-modal-footer-actions]], [[2026-06-07-board-toolbar-auto-run]], [[2026-06-07-board-lanes-refresh]], [[2026-06-07-board-card-body]], [[2026-06-07-board-card-actions-menu]], [[2026-06-07-board-card-live-strip]], [[2026-06-07-agents-persona-seam]]
