---
title: Collapsible Agent Board Lanes Implementation Plan
date: 2026-06-06
status: open
scope: features/tasks
spec: "[[docs/superpowers/specs/2026-06-06-collapsible-agent-board-lanes-design.md]]"
parent: "[[Agent Kanban Board]]"
---

# Collapsible Agent Board Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark any Agent Board lane as collapsible in the lane editor, then collapse it to a narrow vertical strip (rotated title + count badge) by clicking a chevron in the lane header; click the strip to expand. Collapsed state persists across sessions.

**Architecture:** Two new boolean flags on `BoardLaneConfig` — `collapsible` (config-time, set in lane editor) and `collapsed` (runtime user toggle, persisted). `BoardConfigStore` gains a pure `writeLaneCollapsed` helper mirroring `writeBoardQueuePaused`. `resolveBoardLayout` passes both flags through to `ResolvedLane`. `AgentBoardRenderer.renderLane` branches: collapsed lanes render a click-through strip; expanded lanes render normally with a chevron in the header when collapsible. `AgentBoardView` wires the new `onToggleLaneCollapse(laneId)` callback to a store write + re-render. Lane editor adds a "Collapsible" toggle; un-checking forces `collapsed = false`. Cards moving into collapsed lanes only bump the count — no auto-expand.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest, JSDOM. No new runtime deps.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/features/tasks/config/boardConfigTypes.ts` | Add `collapsible`/`collapsed` to `BoardLaneConfig` and `ResolvedLane`; update `DEFAULT_BOARD_CONFIG` | Modify |
| `src/features/tasks/config/BoardConfigStore.ts` | Inject defaults in `normalizeLane`; add `writeLaneCollapsed`; clear `collapsed` when `collapsible` flips off | Modify |
| `src/features/tasks/config/resolveBoardLayout.ts` | Pass new flags through to `ResolvedLane` | Modify |
| `src/features/tasks/ui/AgentBoardRenderer.ts` | Branch `renderLane` on collapsed state; chevron button; new callback | Modify |
| `src/features/tasks/ui/AgentBoardView.ts` | Wire `onToggleLaneCollapse` to store + re-render | Modify |
| `src/features/tasks/ui/AgentBoardLaneEditor.ts` | "Collapsible" toggle per lane | Modify |
| `src/style/features/agent-board.css` | Collapsed strip + chevron styling | Modify |
| `tests/unit/features/tasks/config/BoardConfigStore.test.ts` | Cover `writeLaneCollapsed` + migration | Modify |
| `tests/unit/features/tasks/config/resolveBoardLayout.test.ts` | Cover flag pass-through | Modify |
| `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts` | Cover strip, chevron, click handlers | Modify |
| `tests/unit/features/tasks/ui/AgentBoardLaneEditor.test.ts` | Cover Collapsible toggle + clearing rule | Modify |

---

## Task 1: Add `collapsible`/`collapsed` to lane config types

**Files:**
- Modify: `src/features/tasks/config/boardConfigTypes.ts`

- [ ] **Step 1: Update `BoardLaneConfig` and `ResolvedLane` interfaces**

Replace the existing `BoardLaneConfig` and `ResolvedLane` interfaces with:

```ts
export interface BoardLaneConfig {
  id: string;
  title: string;
  statuses: TaskStatus[];
  visible: boolean;
  definitionOfReady: string[];
  definitionOfDone: string[];
  collapsible: boolean;
  collapsed: boolean;
}

