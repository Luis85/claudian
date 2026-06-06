---
title: Separate tab budget for work-order runs
date: 2026-06-06
status: draft
scope: chat/tabs, tasks/execution, settings
---

# Separate tab budget for work-order runs

## Problem

Today a single `settings.maxTabs` cap governs both user-opened chat tabs and Agent Board work-order task-run tabs. They share the same `TabManager` instance and compete for the same free-slot pool. The `QueueRunner` reads `getFreeExecutionSlots()`, which currently subtracts every open tab regardless of origin, so an active work-order run consumes one of the user's chat slots and a chat-busy user can starve the queue (and vice versa).

Source issue: [docs/issues/Work-Order execution shall not consume available chat tabs.md](../../issues/Work-Order%20execution%20shall%20not%20consume%20available%20chat%20tabs.md).

Goal:

1. Chat tabs and work-order tabs draw from independent budgets.
2. Work-order tabs are visually distinguishable in the sidepanel tab bar.

## Decisions

| # | Decision | Chosen | Rejected |
|---|----------|--------|----------|
| 1 | Cap relationship | Two independent caps (`maxChatTabs`, `maxWorkOrderTabs`) | Single cap + chat reservation; single cap + soft priority auto-close |
| 2 | Tab kind classification | Explicit `kind: 'chat' \| 'work-order'` field on `TabData`, persisted | Derive from `pinnedModel`; lookup via conversation linkage |
| 3 | Visual treatment | Leading icon + left-border accent on WO tabs | Section split into groups; text/state badge; combined icon + status dot |
| 4 | Settings migration | Rename `maxTabs` → `maxChatTabs`; add `maxWorkOrderTabs` | Keep `maxTabs` as chat-only; require user re-config |
| 5 | Defaults + bounds | `maxChatTabs` keeps current default + `MIN_TABS..MAX_TABS`; `maxWorkOrderTabs` default 3, same bounds | Asymmetric bounds with MIN 0 kill-switch; WO default 0 (opt-in) |
| 6 | Manual interactions | `kind` immutable at creation; manual close cancels run (as today); no promote/demote | Right-click promote/demote; auto-reclassify on terminal state |
| 7 | Reservation scope | One `ChatTabReservations` instance, now WO-only by contract | Split into two ledgers; keep global with per-kind filtering |

## Architecture overview

Three thin seams change, no new modules.

- **Data model**: `TabData` and `PersistedTabState` gain `kind: TabKind`. Set once by the tab creator (`createTab` → `'chat'` by default; `createTaskRunTab` → `'work-order'`). Survives reload.
- **Cap enforcement**: `TabManager.getMaxTabs()` becomes `getMaxTabsFor(kind)`. Cap checks in `createTab`, `canCreateTab`, and `forkToNewTab` route per-kind.
- **Queue gate**: `ClaudianView.freeExecutionSlots()` reads `maxWorkOrderTabs - openWorkOrderTabs - outstandingReservations`. Chat tabs no longer subtracted. `QueueRunner` and `ChatTabReservations` keep their existing public shapes; only the inputs to the free-slot calc narrow to WO.

Tab bar reads `kind` to apply an icon and CSS accent. Settings UI adds a second numeric row. A one-time migration copies the old `maxTabs` value to `maxChatTabs` and seeds `maxWorkOrderTabs` to the default.

## Data model

### `TabKind` and `TabData` (`src/features/chat/tabs/types.ts`)

```ts
export type TabKind = 'chat' | 'work-order';

export interface TabData {
  // ...existing fields...
  /** Immutable after creation. Determines which cap this tab counts against
   *  and how it renders in the tab bar. */
  kind: TabKind;
}

export interface PersistedTabState {
  // ...existing fields...
  kind: TabKind;
}
```

### Persisted-state back-compat

On restore, a missing `kind` defaults to `'chat'`. Existing task-run tabs from a pre-upgrade session are not tagged as `'work-order'` and will appear as chat tabs after reload. This is acceptable because those tabs reference runs whose terminal state has already been recorded; treating them as chat tabs only reduces their visual distinction, not their behavior.

### Settings (`src/core/types/settings.ts`)

```ts
export interface ClaudianSettings {
  // ...
  maxChatTabs: number;
  maxWorkOrderTabs: number;
  tabBarPosition: TabBarPosition;
  // ...
}
```

`maxTabs` removed.

### Constants (`src/features/chat/tabs/types.ts`)

Current values: `DEFAULT_MAX_TABS = 3`, `MIN_TABS = 3`, `MAX_TABS = 10`.

```ts
export const DEFAULT_MAX_CHAT_TABS = 3;       // was DEFAULT_MAX_TABS
export const DEFAULT_MAX_WORK_ORDER_TABS = 3;
// MIN_TABS, MAX_TABS unchanged and shared by both caps
```

Rename `DEFAULT_MAX_TABS` → `DEFAULT_MAX_CHAT_TABS`. Update internal references.

### Settings migration

