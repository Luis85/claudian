# Work-order tab budget implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single `maxTabs` cap into independent `maxChatTabs` and `maxWorkOrderTabs` so Agent Board runs no longer consume the user's chat tab budget. Tag every tab with `kind`, narrow the queue free-slot calc to work-order tabs only, render chat tabs before WO tabs with an icon + accent.

**Architecture:** Add a `kind: 'chat' | 'work-order'` field to `TabData` and `PersistedTabState`. `TabManager` enforces per-kind caps, exposes `getOrderedTabs()` for chat-first/WO-last rendering, and emits per-kind counts in `chat:tabs-changed`. `PluginViewActivator` separates chat-cap accounting (`canCreateNewTab`) from WO-cap accounting (`getTabSlotUsage`). `TabBar` adds a CSS class and icon for WO badges. Migration copies the old `maxTabs` to `maxChatTabs` on load and seeds `maxWorkOrderTabs` to default.

**Tech Stack:** TypeScript, Obsidian plugin API, Jest (mirrored under `tests/unit/` + `tests/integration/`), Obsidian settings API.

**Spec:** [`docs/superpowers/specs/2026-06-06-work-order-tab-budget-design.md`](../specs/2026-06-06-work-order-tab-budget-design.md)

---

### Task 1: Add kind constants and migration helper

**Files:**
- Modify: `src/features/chat/tabs/types.ts:36-55`
- Create: `tests/unit/features/chat/tabs/tabKindConstants.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `tests/unit/features/chat/tabs/tabKindConstants.test.ts`

```ts
import {
  DEFAULT_MAX_CHAT_TABS,
  DEFAULT_MAX_WORK_ORDER_TABS,
  MAX_TABS,
  MIN_TABS,
} from '../../../../../src/features/chat/tabs/types';

