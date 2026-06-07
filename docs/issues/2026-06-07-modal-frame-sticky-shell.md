---
type: issue
id: issue-20260607-modal-frame-sticky-shell
title: Work-order modal — sticky header / two-pane body / sticky footer shell
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - modal
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Migrate `WorkOrderDetailModal` to the new frame so primary actions are always reachable. The modal becomes a flex column: sticky header (fixed top), body (`flex:1; overflow-y:auto; overflow-x:hidden`), sticky footer (fixed bottom). The body uses a two-pane grid (`grid-template-columns: 1fr 282px`) for main + properties sidebar; under `max-width: 720px` it collapses to a single column with the sidebar dropping below and the divider becoming a top border.

Keep the existing modal width (`min(960px, 92vw)`) and add `max-height: min(86vh, 760px)`. Drop the duplicate Title `Setting` row — the header will own the title in a follow-up slice. Existing meta, field, and action surfaces continue rendering inside the new body/footer until later slices replace them. This slice is pure layout migration: no content or behavior changes.

#### Acceptance criteria

- [ ] Modal opens with sticky header + sticky footer; only the body scrolls.
- [ ] Two-pane grid renders at default width; collapses to single column under 720px with sidebar below main.
- [ ] Duplicate Title `Setting` removed from `renderEditors`.
- [ ] Existing fields and action buttons remain functional inside the new shell.
- [ ] `.claudian-work-order-modal*` CSS rewritten under the new frame contract; no hardcoded hex; all values via Obsidian CSS variables.
- [ ] Unit/integration tests covering modal open/close still pass.
- [ ] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

None — can start immediately.