Run during `ClaudianSettingsStorage` load, before validation/merge:

```ts
function migrateMaxTabs(raw: Record<string, unknown>): void {
  if ('maxTabs' in raw && !('maxChatTabs' in raw)) {
    raw.maxChatTabs = raw.maxTabs;
  }
  delete raw.maxTabs;
  if (!('maxWorkOrderTabs' in raw)) {
    raw.maxWorkOrderTabs = DEFAULT_MAX_WORK_ORDER_TABS;
  }
}
```

Idempotent: once `maxTabs` is gone, subsequent loads are no-ops. Clamping to `MIN_TABS..MAX_TABS` happens at read time (`getMaxTabsFor`), so migration does not need to validate.

## TabManager cap enforcement

### Per-kind cap read

```ts
private getMaxTabsFor(kind: TabKind): number {
  const raw = kind === 'work-order'
    ? this.plugin.settings.maxWorkOrderTabs
    : this.plugin.settings.maxChatTabs;
  const fallback = kind === 'work-order'
    ? DEFAULT_MAX_WORK_ORDER_TABS
    : DEFAULT_MAX_CHAT_TABS;
  return Math.max(MIN_TABS, Math.min(MAX_TABS, raw ?? fallback));
}

private countTabsByKind(kind: TabKind): number {
  let n = 0;
  for (const t of this.tabs.values()) if (t.kind === kind) n++;
  return n;
}
```

### Public API

- `canCreateTab(kind: TabKind = 'chat'): boolean` — `countTabsByKind(kind) < getMaxTabsFor(kind)`.
- `createTab(conversationId?, tabId?, options?: CreateTabOptions)` — `CreateTabOptions.kind?: TabKind` (default `'chat'`). Cap check uses the new per-kind path. New `TabData` carries `kind`.
- `createTaskRunTab(options)` — passes `kind: 'work-order'` through `createTab`. No signature change.
- `forkToNewTab(context)` — forks always produce chat tabs (a fork is a user action against a conversation). Uses the chat cap regardless of source tab's kind.

### `bypassTabLimit`

Still honored in `createTab`. It overrides both caps. Used today by the post-plan commit injection path; behavior preserved.

### Notices

`chat.fork.maxTabsReached` becomes two keys:

- `chat.tabs.maxChatReached` — used by `createTab`/`forkToNewTab` chat failures.
- `chat.tabs.maxWorkOrderReached` — used when a work-order start fails on the WO cap.

The queue surfaces the WO failure as a skip-ledger reason (existing `tab limit reached` path) and the message string is updated to make the cap explicit.

### Tabs-changed event

```ts
this.plugin.events.emit('chat:tabs-changed', {
  openCount: this.tabs.size,
  chatCount: this.countTabsByKind('chat'),
  workOrderCount: this.countTabsByKind('work-order'),
});
```

Backwards-compatible: existing consumers reading `openCount` are unaffected. Queue runner re-tick triggers stay the same.

## Queue / reservations

### Free-slot calculation

```ts
freeExecutionSlots(): number {
  const cap = this.tabManager.getMaxTabsFor('work-order');
  const open = this.tabManager.countTabsByKind('work-order');
  const reserved = this.plugin.chatTabReservations.outstanding();
  return Math.max(0, cap - open - reserved);
}
```

Chat tabs are no longer subtracted. Queue runs are gated solely on the WO budget.

### `ChatTabReservations`

API unchanged. `outstanding()` accessor added if not already present (needed by the free-slot calc). The class header comment is updated to state that the ledger is WO-only — chat tabs open synchronously from the user and never need a reservation.

### `QueueRunner`

No logic change. Still calls `getFreeExecutionSlots()` opaquely. The narrower value is enough.

### `startTaskRunInFreshTab`

Calls `tabManager.createTaskRunTab` (which now requests `kind: 'work-order'`). On a null return (cap reached) the existing reservation release path still fires. The failure string updates to: `"Could not open a work-order tab (work-order tab limit reached)."`.

### Multi-pane

The reservation ledger remains plugin-level. Cross-pane race protection is preserved because `freeExecutionSlots()` and `ChatTabReservations.reserve()` are unchanged at the ledger boundary.

## Tab bar visuals

### Render order

Chat tabs render first, work-order tabs render last. Within each group, the existing insertion order is preserved (no drag-reorder exists today).

Implemented as a sorted view at the render seam, not as a re-sort of the underlying `Map`:

```ts
// TabManager
getOrderedTabs(): TabData[] {
  const chat: TabData[] = [];
  const wo: TabData[] = [];
  for (const t of this.tabs.values()) {
    (t.kind === 'work-order' ? wo : chat).push(t);
  }
  return [...chat, ...wo];
}
```

