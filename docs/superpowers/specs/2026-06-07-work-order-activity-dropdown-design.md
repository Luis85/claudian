---
title: Work-order activity dropdown in chat header
date: 2026-06-07
status: shipped
scope: chat/header, chat/tabs, tasks/ui, tasks/execution
source_idea: "[[docs/ideas/Work-Order chat tabs should not occupy the tabs row but rather be a drop-down toggle]]"
---

# Work-order activity dropdown in chat header

## Problem

Work-order runs are background hand-offs. They need to stay visible enough that the user can monitor active work and respond when an agent pauses, but they should not compete with user conversations in the chat tab badge row.

The current work-order tab treatment makes each run occupy the same visible tab row as ordinary chat tabs. Even with separate work-order styling, multiple background runs make the row feel crowded and too prominent for a secondary/background surface.

Goal:

1. Keep the visible tab badge row focused on ordinary chat conversations.
2. Move active work-order visibility into the same header area as Quick Actions.
3. Make the collapsed control show whether work is running or needs user attention.
4. Make the dropdown lightweight, actionable, and scoped to active work only.

## Decisions

| # | Decision | Chosen | Rejected |
|---|----------|--------|----------|
| 1 | Dropdown scope | Show only active work orders: `running`, `needs_input`, `needs_approval` | Show all non-terminal work orders; show recent terminal work orders |
| 2 | Row click behavior | Switch to the live work-order chat tab when known; otherwise open the work-order detail modal | Always open detail modal; always open Agent Board |
| 3 | Tab badge row | Hide work-order tabs from the visible tab badge row entirely | Keep aggregate badge in the tab row; show fallback work-order badges |
| 4 | Collapsed indicator | Priority status plus count: neutral for running-only, attention styling for input/approval | Separate mini-counts; icon-only state |
| 5 | Dropdown row content | Title, status, and short action hint | Include provider/model/heartbeat; title/status only |
| 6 | Toggle placement | Beside Quick Actions in the chat header/toolbar row | Composer toolbar; right edge of the tab row |
| 7 | Terminal states | Exclude terminal and review states from the chat dropdown | Include `review`, `needs_fix`, `failed`, `done`, `canceled` |

## UX overview

The chat sidebar treats ordinary chats and work-order run surfaces as related but different navigation concepts.

- The visible tab badge row renders only `kind: 'chat'` tabs.
- Work-order run tabs remain real `TabManager` entries and continue to host execution, streaming, cancellation, follow-up, and history state.
- A new Work Orders dropdown toggle appears beside the Quick Actions entry point in the chat header/toolbar row.
- The toggle is hidden when there are no active work orders.
- The toggle shows a compact count when there are active work orders.
- The toggle uses neutral styling when every active item is `running`.
- The toggle uses attention styling when at least one active item is `needs_input` or `needs_approval`.

Opening the dropdown shows one row per active item. Each row displays:

- work-order title
- current status
- a short action hint (`Open`, `Reply`, or `Review`)

Clicking a row prefers the live run surface: if a sidepanel work-order tab is known, switch to it. If no live tab can be resolved, open `WorkOrderDetailModal` for the work-order note.

## Architecture

Add a narrow work-order activity summary seam owned by the tasks feature and consumed by chat header UI. Chat should not inspect task internals directly.

### Work-order activity summary

Create a tasks-side adapter/service that can answer:

```ts
export type WorkOrderActivityStatus = 'running' | 'needs_input' | 'needs_approval';

export interface WorkOrderActivityItem {
  id: string;
  path: string;
  title: string;
  status: WorkOrderActivityStatus;
  actionHint: 'Open' | 'Reply' | 'Review';
  sidepanelTabId?: string | null;
}

export interface WorkOrderActivitySummary {
  items: WorkOrderActivityItem[];
  runningCount: number;
  attentionCount: number;
}
```

The adapter derives this from existing task state and events instead of introducing a new lifecycle. Inputs include:

- indexed work-order task data for `id`, `path`, `title`, and `status`
- existing task events: `task:run-started`, `task:status-changed`, `task:needs-input`, `task:needs-approval`, `task:run-finished`, and `task:heartbeat`
- existing work-order conversation/tab bindings where available

The active filter is exact: include only `running`, `needs_input`, and `needs_approval`. Exclude `ready`, `inbox`, `review`, `needs_fix`, `needs_handoff`, `failed`, `done`, and `canceled`.

### Chat consumption seam

Expose the summary through a small callback/service dependency passed into the chat/header assembly. The chat UI receives already-normalized rows and callbacks:

```ts
interface WorkOrderActivityDropdownProps {
  summary: WorkOrderActivitySummary;
  onOpenItem(id: string): void | Promise<void>;
  onOpenAgentBoard?: () => void | Promise<void>;
}
```

The tasks feature owns `onOpenItem` resolution:

1. Find the matching active item.
2. If `sidepanelTabId` is known and the tab still exists, switch to that tab.
3. Otherwise open `WorkOrderDetailModal` for `path`.

This keeps chat responsible for rendering and tasks responsible for task navigation semantics.

### Tab bar filtering

`TabManager` already stores `kind: 'chat' | 'work-order'`. Preserve all tabs internally, but pass only chat-kind items to the visible `TabBar` renderer.