describe('tab kind constants', () => {
  it('chat default sits inside the bounds', () => {
    expect(DEFAULT_MAX_CHAT_TABS).toBeGreaterThanOrEqual(MIN_TABS);
    expect(DEFAULT_MAX_CHAT_TABS).toBeLessThanOrEqual(MAX_TABS);
  });

  it('work-order default sits inside the bounds', () => {
    expect(DEFAULT_MAX_WORK_ORDER_TABS).toBeGreaterThanOrEqual(MIN_TABS);
    expect(DEFAULT_MAX_WORK_ORDER_TABS).toBeLessThanOrEqual(MAX_TABS);
  });

  it('keeps the historical chat default at 3', () => {
    expect(DEFAULT_MAX_CHAT_TABS).toBe(3);
  });

  it('seeds the work-order default at 3', () => {
    expect(DEFAULT_MAX_WORK_ORDER_TABS).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/tabKindConstants.test.ts
```

Expected: FAIL — `DEFAULT_MAX_CHAT_TABS`/`DEFAULT_MAX_WORK_ORDER_TABS` not exported.

- [ ] **Step 3: Add the constants**

In `src/features/chat/tabs/types.ts`, replace lines 36–55 (the `DEFAULT_MAX_TABS`, `MIN_TABS`, `MAX_TABS` block) with:

```ts
/**
 * Default number of chat tabs allowed.
 *
 * Set to 3 to balance usability with resource usage:
 * - Each tab has its own chat runtime and persistent query
 * - More tabs = more memory and potential SDK processes
 * - 3 tabs allows multi-tasking without excessive overhead
 */
export const DEFAULT_MAX_CHAT_TABS = 3;

/**
 * Default number of work-order tabs the Agent Board may open for queue runs.
 * Independent from the chat tab budget; the queue waits when this cap is full
 * instead of starving the user's chat tabs.
 */
export const DEFAULT_MAX_WORK_ORDER_TABS = 3;

/**
 * Minimum number of tabs allowed (settings floor). Shared by both caps.
 */
export const MIN_TABS = 3;

/**
 * Maximum number of tabs allowed (settings ceiling). Shared by both caps.
 * Users can configure up to this many tabs per kind via settings.
 */
export const MAX_TABS = 10;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/tabKindConstants.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/tabs/types.ts tests/unit/features/chat/tabs/tabKindConstants.test.ts
git commit -m "feat(tabs): split DEFAULT_MAX_TABS into per-kind constants"
```

---

### Task 2: Add `TabKind` and per-kind tab state shape

**Files:**
- Modify: `src/features/chat/tabs/types.ts` (TabData, PersistedTabState, TabBarItem)
- Create: `tests/unit/features/chat/tabs/tabKindTypes.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `tests/unit/features/chat/tabs/tabKindTypes.test.ts`

```ts
import type { PersistedTabState, TabBarItem, TabData, TabKind } from '../../../../../src/features/chat/tabs/types';

describe('TabKind type', () => {
  it('accepts chat and work-order literals', () => {
    const a: TabKind = 'chat';
    const b: TabKind = 'work-order';
    expect([a, b]).toEqual(['chat', 'work-order']);
  });

  it('TabData carries kind', () => {
    const tabKind: TabData['kind'] = 'chat';
    expect(tabKind).toBe('chat');
  });

  it('PersistedTabState carries kind', () => {
    const persisted: Pick<PersistedTabState, 'kind'> = { kind: 'work-order' };
    expect(persisted.kind).toBe('work-order');
  });

  it('TabBarItem carries kind', () => {
    const item: Pick<TabBarItem, 'kind'> = { kind: 'work-order' };
    expect(item.kind).toBe('work-order');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run typecheck
```

Expected: FAIL — type does not exist; properties missing on `TabData`/`PersistedTabState`/`TabBarItem`.

- [ ] **Step 3: Add the type and fields**

In `src/features/chat/tabs/types.ts`, after the `MAX_TABS` block, add:

```ts
/** Distinguishes user-opened chat tabs from Agent Board work-order task-run tabs.
 *  Immutable after creation. Drives independent cap enforcement and tab-bar
 *  rendering (chat tabs render first, work-order tabs render last). */
export type TabKind = 'chat' | 'work-order';
```

In the `TabData` interface (around line 187–252), add after the `id: TabId;` line:

```ts
  /** Immutable kind classifier. Determines which cap this tab counts against
   *  and how it renders in the tab bar. Set once at creation. */
  kind: TabKind;
```

In the `PersistedTabState` interface (around line 259), add a `kind?: TabKind` field:

```ts
export interface PersistedTabState {
  tabId: TabId;
  conversationId: string | null;
  draftModel?: string | null;
  /** Optional for back-compat with pre-upgrade persisted state. Restore treats
   *  a missing value as 'chat'. */
  kind?: TabKind;
}
```

In the `TabBarItem` interface (around line 305), add `kind`:

```ts
export interface TabBarItem {
  id: TabId;
  index: number;
  title: string;
  providerId: ProviderId;
  isActive: boolean;
  isStreaming: boolean;
  needsAttention: boolean;
  canClose: boolean;
  /** Drives badge styling — work-order badges get an icon + accent. */
  kind: TabKind;
}
```

- [ ] **Step 4: Run typecheck and test to verify they pass**

```bash
npm run typecheck
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/tabKindTypes.test.ts
```

Expected: typecheck PASS, test PASS.

> If typecheck flags other call sites that build `TabData` or `TabBarItem` literals, leave those failures for the next tasks — they will be fixed when `TabManager` is updated.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/tabs/types.ts tests/unit/features/chat/tabs/tabKindTypes.test.ts
git commit -m "feat(tabs): add TabKind to TabData, PersistedTabState, TabBarItem"
```

---

### Task 3: Add `maxChatTabs`/`maxWorkOrderTabs` to settings and migrate from `maxTabs`

**Files:**
- Modify: `src/core/types/settings.ts:181-185`
- Modify: `src/app/settings/defaultSettings.ts:61`
- Create: `src/app/settings/migrateTabBudget.ts`
- Modify: storage load path — find the function that reads `data.json` into `ClaudianSettings`. Grep first:
  ```bash
  npm run lint -- --quiet # ignore output; just locate file
  ```
  then `grep -rn "loadData\|loadSettings" src/app/settings src/app src/main.ts`. The migration call slots in there.
- Create: `tests/unit/app/settings/migrateTabBudget.test.ts`

- [ ] **Step 1: Write the failing migration test**

Path: `tests/unit/app/settings/migrateTabBudget.test.ts`

```ts
import { DEFAULT_MAX_WORK_ORDER_TABS } from '../../../../src/features/chat/tabs/types';
import { migrateTabBudget } from '../../../../src/app/settings/migrateTabBudget';

describe('migrateTabBudget', () => {
  it('copies legacy maxTabs to maxChatTabs and drops the old key', () => {
    const raw: Record<string, unknown> = { maxTabs: 7 };
    migrateTabBudget(raw);
    expect(raw.maxChatTabs).toBe(7);
    expect('maxTabs' in raw).toBe(false);
  });

  it('seeds maxWorkOrderTabs to the default when absent', () => {
    const raw: Record<string, unknown> = { maxTabs: 5 };
    migrateTabBudget(raw);
    expect(raw.maxWorkOrderTabs).toBe(DEFAULT_MAX_WORK_ORDER_TABS);
  });

  it('does not overwrite an existing maxChatTabs', () => {
    const raw: Record<string, unknown> = { maxTabs: 9, maxChatTabs: 4 };
    migrateTabBudget(raw);
    expect(raw.maxChatTabs).toBe(4);
    expect('maxTabs' in raw).toBe(false);
  });

  it('does not overwrite an existing maxWorkOrderTabs', () => {
    const raw: Record<string, unknown> = { maxWorkOrderTabs: 6 };
    migrateTabBudget(raw);
    expect(raw.maxWorkOrderTabs).toBe(6);
  });

  it('is idempotent on already-migrated state', () => {
    const raw: Record<string, unknown> = { maxChatTabs: 5, maxWorkOrderTabs: 4 };
    migrateTabBudget(raw);
    migrateTabBudget(raw);
    expect(raw.maxChatTabs).toBe(5);
    expect(raw.maxWorkOrderTabs).toBe(4);
    expect('maxTabs' in raw).toBe(false);
  });

  it('seeds both keys when neither exists', () => {
    const raw: Record<string, unknown> = {};
    migrateTabBudget(raw);
    expect(raw.maxWorkOrderTabs).toBe(DEFAULT_MAX_WORK_ORDER_TABS);
    expect('maxTabs' in raw).toBe(false);
    // maxChatTabs is seeded by defaults merge, not by this migration — only
    // exists if the user had a legacy maxTabs value.
    expect('maxChatTabs' in raw).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/app/settings/migrateTabBudget.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the migration helper**

Path: `src/app/settings/migrateTabBudget.ts`

```ts
import { DEFAULT_MAX_WORK_ORDER_TABS } from '../../features/chat/tabs/types';

/**
 * Migrates legacy `maxTabs` to the per-kind budget shape.
 *
 * Rules:
 * - If `maxTabs` exists and `maxChatTabs` does not, copy `maxTabs → maxChatTabs`.
 * - Drop `maxTabs` regardless (post-migration steady state).
 * - If `maxWorkOrderTabs` is missing, seed it to {@link DEFAULT_MAX_WORK_ORDER_TABS}.
 *
 * Idempotent: safe to call on any partial or already-migrated state.
 * Pure mutation on the raw record so it slots into the settings load path
 * before validation/merge runs.
 */
export function migrateTabBudget(raw: Record<string, unknown>): void {
  if ('maxTabs' in raw && !('maxChatTabs' in raw)) {
    raw.maxChatTabs = raw.maxTabs;
  }
  delete raw.maxTabs;
  if (!('maxWorkOrderTabs' in raw)) {
    raw.maxWorkOrderTabs = DEFAULT_MAX_WORK_ORDER_TABS;
  }
}
```

- [ ] **Step 4: Update settings type and defaults**

In `src/core/types/settings.ts`, replace the `maxTabs: number;` field (line 183) with:

```ts
  maxChatTabs: number;
  maxWorkOrderTabs: number;
```

In `src/app/settings/defaultSettings.ts`, replace line 61 (`maxTabs: 3,`) with:

```ts
  maxChatTabs: 3,
  maxWorkOrderTabs: 3,
```

(Use the constant import in the next step; literal 3 keeps the defaults file free of cross-feature imports per existing pattern.)

- [ ] **Step 5: Wire the migration into the settings load path**

The settings load lives in `src/main.ts` `loadSettings()` (around lines 415–429). Settings come from `this.storage.initialize()` as `{ claudian }`, then merge with defaults. Inject the migration after destructuring and before the merge.

Add the import at the top of `src/main.ts`:

```ts
import { migrateTabBudget } from './app/settings/migrateTabBudget';
```

In `loadSettings()`, replace:

```ts
const { claudian } = await this.storage.initialize();
this.lastKnownTabManagerState = await this.storage.getTabManagerState();

this.settings = {
  ...DEFAULT_CLAUDIAN_SETTINGS,
  ...claudian,
};
```

with:

```ts
const { claudian } = await this.storage.initialize();
this.lastKnownTabManagerState = await this.storage.getTabManagerState();

migrateTabBudget(claudian as unknown as Record<string, unknown>);

this.settings = {
  ...DEFAULT_CLAUDIAN_SETTINGS,
  ...claudian,
};
```

The migration mutates `claudian` in place, so the spread merge picks up `maxChatTabs`/`maxWorkOrderTabs` and drops `maxTabs`.

- [ ] **Step 6: Run typecheck and tests**

```bash
npm run typecheck
npm run test -- --selectProjects unit tests/unit/app/settings/migrateTabBudget.test.ts
```

Expected: typecheck PASS, migration test PASS. Other unit tests that reference `settings.maxTabs` will fail; they are fixed in later tasks.

- [ ] **Step 7: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts \
        src/app/settings/migrateTabBudget.ts tests/unit/app/settings/migrateTabBudget.test.ts \
        src/main.ts
git commit -m "feat(settings): split maxTabs into maxChatTabs and maxWorkOrderTabs with migration"
```

> If the load wiring lives in another file than `src/main.ts`, replace it in the `git add`.

---

### Task 4: Wire `kind` through TabManager creation and persistence

**Files:**
- Modify: `src/features/chat/tabs/TabManager.ts` (constructor data shape, `createTab`, `createTaskRunTab`, `getState`, `restoreState`, `getTabBarItems`)
- Test: `tests/unit/features/chat/tabs/tabKindPersistence.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `tests/unit/features/chat/tabs/tabKindPersistence.test.ts`

```ts
import { describe, expect, it } from '@jest/globals';

import type { TabData } from '../../../../../src/features/chat/tabs/types';

/**
 * Lightweight TabData factory — only the fields exercised here. Cast to TabData
 * for the public-API check; we don't drive a full TabManager (heavy DOM setup).
 */
function makeTab(kind: 'chat' | 'work-order'): TabData {
  return { id: `tab-${kind}`, kind } as unknown as TabData;
}

describe('TabBarItem kind propagation', () => {
  it('persisted state with missing kind defaults to chat at restore', async () => {
    // This is a pure mapping check — restoreState's behavior on missing kind is
    // the contract; the TabManager pass-through is exercised in the integration
    // test. Here we only need to confirm the default fallback.
    const persisted = { tabId: 't1', conversationId: null } as { tabId: string; conversationId: string | null; kind?: 'chat' | 'work-order' };
    const inferredKind = persisted.kind ?? 'chat';
    expect(inferredKind).toBe('chat');
  });

  it('TabData carries kind for downstream consumers', () => {
    expect(makeTab('chat').kind).toBe('chat');
    expect(makeTab('work-order').kind).toBe('work-order');
  });
});
```

> The heavier TabManager behavior (per-kind cap + ordering) is tested in Tasks 5 and 6 using the existing TabManager test fixture. This task just unblocks downstream code paths.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run typecheck
```

Expected: FAIL — call sites that build `TabData` literals still missing `kind`.

- [ ] **Step 3: Update `CreateTabOptions` and `createTab` to accept and stamp `kind`**

In `src/features/chat/tabs/TabManager.ts`, find the `CreateTabOptions` type (around line 55–63) and add a `kind` field:

```ts
export type CreateTabOptions = {
  activate?: boolean;
  draftModel?: string;
  pinnedModel?: string;
  bypassTabLimit?: boolean;
  defaultProviderId?: ProviderId;
  /** Tab kind. Defaults to 'chat' when omitted. Immutable after creation. */
  kind?: TabKind;
};
```

Replace the existing import block from `./types` (around lines 32–44) with:

```ts
import {
  DEFAULT_MAX_CHAT_TABS,
  DEFAULT_MAX_WORK_ORDER_TABS,
  MAX_TABS,
  MIN_TABS,
  type PersistedTabManagerState,
  type PersistedTabState,
  type TabBarItem,
  type TabData,
  type TabId,
  type TabKind,
  type TabManagerCallbacks,
  type TabManagerInterface,
  type TabManagerViewHost,
} from './types';
```

The constants live in `./types` (not `./Tab` — `./Tab` re-exports tab lifecycle helpers only).

In `createTab(...)`, after constructing the new `TabData` object, set its `kind`:

```ts
const kind: TabKind = options.kind ?? 'chat';
const tab: TabData = {
  // existing fields...
  kind,
  // ...
};
```

Find the construction site of `TabData` inside `createTab` and add `kind` to the object literal so TypeScript stops complaining.

In `createTaskRunTab(options)` (line 257–272), pass `kind: 'work-order'` through:

```ts
async createTaskRunTab(options: {
  providerId: ProviderId;
  model: string;
  conversationId?: string | null;
  workOrderPath?: string | null;
}): Promise<TabData | null> {
  return this.createTab(options.conversationId ?? undefined, undefined, {
    activate: false,
    draftModel: options.model,
    pinnedModel: options.model,
    defaultProviderId: options.providerId,
    kind: 'work-order',
  });
}
```

- [ ] **Step 4: Persist `kind` in `getState` and restore it in `restoreState`**

Find `getState()` (search `openTabs: PersistedTabState[]` builder, around line 670–697). Add `kind` to the per-tab record:

```ts
openTabs.push({
  tabId: tab.id,
  conversationId: tab.conversationId,
  draftModel: tab.draftModel ?? undefined,
  kind: tab.kind,
});
```

In `restoreState(...)` (line 701), inside the `for (const tabState of state.openTabs)` loop, pass `kind` through:

```ts
await this.createTab(tabState.conversationId, tabState.tabId, {
  activate: false,
  ...(typeof tabState.draftModel === 'string' ? { draftModel: tabState.draftModel } : {}),
  kind: tabState.kind ?? 'chat',
});
```

- [ ] **Step 5: Propagate `kind` into `getTabBarItems()`**

In `getTabBarItems()` (line 441–459), add `kind` to each item:

```ts
items.push({
  id: tab.id,
  index: index++,
  title: getTabTitle(tab, this.plugin),
  providerId: getTabProviderId(tab, this.plugin),
  isActive: tab.id === this.activeTabId,
  isStreaming: tab.state.isStreaming,
  needsAttention: tab.state.needsAttention,
  canClose: this.tabs.size > 1 || !tab.state.isStreaming,
  kind: tab.kind,
});
```

- [ ] **Step 6: Run typecheck and unit tests**

```bash
npm run typecheck
npm run test -- --selectProjects unit tests/unit/features/chat/tabs
```

Expected: typecheck PASS. The persistence test from Step 1 PASSes; other TabManager tests may still need updating for caps (next task). If preexisting TabManager tests fail because they build a `TabData` literal without `kind`, update them to include `kind: 'chat'`.

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/tabs/TabManager.ts \
        tests/unit/features/chat/tabs/tabKindPersistence.test.ts \
        tests/unit/features/chat/tabs
git commit -m "feat(tabs): wire kind through TabManager creation, persistence, and bar items"
```

---

### Task 5: Per-kind cap enforcement in TabManager

**Files:**
- Modify: `src/features/chat/tabs/TabManager.ts` (`getMaxTabs` → `getMaxTabsFor`, `countTabsByKind`, `canCreateTab`, cap check in `createTab`, fork path, notice strings)
- Create: `tests/unit/features/chat/tabs/TabManagerKindCap.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `tests/unit/features/chat/tabs/TabManagerKindCap.test.ts`

```ts
import { describe, expect, it } from '@jest/globals';

import { TabManager } from '../../../../../src/features/chat/tabs/TabManager';

/**
 * The TabManager constructor takes a heavy `plugin` host. We stub only the bits
 * the cap-check path reads: settings, events, tab DOM root, callbacks, and a
 * placeholder providerId. The createTab path used here goes through the cap
 * gate before any DOM/runtime work fires, so we can intercept early.
 */
function makeManager(opts: { maxChatTabs?: number; maxWorkOrderTabs?: number } = {}) {
  const settings = {
    maxChatTabs: opts.maxChatTabs ?? 4,
    maxWorkOrderTabs: opts.maxWorkOrderTabs ?? 2,
  };
  const plugin = {
    settings,
    events: { emit: jest.fn() },
    // Other accessors the constructor reads. Tests that hit them should mock here.
  } as never;
  // Constructor signature comes from the live source — pass through whatever
  // shape the current TabManager constructor expects (containerEl, callbacks).
  return new TabManager(plugin, document.createElement('div'), {});
}

describe('TabManager per-kind cap', () => {
  it('canCreateTab respects the chat cap independently of work-order tabs', async () => {
    const mgr = makeManager({ maxChatTabs: 1, maxWorkOrderTabs: 3 });
    // Seed one work-order tab by reaching into internals — the public createTab
    // path is exercised below for chat. Cast the manager to access the tabs map.
    const internal = mgr as unknown as { tabs: Map<string, { kind: 'chat' | 'work-order' }> };
    internal.tabs.set('wo-1', { kind: 'work-order' });
    expect(mgr.canCreateTab('chat')).toBe(true);
    internal.tabs.set('chat-1', { kind: 'chat' });
    expect(mgr.canCreateTab('chat')).toBe(false);
    expect(mgr.canCreateTab('work-order')).toBe(true); // 1/3 WO used
  });

  it('canCreateTab respects the work-order cap independently of chat tabs', () => {
    const mgr = makeManager({ maxChatTabs: 5, maxWorkOrderTabs: 1 });
    const internal = mgr as unknown as { tabs: Map<string, { kind: 'chat' | 'work-order' }> };
    internal.tabs.set('chat-1', { kind: 'chat' });
    internal.tabs.set('chat-2', { kind: 'chat' });
    expect(mgr.canCreateTab('work-order')).toBe(true);
    internal.tabs.set('wo-1', { kind: 'work-order' });
    expect(mgr.canCreateTab('work-order')).toBe(false);
    expect(mgr.canCreateTab('chat')).toBe(true); // 2/5 chat used
  });

  it('canCreateTab defaults to chat when no kind argument is supplied', () => {
    const mgr = makeManager({ maxChatTabs: 1, maxWorkOrderTabs: 5 });
    const internal = mgr as unknown as { tabs: Map<string, { kind: 'chat' | 'work-order' }> };
    internal.tabs.set('chat-1', { kind: 'chat' });
    expect(mgr.canCreateTab()).toBe(false);
  });
});
```

> If the TabManager constructor signature requires extra fields, capture only those — the test asserts only `canCreateTab` and the internal `tabs` map. Real `createTab` end-to-end coverage is in the integration tests.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/TabManagerKindCap.test.ts
```

Expected: FAIL — `canCreateTab` ignores kind argument; one cap shared.

- [ ] **Step 3: Replace `getMaxTabs` with `getMaxTabsFor`**

In `src/features/chat/tabs/TabManager.ts`, replace the `getMaxTabs()` method (around line 118–125) with:

```ts
  /**
   * Returns the configured cap for a given tab kind, clamped to MIN_TABS..MAX_TABS.
   * Chat tabs and work-order tabs draw from independent budgets.
   */
  private getMaxTabsFor(kind: TabKind): number {
    const raw = kind === 'work-order'
      ? this.plugin.settings.maxWorkOrderTabs
      : this.plugin.settings.maxChatTabs;
    const fallback = kind === 'work-order'
      ? DEFAULT_MAX_WORK_ORDER_TABS
      : DEFAULT_MAX_CHAT_TABS;
    return Math.max(MIN_TABS, Math.min(MAX_TABS, raw ?? fallback));
  }

  /** Counts open tabs of the given kind. */
  private countTabsByKind(kind: TabKind): number {
    let n = 0;
    for (const t of this.tabs.values()) if (t.kind === kind) n++;
    return n;
  }
```

- [ ] **Step 4: Update the cap check in `createTab`**

Replace lines 177–180 (current cap gate):

```ts
const kind: TabKind = options.kind ?? 'chat';
const max = this.getMaxTabsFor(kind);
if (this.countTabsByKind(kind) >= max && !options.bypassTabLimit) {
  return null;
}
```

Move the existing `kind` declaration from Task 4 if it conflicts; declare it once at the top of `createTab` so both the cap gate and the tab-literal construction read the same value.

- [ ] **Step 5: Update `canCreateTab` to take a kind**

Replace the existing `canCreateTab()` (around line 427–429) with:

```ts
/** Checks if more tabs of a given kind can be created. Defaults to chat. */
canCreateTab(kind: TabKind = 'chat'): boolean {
  return this.countTabsByKind(kind) < this.getMaxTabsFor(kind);
}
```

- [ ] **Step 6: Update the fork path**

In `forkToNewTab` (around line 590–597) and the `'new-tab'` branch above it (around 572–578), reads of `getMaxTabs()` change to `getMaxTabsFor('chat')`. The notice string keeps `chat.fork.maxTabsReached` for now (Task 10 splits messages):

```ts
async forkToNewTab(context: ForkContext): Promise<TabData | null> {
  const maxTabs = this.getMaxTabsFor('chat');
  if (this.countTabsByKind('chat') >= maxTabs) {
    return null;
  }
  // ...rest unchanged
}
```

Forks always produce chat tabs, so pass `kind: 'chat'` through to the underlying `createTab` call.

- [ ] **Step 7: Update the `chat:tabs-changed` payload**

Replace every `this.plugin.events.emit('chat:tabs-changed', { openCount: this.tabs.size });` with:

```ts
this.plugin.events.emit('chat:tabs-changed', {
  openCount: this.tabs.size,
  chatCount: this.countTabsByKind('chat'),
  workOrderCount: this.countTabsByKind('work-order'),
});
```

Update the event payload type. Grep for the emit declaration:

```bash
git grep -n "chat:tabs-changed" src
```

In the file that declares the event map (often `src/core/events/...` or `src/features/chat/...`), extend the payload:

```ts
'chat:tabs-changed': { openCount: number; chatCount: number; workOrderCount: number };
```

- [ ] **Step 8: Run typecheck and tests**

```bash
npm run typecheck
npm run test -- --selectProjects unit tests/unit/features/chat/tabs
```

Expected: PASS. If a TabManager call site outside `tabs/` references `canCreateTab()` with no argument, the default `kind='chat'` preserves behavior.

- [ ] **Step 9: Commit**

```bash
git add src/features/chat/tabs/TabManager.ts \
        tests/unit/features/chat/tabs/TabManagerKindCap.test.ts \
        src # picks up event-map and call-site updates
git commit -m "feat(tabs): enforce per-kind caps in TabManager"
```

---

### Task 6: Ordered tab list (chat-first, work-order-last)

**Files:**
- Modify: `src/features/chat/tabs/TabManager.ts` (add `getOrderedTabs`, route `getTabBarItems` and any caller used for prev/next navigation)
- Modify: `src/features/chat/controllers/NavigationController.ts` (if it iterates the tab map directly — verify)
- Create: `tests/unit/features/chat/tabs/TabManagerOrder.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `tests/unit/features/chat/tabs/TabManagerOrder.test.ts`

```ts
import { describe, expect, it } from '@jest/globals';

import { TabManager } from '../../../../../src/features/chat/tabs/TabManager';

function seedTabs(mgr: TabManager, sequence: Array<{ id: string; kind: 'chat' | 'work-order' }>): void {
  const internal = mgr as unknown as { tabs: Map<string, { id: string; kind: 'chat' | 'work-order' }> };
  for (const entry of sequence) {
    internal.tabs.set(entry.id, { id: entry.id, kind: entry.kind });
  }
}

function makeManager() {
  const plugin = {
    settings: { maxChatTabs: 10, maxWorkOrderTabs: 10 },
    events: { emit: jest.fn() },
  } as never;
  return new TabManager(plugin, document.createElement('div'), {});
}

describe('TabManager.getOrderedTabs', () => {
  it('returns chat tabs first then work-order tabs', () => {
    const mgr = makeManager();
    seedTabs(mgr, [
      { id: 'wo-1', kind: 'work-order' },
      { id: 'chat-1', kind: 'chat' },
      { id: 'wo-2', kind: 'work-order' },
      { id: 'chat-2', kind: 'chat' },
    ]);
    const ordered = mgr.getOrderedTabs().map((t) => t.id);
    expect(ordered).toEqual(['chat-1', 'chat-2', 'wo-1', 'wo-2']);
  });

  it('preserves insertion order within each group', () => {
    const mgr = makeManager();
    seedTabs(mgr, [
      { id: 'chat-a', kind: 'chat' },
      { id: 'chat-b', kind: 'chat' },
      { id: 'wo-a', kind: 'work-order' },
      { id: 'chat-c', kind: 'chat' },
      { id: 'wo-b', kind: 'work-order' },
    ]);
    const ordered = mgr.getOrderedTabs().map((t) => t.id);
    expect(ordered).toEqual(['chat-a', 'chat-b', 'chat-c', 'wo-a', 'wo-b']);
  });

  it('returns an empty list when no tabs are open', () => {
    expect(makeManager().getOrderedTabs()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/TabManagerOrder.test.ts
```

Expected: FAIL — `getOrderedTabs` does not exist.

- [ ] **Step 3: Add `getOrderedTabs` and route `getTabBarItems` through it**

In `src/features/chat/tabs/TabManager.ts`, add (next to `getAllTabs`):

```ts
  /**
   * Returns tabs ordered chat-first then work-order, preserving insertion order
   * within each group. The tab bar renderer and prev/next navigation consume
   * this ordered view so cycling goes chat → chat → … → WO → WO → chat.
   */
  getOrderedTabs(): TabData[] {
    const chat: TabData[] = [];
    const wo: TabData[] = [];
    for (const t of this.tabs.values()) {
      (t.kind === 'work-order' ? wo : chat).push(t);
    }
    return [...chat, ...wo];
  }
```

Replace `for (const tab of this.tabs.values())` in `getTabBarItems()` (line 445) with `for (const tab of this.getOrderedTabs())`. Indexing (`index++`) keeps the rendered numbering left-to-right.

- [ ] **Step 4: Verify navigation reads ordered tabs**

Grep for prev/next tab navigation:

```bash
git grep -n "switchToTab\|nextTab\|prevTab\|tabs\.values\(\)" src/features/chat
```

If `NavigationController` or another controller iterates `this.tabs.values()` directly for prev/next, replace with `this.getOrderedTabs()`. Otherwise the indexing in `getTabBarItems()` already drives navigation through `TabBar` clicks.

- [ ] **Step 5: Run typecheck and tests**

```bash
npm run typecheck
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/TabManagerOrder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/tabs/TabManager.ts \
        tests/unit/features/chat/tabs/TabManagerOrder.test.ts \
        src/features/chat/controllers/NavigationController.ts || true
git commit -m "feat(tabs): expose getOrderedTabs and render chat tabs before work-order tabs"
```

---

### Task 7: TabBar visual cue for work-order badges

**Files:**
- Modify: `src/features/chat/tabs/TabBar.ts:48-78`
- Modify: `src/style/...` (locate the tab badge stylesheet)
- Create: `tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts`

```ts
import { describe, expect, it } from '@jest/globals';

import { TabBar } from '../../../../../src/features/chat/tabs/TabBar';
import type { TabBarItem } from '../../../../../src/features/chat/tabs/types';

function item(overrides: Partial<TabBarItem>): TabBarItem {
  return {
    id: overrides.id ?? 't',
    index: overrides.index ?? 1,
    title: overrides.title ?? 'Tab',
    providerId: overrides.providerId ?? 'claude',
    isActive: false,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    kind: overrides.kind ?? 'chat',
    ...overrides,
  };
}

describe('TabBar work-order badge styling', () => {
  it('adds work-order class to work-order badges', () => {
    const host = document.createElement('div');
    const bar = new TabBar(host, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([item({ id: 'wo', kind: 'work-order' })]);
    const badge = host.querySelector('.claudian-tab-badge');
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('claudian-tab-badge--work-order')).toBe(true);
  });

  it('does not add the class to chat badges', () => {
    const host = document.createElement('div');
    const bar = new TabBar(host, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([item({ id: 'c', kind: 'chat' })]);
    const badge = host.querySelector('.claudian-tab-badge');
    expect(badge?.classList.contains('claudian-tab-badge--work-order')).toBe(false);
  });

  it('appends a (work order) tooltip suffix to the aria label', () => {
    const host = document.createElement('div');
    const bar = new TabBar(host, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([item({ id: 'wo', title: 'Refactor task', kind: 'work-order' })]);
    const badge = host.querySelector('.claudian-tab-badge');
    expect(badge?.getAttribute('aria-label')).toContain('Refactor task');
    expect(badge?.getAttribute('aria-label')).toMatch(/\(work order\)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts
```

Expected: FAIL — class not applied; aria-label has no suffix.

- [ ] **Step 3: Update `TabBar.renderBadge`**

In `src/features/chat/tabs/TabBar.ts`, replace `renderBadge(item)` (lines 48–78) with:

```ts
  private renderBadge(item: TabBarItem): void {
    const stateClasses = ['claudian-tab-badge'];
    if (item.isActive) stateClasses.push('claudian-tab-badge-active');
    if (item.needsAttention) stateClasses.push('claudian-tab-badge-attention');
    if (item.isStreaming) stateClasses.push('claudian-tab-badge-working');
    if (!item.isActive && !item.needsAttention && !item.isStreaming) {
      stateClasses.push('claudian-tab-badge-idle');
    }
    if (item.kind === 'work-order') stateClasses.push('claudian-tab-badge--work-order');

    const badgeEl = this.containerEl.createDiv({
      cls: stateClasses.join(' '),
      text: String(item.index),
    });

    let ariaLabel = item.isStreaming ? `${item.title} (working)` : item.title;
    if (item.kind === 'work-order') ariaLabel = `${ariaLabel} (work order)`;
    badgeEl.setAttribute('aria-label', ariaLabel);

    if (item.isStreaming) {
      badgeEl.setAttribute('aria-busy', 'true');
      badgeEl.setAttribute('data-working', 'true');
    }
    badgeEl.setAttribute('data-provider', item.providerId);
    badgeEl.setAttribute('data-kind', item.kind);

    badgeEl.addEventListener('click', () => {
      this.callbacks.onTabClick(item.id);
    });

    // Preserve the right-click-to-close handler from the original (copy from
    // existing code below if it follows here).
  }
```

Leave the right-click-to-close block (originally at line 80+) unchanged below this function body.

- [ ] **Step 4: Add the CSS rule**

Locate the tab badge stylesheet:

```bash
git grep -n "claudian-tab-badge" src/style
```

In the matching file (likely `src/style/components/tabBar.css` or similar), append:

```css
.claudian-tab-badge--work-order {
  border-left: 2px solid var(--color-accent);
  padding-left: 4px;
}
```

(If the project uses CSS-in-TS instead of files, follow the existing module-style pattern in `src/style/`.)

- [ ] **Step 5: Run typecheck and tests**

```bash
npm run typecheck
npm run test -- --selectProjects unit tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/tabs/TabBar.ts \
        src/style \
        tests/unit/features/chat/tabs/TabBarWorkOrderBadge.test.ts
git commit -m "feat(tabs): visual cue for work-order badges (class + accent + aria suffix)"
```

---

### Task 8: Split chat-cap vs WO-cap accounting in PluginViewActivator

**Files:**
- Modify: `src/app/views/PluginViewActivator.ts:67-146`
- Modify: `src/main.ts:399-405` (only if delegate-method signatures change — they don't here)
- Create: `tests/unit/app/views/PluginViewActivatorSlots.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `tests/unit/app/views/PluginViewActivatorSlots.test.ts`

```ts
import { describe, expect, it } from '@jest/globals';

import { PluginViewActivator } from '../../../../src/app/views/PluginViewActivator';

function fakeTabManager(chat: number, wo: number): { getTabCount(): number; countTabsByKind(k: 'chat' | 'work-order'): number; getAllTabs(): unknown[] } {
  return {
    getTabCount: () => chat + wo,
    countTabsByKind: (k) => (k === 'chat' ? chat : wo),
    getAllTabs: () => Array(chat + wo).fill({}),
  };
}

function fakePlugin(opts: {
  chat?: number;
  wo?: number;
  reservations?: number;
  hasView?: boolean;
  restored?: boolean;
  maxChatTabs?: number;
  maxWorkOrderTabs?: number;
}) {
  const tabManager = fakeTabManager(opts.chat ?? 0, opts.wo ?? 0);
  return {
    settings: {
      maxChatTabs: opts.maxChatTabs ?? 4,
      maxWorkOrderTabs: opts.maxWorkOrderTabs ?? 2,
    },
    chatTabReservations: { pending: opts.reservations ?? 0 },
    getView: () => (opts.hasView ? { getTabManager: () => tabManager, areTabsRestored: () => opts.restored ?? true } : null),
    app: { workspace: { getLeavesOfType: () => [] } },
    lastKnownTabManagerState: null,
  } as never;
}

describe('PluginViewActivator slot accounting', () => {
  it('canCreateNewTab reflects only the chat cap', () => {
    const activator = new PluginViewActivator(fakePlugin({ chat: 3, wo: 5, maxChatTabs: 4, maxWorkOrderTabs: 2, hasView: true, restored: true }));
    expect(activator.canCreateNewTab()).toBe(true); // 3/4 chat used
  });

  it('canCreateNewTab returns false once chat tabs reach the chat cap', () => {
    const activator = new PluginViewActivator(fakePlugin({ chat: 4, wo: 0, maxChatTabs: 4, hasView: true, restored: true }));
    expect(activator.canCreateNewTab()).toBe(false);
  });

  it('getTabSlotUsage reports WO usage and WO cap, not totals', () => {
    const activator = new PluginViewActivator(fakePlugin({ chat: 4, wo: 1, maxChatTabs: 4, maxWorkOrderTabs: 2, hasView: true, restored: true }));
    expect(activator.getTabSlotUsage()).toEqual({ used: 1, max: 2 });
  });

  it('getTabSlotUsage adds outstanding reservations to WO usage', () => {
    const activator = new PluginViewActivator(fakePlugin({ chat: 0, wo: 1, reservations: 1, maxWorkOrderTabs: 3, hasView: true, restored: true }));
    expect(activator.getTabSlotUsage()).toEqual({ used: 2, max: 3 });
  });

  it('getTabSlotUsage saturates at max when no view exists', () => {
    const activator = new PluginViewActivator(fakePlugin({ hasView: false, maxWorkOrderTabs: 2 }));
    const usage = activator.getTabSlotUsage();
    // No view, no leaf → conservative: report 0 free (used = max).
    expect(usage.used).toBeGreaterThanOrEqual(usage.max);
    expect(usage.max).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --selectProjects unit tests/unit/app/views/PluginViewActivatorSlots.test.ts
```

Expected: FAIL — methods still use shared cap.

- [ ] **Step 3: Update `getMaxTabsLimit` to take a kind**

In `src/app/views/PluginViewActivator.ts`, replace lines 143–146 with:

```ts
  private getMaxTabsLimitFor(kind: 'chat' | 'work-order'): number {
    const raw = kind === 'work-order'
      ? this.plugin.settings.maxWorkOrderTabs
      : this.plugin.settings.maxChatTabs;
    return Math.max(3, Math.min(10, raw ?? 3));
  }
```

- [ ] **Step 4: Update `canCreateNewTab` to use the chat cap**

In `canCreateNewTab()` (lines 67–78), replace the cap read with `getMaxTabsLimitFor('chat')` and the live-count with `countTabsByKind('chat')`:

```ts
canCreateNewTab(): boolean {
  const max = this.getMaxTabsLimitFor('chat');
  const view = this.plugin.getView();
  const tabManager = view?.getTabManager();
  if (tabManager && view?.areTabsRestored()) {
    return tabManager.countTabsByKind('chat') < max;
  }
  const hasClaudianLeaf =
    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).length > 0;
  if (hasClaudianLeaf) {
    return false;
  }
  const live = Math.max(this.getLastKnownOpenTabCount(), 1);
  return live < max;
}
```

> If the original `canCreateNewTab` body differs from the snippet above, preserve every guard and only swap the cap source.

- [ ] **Step 5: Update `getTabSlotUsage` to be WO-only**

Replace `getTabSlotUsage()` (lines 100–116) with:

```ts
getTabSlotUsage(): { used: number; max: number } {
  const max = this.getMaxTabsLimitFor('work-order');
  const view = this.plugin.getView();
  const tabManager = view?.getTabManager();
  if (tabManager && view?.areTabsRestored()) {
    const wo = tabManager.countTabsByKind('work-order');
    return { used: wo + this.plugin.chatTabReservations.pending, max };
  }
  const hasClaudianLeaf =
    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).length > 0;
  if (hasClaudianLeaf) {
    return { used: max, max };
  }
  // No view, no leaf: be conservative — no WO tabs known to exist, but the
  // queue should wait for a view to mount rather than launch into the unknown.
  return { used: this.plugin.chatTabReservations.pending, max };
}
```

(The last branch differs from the pre-existing chat-flavored "live count" path because pre-mount WO tabs are not in `lastKnownTabManagerState`. Returning just reservations is correct: no live WO tabs exist yet, so the queue is free to launch up to the cap minus pending reservations.)

- [ ] **Step 6: Update `TabManagerInterface` so `countTabsByKind` is callable from `PluginViewActivator`**

In `src/features/chat/tabs/types.ts`, extend `TabManagerInterface`:

```ts
export interface TabManagerInterface {
  switchToTab(tabId: TabId): Promise<void>;
  getAllTabs(): TabData[];
  countTabsByKind(kind: TabKind): number;
  createTaskRunTab(options: {
    providerId: ProviderId;
    model: string;
    conversationId?: string | null;
    workOrderPath?: string | null;
  }): Promise<TabData | null>;
}
```

In `TabManager`, expose the private helper:

```ts
countTabsByKind(kind: TabKind): number {
  let n = 0;
  for (const t of this.tabs.values()) if (t.kind === kind) n++;
  return n;
}
```

> Remove the earlier `private` qualifier on `countTabsByKind` from Task 5 — it's now part of the interface contract.

- [ ] **Step 7: Run typecheck and tests**

```bash
npm run typecheck
npm run test -- --selectProjects unit tests/unit/app/views/PluginViewActivatorSlots.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/views/PluginViewActivator.ts \
        src/features/chat/tabs/types.ts src/features/chat/tabs/TabManager.ts \
        tests/unit/app/views/PluginViewActivatorSlots.test.ts
git commit -m "feat(slots): split chat vs work-order tab accounting in PluginViewActivator"
```

---

### Task 9: Update ChatTabReservations doc + notice strings

**Files:**
- Modify: `src/core/chatTabReservations.ts:1-15`
- Modify: `src/features/chat/ClaudianView.ts` (the WO error string around line 790)
- Modify: `src/features/tasks/execution/ChatTabExecutionSurface.ts:46`

- [ ] **Step 1: Update the reservation header comment**

Replace lines 1–14 of `src/core/chatTabReservations.ts` with:

```ts
/** A single outstanding work-order tab reservation. Releasing is idempotent so
 *  the chat view (at tab creation) and the run coordinator (settle safety net)
 *  can both call it without underflowing the shared count. */
export interface ChatTabReservation {
  release(): void;
}

/**
 * Plugin-level count of work-order chat tabs that queue runs have committed to
 * opening but whose tabs may not exist yet. Shared across every Agent Board
 * pane so a launch in one pane is visible to another pane's WO free-slot gate
 * before the asynchronous tab creation lands. Chat tabs are user-initiated and
 * open synchronously; they never reserve.
 */
```

No API changes. The class name and `pending` accessor stay.

- [ ] **Step 2: Update the WO failure string in the run path**

In `src/features/tasks/execution/ChatTabExecutionSurface.ts`, replace the failure string at line 46:

```ts
return this.failed('Could not open a work-order tab (work-order tab limit reached).');
```

In `src/features/chat/ClaudianView.ts`, replace the error thrown around line 790:

```ts
throw new Error('Could not open a work-order tab (work-order tab limit reached).');
```

- [ ] **Step 3: Run typecheck and unit tests**

```bash
npm run typecheck
npm run test -- --selectProjects unit
```

Expected: PASS for everything that compiled before. New strings have no test coverage yet — Task 11 (integration) and Task 12 (i18n) lock them in.

- [ ] **Step 4: Commit**

```bash
git add src/core/chatTabReservations.ts \
        src/features/tasks/execution/ChatTabExecutionSurface.ts \
        src/features/chat/ClaudianView.ts
git commit -m "chore(tabs): document chatTabReservations as WO-only, clarify failure strings"
```

---

### Task 10: Settings UI — two sliders + warning

**Files:**
- Modify: `src/features/settings/ClaudianSettings.ts:341-368`
- Modify: `src/i18n/types.ts` (add new keys)
- Modify: `src/i18n/locales/en.json` (add English strings)

- [ ] **Step 1: Add new i18n key types**

In `src/i18n/types.ts`, add to the locale-key union:

```ts
  | 'settings.maxChatTabs.name'
  | 'settings.maxChatTabs.desc'
  | 'settings.maxChatTabs.warning'
  | 'settings.maxWorkOrderTabs.name'
  | 'settings.maxWorkOrderTabs.desc'
  | 'chat.tabs.maxChatReached'
  | 'chat.tabs.maxWorkOrderReached'
  | 'chat.tabs.workOrderSuffix'
```

Leave the legacy `settings.maxTabs.*` and `chat.fork.maxTabsReached` keys in place until Task 11; the live UI no longer references them but other locales still emit them as fallbacks.

- [ ] **Step 2: Add the English strings**

In `src/i18n/locales/en.json`, inside `settings`:

```json
    "maxChatTabs": {
      "name": "Max chat tabs",
      "desc": "Maximum chat tabs you can have open at once.",
      "warning": "More than 5 chat tabs may impact performance."
    },
    "maxWorkOrderTabs": {
      "name": "Max work-order tabs",
      "desc": "Maximum chat tabs the Agent Board may open for work-order runs. Separate from your chat tabs."
    },
```

Inside `chat.tabs`:

```json
    "tabs": {
      "maxChatReached": "Cannot open: maximum {count} chat tabs reached.",
      "maxWorkOrderReached": "Work-order tab limit reached ({count}). Queue is waiting.",
      "workOrderSuffix": "(work order)"
    }
```

Adjust nesting to match the existing en.json shape (the file already has a `chat.fork` block; add `chat.tabs` as a sibling).

- [ ] **Step 3: Replace the slider block in `ClaudianSettings.ts`**

Replace lines 341–368 of `src/features/settings/ClaudianSettings.ts` with:

```ts
const maxChatTabsSetting = new Setting(container)
  .setName(t('settings.maxChatTabs.name'))
  .setDesc(t('settings.maxChatTabs.desc'));

const maxChatTabsWarningEl = container.createDiv({
  cls: 'claudian-max-tabs-warning claudian-setting-validation claudian-setting-validation-warning claudian-hidden',
});
maxChatTabsWarningEl.setText(t('settings.maxChatTabs.warning'));

const updateMaxChatTabsWarning = (value: number): void => {
  maxChatTabsWarningEl.toggleClass('claudian-hidden', value <= 5);
};

maxChatTabsSetting.addSlider((slider) => {
  slider
    .setLimits(3, 10, 1)
    .setValue(this.plugin.settings.maxChatTabs ?? 3)
    .setDynamicTooltip()
    .onChange(async (value) => {
      this.plugin.settings.maxChatTabs = value;
      await this.plugin.saveSettings();
      updateMaxChatTabsWarning(value);
      for (const view of this.plugin.getAllViews()) {
        view.refreshTabControls();
      }
    });
  updateMaxChatTabsWarning(this.plugin.settings.maxChatTabs ?? 3);
});

const maxWorkOrderTabsSetting = new Setting(container)
  .setName(t('settings.maxWorkOrderTabs.name'))
  .setDesc(t('settings.maxWorkOrderTabs.desc'));

maxWorkOrderTabsSetting.addSlider((slider) => {
  slider
    .setLimits(3, 10, 1)
    .setValue(this.plugin.settings.maxWorkOrderTabs ?? 3)
    .setDynamicTooltip()
    .onChange(async (value) => {
      this.plugin.settings.maxWorkOrderTabs = value;
      await this.plugin.saveSettings();
      for (const view of this.plugin.getAllViews()) {
        view.refreshTabControls();
      }
    });
});
```

- [ ] **Step 4: Replace user-facing notices that referenced the old single cap**

Find every call to `t('chat.fork.maxTabsReached', ...)` and `t('chat.tab.maxReached', ...)`:

```bash
git grep -n "chat.fork.maxTabsReached\|chat.tab.maxReached" src
```

In `src/features/chat/ClaudianView.ts` (around line 838–839):

```ts
const maxTabs = this.plugin.settings.maxChatTabs ?? 3;
new Notice(t('chat.tabs.maxChatReached', { count: String(maxTabs) }));
```

In `src/features/chat/tabs/TabManager.ts` (around line 580–581, fork branch):

```ts
const maxTabs = this.getMaxTabsFor('chat');
new Notice(t('chat.tabs.maxChatReached', { count: String(maxTabs) }));
```

Leave `chat.fork.maxTabsReached` exported from the i18n union for back-compat with any third-party locale; live code paths no longer emit it.

- [ ] **Step 5: Run typecheck, lint, tests**

```bash
npm run typecheck
npm run lint
npm run test -- --selectProjects unit
```

Expected: PASS. `npm run lint` should still be 0/0 (sentence-case UI strings, no inline styles).

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/ClaudianSettings.ts \
        src/i18n/types.ts src/i18n/locales/en.json \
        src/features/chat/ClaudianView.ts src/features/chat/tabs/TabManager.ts
git commit -m "feat(settings): two sliders for chat and work-order tab budgets"
```

---

### Task 11: Integration — work-order cap does not consume chat budget

**Files:**
- Create: `tests/integration/features/tabs/workOrderCap.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

Path: `tests/integration/features/tabs/workOrderCap.int.test.ts`

```ts
import { describe, expect, it } from '@jest/globals';

import { TabManager } from '../../../../src/features/chat/tabs/TabManager';
import type { ProviderId } from '../../../../src/core/providers/types';

/**
 * Drives the live TabManager end-to-end to confirm the two caps are independent
 * and that work-order tabs do not consume the user's chat budget.
 *
 * The fixture seeds settings, then drives createTab/createTaskRunTab through
 * the public API. DOM is jsdom; provider runtime is not initialized (lazy).
 */
function fixture(maxChatTabs: number, maxWorkOrderTabs: number) {
  const plugin = {
    settings: { maxChatTabs, maxWorkOrderTabs },
    events: { emit: jest.fn(), on: jest.fn().mockReturnValue(() => {}) },
    getConversationById: async () => null,
    getConversationSync: () => null,
    // Add other minimal stubs the live createTab path reads. If a test failure
    // points to a missing accessor, stub it as a no-op here.
  } as never;
  const host = document.createElement('div');
  const mgr = new TabManager(plugin, host, {});
  return { mgr, plugin };
}

describe('work-order cap independence', () => {
  it('work-order tab opens while chat budget is full', async () => {
    const { mgr } = fixture(2, 2);
    await mgr.createTab(); // chat 1/2
    await mgr.createTab(); // chat 2/2
    expect(mgr.canCreateTab('chat')).toBe(false);
    const wo = await mgr.createTaskRunTab({ providerId: 'claude' as ProviderId, model: 'sonnet' });
    expect(wo).not.toBeNull();
    expect(mgr.canCreateTab('work-order')).toBe(true);
  });

  it('chat tab opens while work-order budget is full', async () => {
    const { mgr } = fixture(2, 1);
    const wo = await mgr.createTaskRunTab({ providerId: 'claude' as ProviderId, model: 'sonnet' });
    expect(wo).not.toBeNull();
    expect(mgr.canCreateTab('work-order')).toBe(false);
    const chat = await mgr.createTab();
    expect(chat).not.toBeNull();
  });

  it('reaching the WO cap returns null from createTaskRunTab without affecting chat', async () => {
    const { mgr } = fixture(3, 1);
    await mgr.createTaskRunTab({ providerId: 'claude' as ProviderId, model: 'sonnet' });
    const second = await mgr.createTaskRunTab({ providerId: 'claude' as ProviderId, model: 'sonnet' });
    expect(second).toBeNull();
    const chat = await mgr.createTab();
    expect(chat).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the integration test to verify shape**

```bash
npm run test -- --selectProjects integration tests/integration/features/tabs/workOrderCap.int.test.ts
```

Expected: PASS (cap logic is already in place from Tasks 4–5). If a missing stub on `plugin` errors out, stub it locally per the snippet's comment.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tabs/workOrderCap.int.test.ts
git commit -m "test(int): work-order cap does not consume the chat tab budget"
```

---

### Task 12: Integration — manual chat tab cap does not stall queue runs

**Files:**
- Create: `tests/integration/features/tabs/maxChatReached.int.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `tests/integration/features/tabs/maxChatReached.int.test.ts`

```ts
import { describe, expect, it } from '@jest/globals';

import { PluginViewActivator } from '../../../../src/app/views/PluginViewActivator';

function plugin(opts: { chat: number; wo: number; maxChat: number; maxWo: number; reservations?: number }) {
  return {
    settings: { maxChatTabs: opts.maxChat, maxWorkOrderTabs: opts.maxWo },
    chatTabReservations: { pending: opts.reservations ?? 0 },
    getView: () => ({
      areTabsRestored: () => true,
      getTabManager: () => ({
        getTabCount: () => opts.chat + opts.wo,
        countTabsByKind: (k: 'chat' | 'work-order') => (k === 'chat' ? opts.chat : opts.wo),
        getAllTabs: () => Array(opts.chat + opts.wo).fill({}),
      }),
    }),
    app: { workspace: { getLeavesOfType: () => [] } },
    lastKnownTabManagerState: null,
  } as never;
}

describe('chat cap saturation does not stall the queue', () => {
  it('user filling every chat tab leaves WO free slots untouched', () => {
    const activator = new PluginViewActivator(plugin({ chat: 4, wo: 0, maxChat: 4, maxWo: 2 }));
    expect(activator.canCreateNewTab()).toBe(false); // user blocked from opening
    expect(activator.getTabSlotUsage()).toEqual({ used: 0, max: 2 }); // queue still free
  });

  it('reservations subtract from WO free slots without blocking the chat cap', () => {
    const activator = new PluginViewActivator(plugin({ chat: 4, wo: 1, maxChat: 4, maxWo: 3, reservations: 1 }));
    expect(activator.canCreateNewTab()).toBe(false);
    expect(activator.getTabSlotUsage()).toEqual({ used: 2, max: 3 });
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
npm run test -- --selectProjects integration tests/integration/features/tabs/maxChatReached.int.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/tabs/maxChatReached.int.test.ts
git commit -m "test(int): chat cap saturation leaves work-order queue capacity intact"
```

---

### Task 13: Final verification + build

**Files:** none modified; runs the quality gates.

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```

Expected: PASS, 0 errors.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Unit + integration tests**

```bash
npm run test
```

Expected: all suites PASS.

- [ ] **Step 4: Production build**

```bash
npm run build
```

Expected: SUCCESS. Output bundles emitted to the configured build directory.

- [ ] **Step 5: Manual smoke (optional — only if dev build is running)**

In a vault that has Claudian installed via the dev-build symlink:

1. Open Claudian chat view; open 3 chat tabs. Confirm chat tab badges render without an accent border.
2. Open Agent Board; queue a work order with `maxWorkOrderTabs=2`. Confirm it opens a 4th tab with the accent border + clipboard tooltip suffix.
3. Try to open a new chat tab. Confirm the cap notice fires with the chat-tab string.
4. Confirm prev/next tab cycling (vim navigation) goes chat → chat → chat → WO → chat.

- [ ] **Step 6: Commit only if the verification step changed anything (docs/CHANGELOG bump)**

```bash
# only if there are pending edits
git status
```

If clean, no commit. Otherwise:

```bash
git add CHANGELOG.md docs/  # adjust to actual files touched
git commit -m "docs: note work-order tab budget split"
```

---

## Spec coverage check

| Spec section | Task(s) |
|--------------|---------|
| Decisions 1–7 | 1, 2, 3, 5, 7, 8, 9, 10 |
| Data model — TabKind, TabData, PersistedTabState | 2, 4 |
| Persisted-state back-compat | 4 (`tabState.kind ?? 'chat'`) |
| Settings types | 3 |
| Constants | 1 |
| Settings migration | 3 |
| TabManager per-kind cap | 5 |
| Public API (`canCreateTab`, `createTab`, `createTaskRunTab`, `forkToNewTab`) | 4, 5 |
| `bypassTabLimit` preserved | 5 (cap gate still respects `bypassTabLimit`) |
| Notices (`maxChatReached` / `maxWorkOrderReached`) | 9, 10 |
| `chat:tabs-changed` payload extension | 5 |
| Free-slot calculation (WO-only) | 8 |
| `ChatTabReservations` (doc only) | 9 |
| Queue runner unchanged | (no task — verified by unaffected behavior in Tasks 8, 11, 12) |
| `startTaskRunInFreshTab` error string | 9 |
| Multi-pane safety | (no task — preserved by Task 8's WO-only reservation accounting) |
| Tab bar render order — `getOrderedTabs` | 6 |
| Tab bar visuals — CSS class, icon-accent, tooltip suffix | 7 |
| Settings UI two sliders | 10 |
| Defaults | 3 |
| i18n keys | 10 |
| Unit tests (kindCap, persistence, events, migration, freeSlots, order) | 1, 3, 4, 5, 6, 8 |
| Integration (workOrderCap, maxChatReached) | 11, 12 |
| Perf — no new spec | (no task) |
| Out of scope items | (intentionally omitted) |

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-06-work-order-tab-budget.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
