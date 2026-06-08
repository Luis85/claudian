---
type: improvement
id: issue-20260607-work-order-tabs-budget-and-activity
status: partially-shipped
priority: 1 - high
triage: planned-dropdown
updated: 2026-06-07
related:
  - "[[2026-06-07-work-order-activity-dropdown-design]]"
  - "[[2026-06-07-work-order-activity-dropdown]]"
relations:
  - Cross Cutting
tags:
  - agent-board
  - chat
  - work-orders
---

# Work-order execution should not consume visible chat capacity

> **Triage update (2026-06-07): partially shipped.** The capacity/budget half is already implemented:
> `TabKind = 'chat' | 'work-order'`, `TabManager.getMaxTabsFor('work-order')` derives a separate work-order
> budget from `agentBoardQueueCap`, `createTaskRunTab()` creates `kind: 'work-order'` tabs with `activate: false`,
> and Agent Board labels the budget as `Work-order tabs N/M · K free`. Do **not** rebuild the separate budget.
>
> The remaining gap is visual prominence/navigation: work-order run tabs are still rendered as badges in the
> chat tab row. Recent docs `[[2026-06-07-work-order-activity-dropdown-design]]` and
> `[[2026-06-07-work-order-activity-dropdown]]` supersede the old "visible distinct in the sidepanel" wording:
> hide work-order badges from the visible tab row and expose active work orders through a compact header dropdown
> beside Quick Actions.

## Original request

In order to not block the user's productivity, work-orders and chat tabs shall not share the same available tab limits. The Agent Board should have its own available tabs and its own limits.

The goal is to have a dedicated chat tab limit and a work-order tab limit.
Work-order tabs should be visibly distinct in the chat sidepanel.

## Current split

- [x] **Separate chat/work-order capacity** — shipped in `TabManager` via independent per-kind counts and caps.
- [x] **Background/non-activated run tab creation** — shipped via `createTaskRunTab(..., { kind: 'work-order', activate: false })`.
- [ ] **Remove work-order badges from the visible chat tab row** — planned by [[2026-06-07-work-order-activity-dropdown]].
- [ ] **Active-work dropdown beside Quick Actions** — planned by [[2026-06-07-work-order-activity-dropdown]].

## Acceptance to close

- Visible tab badge row renders ordinary chat tabs only.
- Active work orders (`running`, `needs_input`, `needs_approval`) are discoverable from the chat header dropdown.
- Dropdown rows open the live work-order tab when available and fall back to the work-order detail modal.
- The separate work-order capacity/queue cap remains unchanged.