export interface ResolvedLane {
  id: string;
  title: string;
  tasks: TaskSpec[];
  definitionOfReady: string[];
  definitionOfDone: string[];
  isCatchAll: boolean;
  collapsible: boolean;
  collapsed: boolean;
}
```

- [ ] **Step 2: Update `DEFAULT_BOARD_CONFIG` factory to include new flags**

In the same file, find the `TASK_STATUSES.map((status) => freezeLane({ ... }))` block and add the two new fields with `false` defaults:

```ts
freezeLane({
  id: status,
  title: DEFAULT_LANE_TITLES[status],
  statuses: [status],
  visible: true,
  definitionOfReady: [],
  definitionOfDone: [],
  collapsible: false,
  collapsed: false,
}),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). If errors appear in other files referencing `BoardLaneConfig`/`ResolvedLane`, do NOT fix them here — later tasks will. If errors appear inside `boardConfigTypes.ts` itself, fix and re-run.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/config/boardConfigTypes.ts
git commit -m "feat(tasks): add collapsible/collapsed flags to lane config types"
```

---

## Task 2: Migrate legacy configs in `normalizeLane`

**Files:**
- Modify: `src/features/tasks/config/BoardConfigStore.ts`
- Test: `tests/unit/features/tasks/config/BoardConfigStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/features/tasks/config/BoardConfigStore.test.ts` inside the existing `describe('loadBoardConfig', ...)`:

```ts
it('injects collapsible/collapsed defaults for legacy lanes', () => {
  const agentBoardConfig = {
    schemaVersion: 1,
    lanes: [{ id: 'a', title: 'A', statuses: ['ready'] }],
  };
  const { config } = loadBoardConfig({ agentBoardConfig });
  expect(config.lanes[0].collapsible).toBe(false);
  expect(config.lanes[0].collapsed).toBe(false);
});