- `TabBar` renderer iterates `getOrderedTabs()` instead of `getAllTabs()` / `tabs.values()`.
- Newly created chat tabs slot in after the last existing chat tab (visually pushing all WO tabs right by one).
- Newly created work-order tabs append at the end of the bar.
- Closing a chat tab leaves the WO group's relative order unchanged; the group shifts left as a whole.
- Active-tab styling, switch-to-next/prev navigation (`NavigationController`), and tab-bar keyboard cycling all consume `getOrderedTabs()` so cycling goes chat → chat → … → WO → WO → chat (wraps).
- Persisted tab-state restore uses the saved insertion order to seed the `Map`; the sorted view derives from there. No migration needed for ordering.

### DOM/CSS

Tab bar renderer reads `tab.kind`. When `'work-order'`:

- Add CSS class `claudian-tab--work-order` to the tab root.
- Prepend an icon span (lucide `clipboard-list`) inside the tab chrome with class `claudian-tab-icon`.

```css
.claudian-tab--work-order {
  border-left: 2px solid var(--color-accent);
}
.claudian-tab--work-order .claudian-tab-icon {
  width: 12px;
  height: 12px;
  margin-right: 4px;
  opacity: 0.8;
}
```

Colors use existing CSS variables. No inline styles.

### Tooltip

Work-order tab tooltip suffix: ` (work order)`. i18n key `chat.tabs.workOrderSuffix`.

### Tab title text

Unchanged. The icon and accent border carry the kind signal.

## Settings UI + migration

### General settings tab

Replace the single `Max tabs` row with two rows:

- **Max chat tabs** — numeric input, bounds `MIN_TABS..MAX_TABS`, bound to `maxChatTabs`. Help text: "Maximum chat tabs you can have open at once."
- **Max work-order tabs** — numeric input, same bounds, bound to `maxWorkOrderTabs`. Help text: "Maximum chat tabs Agent Board may open for work-order runs. Separate from chat tabs."

Saved via the existing settings storage flow. Changes propagate through the existing settings-change hook; `TabManager.getMaxTabsFor` reads fresh values on each call (no cache).

### Defaults

```ts
// src/app/settings/defaultSettings.ts
maxChatTabs: DEFAULT_MAX_CHAT_TABS,
maxWorkOrderTabs: DEFAULT_MAX_WORK_ORDER_TABS,
```

Drop the old `maxTabs` field.

### i18n keys

Added to `src/i18n/locales/en.json` and the `src/i18n/types.ts` shape:

- `chat.tabs.maxChat`, `chat.tabs.maxChatDesc`
- `chat.tabs.maxWorkOrder`, `chat.tabs.maxWorkOrderDesc`
- `chat.tabs.maxChatReached`, `chat.tabs.maxWorkOrderReached`
- `chat.tabs.workOrderSuffix`

Other locales fall back to English until translated; matches the existing pattern.

## Tests

### Unit (`tests/unit/`)

| Spec | Asserts |
|------|---------|
| `tabs/TabManager.kindCap.test.ts` | `createTab` with default kind respects `maxChatTabs` only; `createTaskRunTab` respects `maxWorkOrderTabs` only; reaching one cap does not block the other; `bypassTabLimit` still escapes both |
| `tabs/TabManager.persistence.test.ts` | restored persisted state preserves `kind`; missing `kind` defaults to `'chat'` |
| `tabs/TabManager.events.test.ts` | `chat:tabs-changed` payload includes `chatCount` and `workOrderCount` matching internal counts after create/close |
| `tabs/TabManager.order.test.ts` | `getOrderedTabs()` returns all chat tabs first then all WO tabs; within each group insertion order is preserved; creating a chat tab after a WO tab inserts it before the WO group in the ordered view; closing a chat tab leaves the WO group's relative order intact |
| `app/settings/migration.test.ts` | only `maxTabs` present → migrates to `maxChatTabs`, seeds `maxWorkOrderTabs` to default; both new keys present → no-op; neither present → defaults applied |
| `features/tasks/execution/QueueRunner.freeSlots.test.ts` | with WO cap=2 and 2 WO tabs open, free slots = 0; opening N chat tabs does not change WO free count; an outstanding reservation decrements free slots |

### Integration (`tests/integration/`)

| Spec | Scenario |
|------|----------|
| `tabs/workOrderCap.int.test.ts` | start Agent Board queue with WO cap=2 and chat cap=4; user opens 4 chat tabs; queue still runs up to 2 WO; closing a chat tab does not let the queue exceed WO cap |
| `tabs/maxChatReached.int.test.ts` | user opens `maxChatTabs` chat tabs; the next manual open returns null and emits the user-facing notice; the WO queue continues unaffected |

### Perf

No new perf spec. The change does not move existing performance windows (tab counts stay bounded by the same constants).

## Out of scope

- Promote/demote tab kind at runtime.
- Auto-close work-order tabs when their run reaches a terminal state.
- A separate `ChatTabReservations` instance for chat tabs.
- Drag-reorder of tabs (none today). Render order is a fixed chat-then-WO grouping; manual reordering remains out of scope.
- Run-status badge (running/done/failed) on the tab itself.
- Per-pane differentiation of work-order caps. The cap remains plugin-level, matching the current shared model.

## Open questions

None.