The hidden work-order tab remains switchable through `TabManager.switchToTab`. When a hidden work-order tab is active, the tab badge row has no active work-order badge; the Work Orders dropdown toggle is the visible locator for that surface.

## Components

### `WorkOrderActivityDropdown`

Add a focused chat UI component near the existing header/toolbar controls. It should:

- render nothing when `summary.items.length === 0`
- render a button with `aria-expanded`, a work-order icon, and the active count
- add an attention class when `summary.attentionCount > 0`
- render a dropdown menu on click/keyboard activation
- render each item as a keyboard-focusable button
- call `onOpenItem(item.id)` when a row is selected

Suggested classes:

- `.claudian-work-order-activity`
- `.claudian-work-order-activity-toggle`
- `.claudian-work-order-activity-toggle--attention`
- `.claudian-work-order-activity-count`
- `.claudian-work-order-activity-menu`
- `.claudian-work-order-activity-item`
- `.claudian-work-order-activity-status`
- `.claudian-work-order-activity-action`

### Header placement

Place the toggle beside Quick Actions in the chat header/toolbar row. It should not live in the composer toolbar and should not occupy the tab badge row.

If the current header wiring is split between `ClaudianView` and tab-specific UI setup, keep the dropdown at the same level as the Quick Actions button rather than attaching it to individual tab content. Active work orders are plugin/view-level activity, not per-chat-tab composer state.

## Sorting and labels

Sort dropdown rows by urgency first, then stable recency/title:

1. `needs_input`
2. `needs_approval`
3. `running`

Within the same status, preserve the task indexer's natural order or sort by most recent status/heartbeat if that data is already available. Do not add a new persisted ordering field for this feature.

Status labels and hints:

| Status | Label | Hint |
|---|---|---|
| `needs_input` | Needs input | Reply |
| `needs_approval` | Needs approval | Review |
| `running` | Running | Open |

Use i18n keys for labels, hints, aria labels, empty/fallback text, and notices.

## Data flow

```text
Task run starts or changes status
  -> existing task event emitted / indexed state updated
  -> tasks-side activity adapter recomputes active summary
  -> chat header dropdown receives updated summary
  -> toggle hides, neutralizes, or enters attention state
  -> user selects an active item
  -> tasks-side navigation handler switches to sidepanel tab or opens detail modal
```

The dropdown should refresh in place when state changes while the menu is open.

## Edge cases

### Plugin reload

On reload, active task state is reconstructed from indexed non-terminal task notes and existing sidecar/orphan recovery behavior. If a live sidepanel tab cannot be resolved after reload, item clicks fall back to the detail modal.

### Missing or closed work-order tab

If a row points at a missing tab, do not fail silently. Open the detail modal for the work-order note. If desired, a future enhancement can offer a secondary action to reopen the live conversation, but that is out of scope here.

### Terminal transitions

When a work order moves to `review`, `needs_handoff`, `failed`, `done`, or `canceled`, remove it from the chat dropdown. Agent Board remains the canonical surface for terminal and review work.

### Manual work-order tab close

Current close/cancel behavior remains unchanged. The dropdown should update once the task status changes or the activity adapter detects the tab binding is gone.

### Active hidden work-order tab

Switching into a hidden work-order tab is allowed. The visible tab badge row will show only ordinary chat tabs; the dropdown toggle remains the visible work-order navigation affordance.

### Accessibility

The toggle is a real button with `aria-haspopup="menu"` and `aria-expanded`. The attention state must be conveyed by label text and aria text, not color alone. Menu rows are keyboard-focusable buttons. Escape closes the menu and restores focus to the toggle.

## Testing

### Unit tests

| Spec | Asserts |
|---|---|
| Activity summary filtering | Includes only `running`, `needs_input`, `needs_approval`; excludes ready/review/terminal states |
| Activity summary counts | Computes `runningCount` and `attentionCount`; attention is input/approval only |
| Activity row sorting | Needs-input and needs-approval rows sort ahead of plain running rows |
| Activity row click | Prefers live tab switch when a valid sidepanel tab exists |
| Activity row fallback | Opens `WorkOrderDetailModal` when the tab id is missing/stale |
| Dropdown render | Hidden with zero active items; neutral with running-only; attention class with input/approval |
| TabBar filtering | Work-order tabs remain in `TabManager` but are not passed/rendered as visible tab badges |

### Integration / DOM tests

| Scenario | Expected result |
|---|---|
| Start a work order | A work-order tab is created internally, hidden from tab badges, and the dropdown toggle appears |
| Needs-input transition | Toggle updates to attention state and row hint reads `Reply` |
| Needs-approval transition | Toggle updates to attention state and row hint reads `Review` |
| Row click with live tab | Switches to the work-order tab even though it is hidden from the badge row |
| Terminal transition | Item disappears and the toggle hides if no other active work orders remain |

## Non-goals

- Building a mini Agent Board in the dropdown.
- Showing `ready`, `review`, `needs_fix`, `needs_handoff`, `failed`, `done`, or `canceled` items in the chat dropdown.
- Changing the work-order run lifecycle or state machine.
- Changing queue concurrency or tab-budget settings.
- Auto-closing work-order tabs.
- Adding drag/reorder behavior.
- Showing provider, model, heartbeat age, cost, or ledger details in dropdown rows.

## Open questions

None.