it('preserves explicit collapsible/collapsed values', () => {
  const agentBoardConfig = {
    schemaVersion: 1,
    lanes: [
      { id: 'a', title: 'A', statuses: ['ready'], collapsible: true, collapsed: true },
    ],
  };
  const { config } = loadBoardConfig({ agentBoardConfig });
  expect(config.lanes[0].collapsible).toBe(true);
  expect(config.lanes[0].collapsed).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/config/BoardConfigStore.test.ts`
Expected: FAIL — `config.lanes[0].collapsible` is `undefined`.

- [ ] **Step 3: Update `normalizeLane` to read and default both flags**

In `src/features/tasks/config/BoardConfigStore.ts`, find the `return { id, title, statuses, visible, definitionOfReady, definitionOfDone };` block at the end of `normalizeLane` and replace it with:

```ts
return {
  id,
  title,
  statuses,
  visible: lane.visible === undefined ? true : Boolean(lane.visible),
  definitionOfReady: toStringList(lane.definitionOfReady),
  definitionOfDone: toStringList(lane.definitionOfDone),
  collapsible: Boolean(lane.collapsible),
  collapsed: Boolean(lane.collapsible) && Boolean(lane.collapsed),
};
```

Note: `collapsed` is gated by `collapsible` to defend against an orphan state on disk (e.g. a user un-checked Collapsible while the file said `collapsed: true`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/tasks/config/BoardConfigStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS (the type errors from Task 1 should now resolve for this file).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/config/BoardConfigStore.ts tests/unit/features/tasks/config/BoardConfigStore.test.ts
git commit -m "feat(tasks): migrate legacy lane configs to include collapsible/collapsed"
```

---

## Task 3: Add `writeLaneCollapsed` helper

**Files:**
- Modify: `src/features/tasks/config/BoardConfigStore.ts`
- Test: `tests/unit/features/tasks/config/BoardConfigStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `tests/unit/features/tasks/config/BoardConfigStore.test.ts`:

```ts
import {
  getLaneForStatus,
  loadBoardConfig,
  writeBoardQueuePaused,
  writeLaneCollapsed,
} from '../../../../../src/features/tasks/config/BoardConfigStore';

describe('writeLaneCollapsed', () => {
  it('sets collapsed=true on the target lane only', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: {
        schemaVersion: 1,
        lanes: [
          { id: 'a', title: 'A', statuses: ['ready'], collapsible: true, collapsed: false },
          { id: 'b', title: 'B', statuses: ['running'], collapsible: true, collapsed: false },
        ],
      },
    };
    writeLaneCollapsed(settings, 'a', true);
    const stored = (settings.agentBoardConfig as { lanes: Array<{ id: string; collapsed: boolean }> }).lanes;
    expect(stored.find((lane) => lane.id === 'a')?.collapsed).toBe(true);
    expect(stored.find((lane) => lane.id === 'b')?.collapsed).toBe(false);
  });

  it('is a no-op for an unknown lane id', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: {
        schemaVersion: 1,
        lanes: [{ id: 'a', title: 'A', statuses: ['ready'], collapsible: true, collapsed: false }],
      },
    };
    const before = JSON.stringify(settings.agentBoardConfig);
    writeLaneCollapsed(settings, 'ghost', true);
    expect(JSON.stringify(settings.agentBoardConfig)).toBe(before);
  });

  it('refuses to collapse a non-collapsible lane', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: {
        schemaVersion: 1,
        lanes: [{ id: 'a', title: 'A', statuses: ['ready'], collapsible: false, collapsed: false }],
      },
    };
    writeLaneCollapsed(settings, 'a', true);
    const stored = (settings.agentBoardConfig as { lanes: Array<{ id: string; collapsed: boolean }> }).lanes;
    expect(stored[0].collapsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/config/BoardConfigStore.test.ts`
Expected: FAIL — `writeLaneCollapsed` is not exported.

- [ ] **Step 3: Add `writeLaneCollapsed` to `BoardConfigStore.ts`**

At the bottom of `src/features/tasks/config/BoardConfigStore.ts`, append:

```ts
// Persists a per-lane collapsed flag through the same mutation path used by
// `writeBoardQueuePaused`. Defensive guards: an unknown lane id is a no-op
// (defends against stale UI state after a reorder/delete from another pane);
// a non-collapsible lane refuses to collapse so toggling Collapsible OFF in the
// editor cannot leave an orphan collapsed strip on the board.
export function writeLaneCollapsed(
  settings: Record<string, unknown>,
  laneId: string,
  collapsed: boolean,
): void {
  const existing = settings.agentBoardConfig;
  if (!existing || typeof existing !== 'object') return;
  const base = { ...(existing as Record<string, unknown>) };
  const lanesRaw = base.lanes;
  if (!Array.isArray(lanesRaw)) return;
  const next = lanesRaw.map((laneRaw) => {
    if (!laneRaw || typeof laneRaw !== 'object') return laneRaw;
    const lane = laneRaw as Record<string, unknown>;
    if (lane.id !== laneId) return lane;
    if (!Boolean(lane.collapsible)) return lane;
    return { ...lane, collapsed };
  });
  base.lanes = next;
  settings.agentBoardConfig = base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/tasks/config/BoardConfigStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/config/BoardConfigStore.ts tests/unit/features/tasks/config/BoardConfigStore.test.ts
git commit -m "feat(tasks): add writeLaneCollapsed store helper"
```

---

## Task 4: Pass flags through `resolveBoardLayout`

**Files:**
- Modify: `src/features/tasks/config/resolveBoardLayout.ts`
- Test: `tests/unit/features/tasks/config/resolveBoardLayout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/features/tasks/config/resolveBoardLayout.test.ts`:

```ts
it('passes collapsible/collapsed through to resolved lanes', () => {
  const config = {
    schemaVersion: 1 as const,
    lanes: [
      {
        id: 'a',
        title: 'A',
        statuses: ['ready'] as const,
        visible: true,
        definitionOfReady: [],
        definitionOfDone: [],
        collapsible: true,
        collapsed: true,
      },
    ],
  };
  const layout = resolveBoardLayout(config, { tasks: [], invalidNotes: [] });
  expect(layout.lanes[0].collapsible).toBe(true);
  expect(layout.lanes[0].collapsed).toBe(true);
});

it('defaults catch-all lane to non-collapsible', () => {
  const config = {
    schemaVersion: 1 as const,
    lanes: [
      {
        id: 'a',
        title: 'A',
        statuses: [] as const,
        visible: true,
        definitionOfReady: [],
        definitionOfDone: [],
        collapsible: false,
        collapsed: false,
      },
    ],
  };
  const layout = resolveBoardLayout(config, {
    tasks: [{ frontmatter: { status: 'running' } } as never],
    invalidNotes: [],
  });
  const catchAll = layout.lanes.find((lane) => lane.isCatchAll);
  expect(catchAll?.collapsible).toBe(false);
  expect(catchAll?.collapsed).toBe(false);
});
```

(Adjust the existing imports in the test file as needed — `resolveBoardLayout` and types should already be imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/config/resolveBoardLayout.test.ts`
Expected: FAIL — `collapsible` is `undefined` on the resolved lane.

- [ ] **Step 3: Update `resolveBoardLayout` to thread flags**

In `src/features/tasks/config/resolveBoardLayout.ts`, replace the inner `ordered` map and the `catchAll` literal with:

```ts
const ordered: ResolvedLane[] = visibleLanes.map((lane) => {
  const resolved: ResolvedLane = {
    id: lane.id,
    title: lane.title,
    tasks: [],
    definitionOfReady: lane.definitionOfReady,
    definitionOfDone: lane.definitionOfDone,
    isCatchAll: false,
    collapsible: lane.collapsible,
    collapsed: lane.collapsible && lane.collapsed,
  };
  buckets.set(lane.id, resolved);
  return resolved;
});

// …unchanged findLane / for-of loop…

const catchAll: ResolvedLane = {
  id: CATCH_ALL_ID,
  title: CATCH_ALL_TITLE,
  tasks: [],
  definitionOfReady: [],
  definitionOfDone: [],
  isCatchAll: true,
  collapsible: false,
  collapsed: false,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/tasks/config/resolveBoardLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/config/resolveBoardLayout.ts tests/unit/features/tasks/config/resolveBoardLayout.test.ts
git commit -m "feat(tasks): pass collapsible/collapsed through resolveBoardLayout"
```

---

## Task 5: Add collapse callback and render branches

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Test: `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`:

```ts
describe('AgentBoardRenderer collapsed lanes', () => {
  function makeCollapsibleLayout(collapsed: boolean) {
    return {
      layout: {
        lanes: [
          {
            id: 'done',
            title: 'Done',
            tasks: [{ frontmatter: { id: 't1', title: 'T', status: 'done', priority: '2 - normal' }, sections: { acceptanceCriteria: '' } } as never],
            definitionOfReady: [],
            definitionOfDone: [],
            isCatchAll: false,
            collapsible: true,
            collapsed,
          },
        ],
        errors: [],
      },
      invalidNotes: [],
      slots: { used: 0, max: 1 },
    };
  }

  function noopCallbacks() {
    return {
      onOpenDetail: jest.fn(),
      onRun: jest.fn(),
      onStop: jest.fn(),
      onAccept: jest.fn(),
      onRework: jest.fn(),
      onMarkReady: jest.fn(),
      onReopen: jest.fn(),
      onMoveToInbox: jest.fn(),
      onAddWorkOrder: jest.fn(),
      onRunNextReady: jest.fn(),
      onContextMenu: jest.fn(),
      onToggleLaneCollapse: jest.fn(),
    };
  }

  it('renders a chevron button on expanded collapsible lanes', () => {
    const renderer = new AgentBoardRenderer();
    const container = document.createElement('div');
    const callbacks = noopCallbacks();
    renderer.render(container, makeCollapsibleLayout(false), callbacks);
    const chevron = container.querySelector('.claudian-agent-board-lane-collapse-toggle') as HTMLButtonElement | null;
    expect(chevron).not.toBeNull();
    chevron?.click();
    expect(callbacks.onToggleLaneCollapse).toHaveBeenCalledWith('done');
  });

  it('renders a strip with rotated title and count when collapsed; click expands', () => {
    const renderer = new AgentBoardRenderer();
    const container = document.createElement('div');
    const callbacks = noopCallbacks();
    renderer.render(container, makeCollapsibleLayout(true), callbacks);
    const strip = container.querySelector('.claudian-agent-board-lane--collapsed') as HTMLElement | null;
    expect(strip).not.toBeNull();
    expect(container.querySelector('.claudian-agent-board-card')).toBeNull();
    const titleVertical = strip?.querySelector('.claudian-agent-board-lane-title-vertical');
    expect(titleVertical?.textContent).toBe('Done');
    const count = strip?.querySelector('.claudian-agent-board-lane-count');
    expect(count?.textContent).toBe('1');
    strip?.click();
    expect(callbacks.onToggleLaneCollapse).toHaveBeenCalledWith('done');
  });

  it('omits chevron on non-collapsible lanes', () => {
    const renderer = new AgentBoardRenderer();
    const container = document.createElement('div');
    const layout = makeCollapsibleLayout(false);
    layout.layout.lanes[0].collapsible = false;
    renderer.render(container, layout, noopCallbacks());
    expect(container.querySelector('.claudian-agent-board-lane-collapse-toggle')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`
Expected: FAIL — `onToggleLaneCollapse` not in callbacks type; chevron + strip classes not in DOM.

- [ ] **Step 3: Add the callback to the interface**

In `src/features/tasks/ui/AgentBoardRenderer.ts`, find `AgentBoardRenderCallbacks` and append:

```ts
  onToggleLaneCollapse(laneId: string): void;
```

- [ ] **Step 4: Branch `renderLane` on collapsed state**

In `src/features/tasks/ui/AgentBoardRenderer.ts`, replace the existing `private renderLane(...)` method with:

```ts
private renderLane(parent: HTMLElement, lane: ResolvedLane, callbacks: AgentBoardRenderCallbacks): void {
  if (lane.collapsible && lane.collapsed) {
    this.renderCollapsedLane(parent, lane, callbacks);
    return;
  }

  const laneEl = parent.createDiv({ cls: 'claudian-agent-board-lane' });
  const head = laneEl.createDiv({ cls: 'claudian-agent-board-lane-header' });
  head.createSpan({ text: lane.title });
  head.createSpan({ cls: 'claudian-agent-board-lane-count', text: String(lane.tasks.length) });
  if (lane.collapsible) {
    const toggle = head.createEl('button', {
      cls: 'claudian-agent-board-lane-collapse-toggle',
      text: '›',
    });
    toggle.setAttribute('aria-label', 'Collapse lane');
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.onToggleLaneCollapse(lane.id);
    });
  }

  if (lane.definitionOfReady.length > 0 || lane.definitionOfDone.length > 0) {
    this.renderCriteria(laneEl, lane);
  }

  for (const task of lane.tasks) {
    this.renderCard(laneEl, task, callbacks);
  }
}

private renderCollapsedLane(
  parent: HTMLElement,
  lane: ResolvedLane,
  callbacks: AgentBoardRenderCallbacks,
): void {
  const strip = parent.createDiv({
    cls: 'claudian-agent-board-lane claudian-agent-board-lane--collapsed',
  });
  strip.setAttribute('role', 'button');
  strip.setAttribute('aria-label', `Expand lane ${lane.title}`);
  strip.setAttribute('aria-expanded', 'false');
  strip.createSpan({
    cls: 'claudian-agent-board-lane-title-vertical',
    text: lane.title,
  });
  strip.createSpan({
    cls: 'claudian-agent-board-lane-count',
    text: String(lane.tasks.length),
  });
  strip.addEventListener('click', () => callbacks.onToggleLaneCollapse(lane.id));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL with one error: `AgentBoardView` does not implement `onToggleLaneCollapse` on its callbacks object. Task 6 fixes this. Continue without committing yet.

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/ui/AgentBoardRenderer.ts tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts
git commit -m "feat(tasks): render collapsed lane strip and chevron toggle"
```

---

## Task 6: Wire the collapse handler in `AgentBoardView`

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [ ] **Step 1: Import the new store helper**

In `src/features/tasks/ui/AgentBoardView.ts`, find the existing import line:

```ts
import { getLaneForStatus, loadBoardConfig, writeBoardQueuePaused } from '../config/BoardConfigStore';
```

Replace it with:

```ts
import {
  getLaneForStatus,
  loadBoardConfig,
  writeBoardQueuePaused,
  writeLaneCollapsed,
} from '../config/BoardConfigStore';
```

- [ ] **Step 2: Add the handler method**

In the same file, find the existing private method that writes queue paused (search for `writeBoardQueuePaused(`). Right after it, add a new private method on the class:

```ts
private async handleToggleLaneCollapse(laneId: string): Promise<void> {
  const settings = asSettingsBag(this.plugin.settings);
  const lane = this.config.lanes.find((candidate) => candidate.id === laneId);
  if (!lane || !lane.collapsible) return;
  writeLaneCollapsed(settings, laneId, !lane.collapsed);
  await this.plugin.saveSettings();
  this.config = loadBoardConfig(settings).config;
  this.layout = resolveBoardLayout(this.config, this.model);
  this.scheduleRefresh();
}
```

Note: the existing class already calls `loadBoardConfig` and `resolveBoardLayout` after queue toggles — if a private helper such as `reloadConfig()` exists, call it instead of repeating those two lines. Search the file for `loadBoardConfig(settings)` to confirm; if a helper exists, your method becomes:

```ts
private async handleToggleLaneCollapse(laneId: string): Promise<void> {
  const settings = asSettingsBag(this.plugin.settings);
  const lane = this.config.lanes.find((candidate) => candidate.id === laneId);
  if (!lane || !lane.collapsible) return;
  writeLaneCollapsed(settings, laneId, !lane.collapsed);
  await this.plugin.saveSettings();
  this.reloadConfigAndRefresh(); // or whatever the existing method is named
}
```

- [ ] **Step 3: Wire the callback into the renderer call**

Search the file for the existing call to `this.renderer.render(`. The callbacks object passed in already lists every existing handler (`onRun`, `onStop`, etc.). Add a new entry:

```ts
onToggleLaneCollapse: (laneId) => {
  void this.handleToggleLaneCollapse(laneId);
},
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run all task tests**

Run: `npm run test -- tests/unit/features/tasks`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat(tasks): wire collapse toggle through AgentBoardView"
```

---

## Task 7: Add Collapsible toggle to lane editor

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardLaneEditor.ts`
- Test: `tests/unit/features/tasks/ui/AgentBoardLaneEditor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/features/tasks/ui/AgentBoardLaneEditor.test.ts` (reuse existing imports and test helpers; if the file uses a `renderEditor`/setup pattern, follow it):

```ts
describe('AgentBoardLaneEditor collapsible toggle', () => {
  it('enables collapsible and clears collapsed when collapsible is turned off', async () => {
    const { container, plugin } = setupEditor({
      lanes: [
        {
          id: 'a',
          title: 'A',
          statuses: ['ready'],
          visible: true,
          definitionOfReady: [],
          definitionOfDone: [],
          collapsible: true,
          collapsed: true,
        },
      ],
    });
    // Find the toggle by data-focus-key matching the lane.
    const toggle = container.querySelector<HTMLInputElement>(
      '[data-focus-key="lane:a:collapsible"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(true);
    toggle!.checked = false;
    toggle!.dispatchEvent(new Event('change'));
    await flushPromises();
    const saved = plugin.settings.agentBoardConfig as { lanes: Array<{ id: string; collapsible: boolean; collapsed: boolean }> };
    const stored = saved.lanes.find((lane) => lane.id === 'a');
    expect(stored?.collapsible).toBe(false);
    expect(stored?.collapsed).toBe(false);
  });
});
```

If the test file does not already define `setupEditor` and `flushPromises`, copy the test setup patterns from the existing `AgentBoardLaneEditor.test.ts` describe blocks (this file already exercises the editor, so a setup helper exists — reuse it verbatim).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/features/tasks/ui/AgentBoardLaneEditor.test.ts`
Expected: FAIL — no element with `data-focus-key="lane:a:collapsible"`.

- [ ] **Step 3: Add the Collapsible toggle UI**

In `src/features/tasks/ui/AgentBoardLaneEditor.ts`, find the block where `head.addToggle((toggle) => toggle.setValue(lane.visible)...)` is called (the "visible" toggle inside `renderLaneBlock`). Right after that `head.addToggle` block, add a second toggle:

```ts
head.addToggle((toggle) => {
  toggle
    .setTooltip('Collapsible — show a chevron in the header to collapse this lane.')
    .setValue(lane.collapsible)
    .onChange(async (value) => {
      const snapshot = cloneConfig(config);
      lane.collapsible = value;
      // Defensive: turning Collapsible OFF must clear any leftover collapsed
      // state so the board cannot keep a non-collapsible lane in the
      // collapsed strip variant.
      if (!value) lane.collapsed = false;
      const ok = await persist(snapshot);
      if (ok) rerender();
    });
  toggle.toggleEl.dataset.focusKey = `lane:${lane.id}:collapsible`;
});
```

Note: Obsidian's `ToggleComponent` exposes `toggleEl` (the underlying `<div>` wrapping the input). If the test instead queries the `<input>` element, change the data attribute to point at the actual `<input>` via `toggle.toggleEl.querySelector('input')`. Check `AgentBoardLaneEditor.test.ts` for how the existing `visible` toggle is found, and use the same selector strategy for consistency.

- [ ] **Step 4: Update the "Add lane" default to include the new flags**

In the same file, find the `Add lane` button handler and update the pushed object to:

```ts
config.lanes.push({
  id: newId,
  title: 'New lane',
  statuses: [],
  visible: true,
  definitionOfReady: [],
  definitionOfDone: [],
  collapsible: false,
  collapsed: false,
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- tests/unit/features/tasks/ui/AgentBoardLaneEditor.test.ts`
Expected: PASS. If the selector for the toggle does not match, adjust the `data-focus-key` placement (Step 3) until it does, then re-run.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/ui/AgentBoardLaneEditor.ts tests/unit/features/tasks/ui/AgentBoardLaneEditor.test.ts
git commit -m "feat(tasks): add Collapsible toggle to lane editor"
```

---

## Task 8: Add CSS for collapsed strip and chevron

**Files:**
- Modify: `src/style/features/agent-board.css`

- [ ] **Step 1: Append the new rules**

At the end of `src/style/features/agent-board.css`, append:

```css
.claudian-agent-board-lane--collapsed {
  min-width: 36px;
  max-width: 36px;
  padding: 8px 4px;
  cursor: pointer;
  align-items: center;
}

.claudian-agent-board-lane--collapsed .claudian-agent-board-lane-title-vertical {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-weight: var(--font-semibold);
  color: var(--text-normal);
  white-space: nowrap;
}

.claudian-agent-board-lane--collapsed .claudian-agent-board-lane-count {
  margin-top: 8px;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--background-modifier-border);
}

.claudian-agent-board-lane-collapse-toggle {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
  font-size: var(--font-ui-medium);
  line-height: 1;
}

.claudian-agent-board-lane-collapse-toggle:hover {
  color: var(--text-normal);
}
```

- [ ] **Step 2: Build CSS to verify the import wires up**

Run: `npm run build`
Expected: PASS. `styles.css` at the repo root is regenerated and includes the new selectors. (No new `@import` is needed because `agent-board.css` is already registered in `src/style/index.css`.)

- [ ] **Step 3: Commit**

```bash
git add src/style/features/agent-board.css styles.css
git commit -m "feat(tasks): style collapsed lane strip and chevron toggle"
```

---

## Task 9: Full verification

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 problems.

- [ ] **Step 3: Unit + integration tests**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual smoke (optional)**

Reload the plugin in the dev vault. Open Agent Board → settings → mark a lane Collapsible → click the chevron in that lane's header → confirm the strip renders with rotated title and count → click the strip → confirm it expands. Restart Obsidian and confirm the collapsed state persisted.

- [ ] **Step 6: Final commit (only if any drift was found and fixed)**

```bash
git add -A
git commit -m "chore(tasks): post-verification cleanup"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|--------------|------------|
| Data model (`collapsible`/`collapsed` on lane + resolved) | Task 1, Task 4 |
| Storage migration | Task 2 |
| `writeLaneCollapsed` helper | Task 3 |
| `onToggleLaneCollapse` callback + view handler | Task 5 (declare), Task 6 (wire) |
| Rendering — strip variant + chevron | Task 5 |
| Lane editor Collapsible toggle + clearing rule | Task 7 |
| Styling (strip, rotated title, chevron) | Task 8 |
| Accessibility (`role="button"`, `aria-expanded`, `aria-label`) | Task 5 |
| Silent count bump on card arrival | Implicit — Task 5 leaves the live-patch paths untouched, full re-render bumps the count. Verified manually in Task 9. |
| Unit tests for store, resolver, renderer, editor | Tasks 2, 3, 4, 5, 7 |

**Placeholder scan:** No "TBD" / "implement later" / unspecified test bodies. All code blocks are concrete. The single conditional in Task 6 ("if a `reloadConfigAndRefresh` helper exists, call it") is explicit and bounded.

**Type consistency:** `collapsible: boolean` and `collapsed: boolean` are used identically on `BoardLaneConfig` (Task 1) and `ResolvedLane` (Task 1, threaded in Task 4). Callback name `onToggleLaneCollapse(laneId: string): void` is identical at declaration (Task 5), test (Task 5), and wire-up (Task 6). Class names `claudian-agent-board-lane--collapsed`, `claudian-agent-board-lane-title-vertical`, `claudian-agent-board-lane-collapse-toggle` match across renderer (Task 5), tests (Task 5), and CSS (Task 8).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-collapsible-agent-board-lanes.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batch with checkpoints.

Which approach?
