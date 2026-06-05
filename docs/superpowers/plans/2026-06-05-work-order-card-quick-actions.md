---
status: implemented
parent: "[[Agent Kanban Board]]"
spec: "[[docs/superpowers/specs/2026-06-05-work-order-card-quick-actions-design.md]]"
---

# Work-order card right-click quick actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click context menu to Agent Board work-order cards exposing Open note, Open conversation, vault quick-action favorites, and the Quick actions picker. Quick-action items are hidden while the work order is `running`; `needs_input` and `needs_approval` keep them.

**Architecture:** New pure helper `showWorkOrderContextMenu(task, event, deps)` under `src/features/tasks/ui/` builds an Obsidian `Menu`, reuses `runQuickActionForFile` and `openContextMenuQuickAction` from `features/quickActions/`, reads favorites synchronously from the existing `QuickActionFavoritesCache`, resolves the WO note via `vault.getAbstractFileByPath`. `AgentBoardRenderer` gains a single `onContextMenu` callback and binds `contextmenu` on the card element; `AgentBoardView` wires that callback to the helper. Left-click → detail modal stays unchanged.

**Tech Stack:** TypeScript, Obsidian Plugin API (`Menu`, `TFile`, `vault`), Jest + jsdom (`tests/unit/**`), Obsidian mocks under `tests/__mocks__/obsidian.ts`, project i18n system (`src/i18n/types.ts` + 10 locale JSON files), Conventional Commits.

**Spec:** `docs/superpowers/specs/2026-06-05-work-order-card-quick-actions-design.md`

---

## File Structure

**Created:**

| Path | Responsibility |
|------|----------------|
| `src/features/tasks/ui/workOrderContextMenu.ts` | Pure helper that builds and shows the WO card right-click menu. |
| `tests/unit/features/tasks/ui/workOrderContextMenu.test.ts` | Unit tests for menu items, gating, click wiring. |

**Modified:**

| Path | Change |
|------|--------|
| `src/i18n/types.ts` | Add `tasks.board.contextMenu.openNote` and `tasks.board.contextMenu.openConversation` to the `TranslationKey` union. |
| `src/i18n/locales/en.json` + 9 other locale files | Add the two new keys to each locale. |
| `src/features/tasks/ui/AgentBoardRenderer.ts` | Add `onContextMenu` to `AgentBoardRenderCallbacks`; bind `contextmenu` listener inside `renderCard`. |
| `src/features/tasks/ui/AgentBoardView.ts` | Pass `onContextMenu` callback that dispatches to `showWorkOrderContextMenu`. |
| `tests/__mocks__/obsidian.ts` | Add `addSeparator()` to the `Menu` mock so the helper test can assert separator placement. |
| `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts` | New `describe` block covering the `contextmenu` listener wiring and `preventDefault`. |

---

## Task 1: Add i18n keys for the new menu items

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`
- Modify: `src/i18n/locales/ja.json`
- Modify: `src/i18n/locales/ko.json`
- Modify: `src/i18n/locales/de.json`
- Modify: `src/i18n/locales/fr.json`
- Modify: `src/i18n/locales/es.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/pt.json`

- [ ] **Step 1: Confirm the existing `tasks.board.*` block exists**

Run: `grep -n "\"board\": {" src/i18n/locales/en.json`
Expected: a line near 629 showing the start of the `board` object inside `tasks`.

- [ ] **Step 2: Add the two new union members in `src/i18n/types.ts`**

Find the block:

```ts
  | 'tasks.board.laneSaveFailed'
```

Replace with:

```ts
  | 'tasks.board.laneSaveFailed'
  | 'tasks.board.contextMenu.openNote'
  | 'tasks.board.contextMenu.openConversation'
```

- [ ] **Step 3: Add the two keys to `src/i18n/locales/en.json`**

Inside the existing `"tasks"."board"` object, after the `"laneSaveFailed"` key, add:

```json
      "laneSaveFailed": "Could not save lane change: {error}",
      "contextMenu": {
        "openNote": "Open note",
        "openConversation": "Open conversation"
      }
```

Make sure the comma after `"laneSaveFailed"` is present and the closing brace count is unchanged.

- [ ] **Step 4: Mirror the addition into the 9 remaining locale files**

For each of `zh-CN.json`, `zh-TW.json`, `ja.json`, `ko.json`, `de.json`, `fr.json`, `es.json`, `ru.json`, `pt.json`, add a `contextMenu` block under `tasks.board` with these translations:

| Locale | openNote | openConversation |
|--------|----------|------------------|
| zh-CN | 打开笔记 | 打开会话 |
| zh-TW | 開啟筆記 | 開啟對話 |
| ja | ノートを開く | 会話を開く |
| ko | 노트 열기 | 대화 열기 |
| de | Notiz öffnen | Unterhaltung öffnen |
| fr | Ouvrir la note | Ouvrir la conversation |
| es | Abrir nota | Abrir conversación |
| ru | Открыть заметку | Открыть беседу |
| pt | Abrir nota | Abrir conversa |

- [ ] **Step 5: Run the locale parity test**

Run: `npm run test -- --selectProjects unit --testPathPattern "tests/unit/i18n/locales.test.ts"`
Expected: PASS. The parity test enforces that any key present in `en` exists in all other locales.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. The `TranslationKey` union now contains the two new literals.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/types.ts src/i18n/locales/
git commit -m "feat(i18n): add work-order card context-menu keys"
```

---

## Task 2: Extend the Obsidian `Menu` mock with `addSeparator`

**Files:**
- Modify: `tests/__mocks__/obsidian.ts`

The production code in Task 3 calls `menu.addSeparator()`. The current mock at `tests/__mocks__/obsidian.ts:566` does not implement it, so the helper test would crash on first invocation.

- [ ] **Step 1: Inspect the current `Menu` mock**

Run: `grep -n "class Menu" tests/__mocks__/obsidian.ts`
Expected: a single match near line 566.

- [ ] **Step 2: Add a separator sentinel and the `addSeparator` method**

Find the block:

```ts
export class Menu {
  static instances: Menu[] = [];

  items: MockMenuItem[] = [];
  showAtMouseEvent = jest.fn();

  constructor() {
    Menu.instances.push(this);
  }

  addItem(callback: (item: MockMenuItem) => MockMenuItem | void): this {
    const item = new MockMenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
}
```

Replace with:

```ts
export const MENU_SEPARATOR = Symbol('MenuSeparator');

export class Menu {
  static instances: Menu[] = [];

  items: Array<MockMenuItem | typeof MENU_SEPARATOR> = [];
  showAtMouseEvent = jest.fn();

  constructor() {
    Menu.instances.push(this);
  }

  addItem(callback: (item: MockMenuItem) => MockMenuItem | void): this {
    const item = new MockMenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }

  addSeparator(): this {
    this.items.push(MENU_SEPARATOR);
    return this;
  }
}
```

Tests in Task 3 import `MENU_SEPARATOR` from `'obsidian'` (their mock) to assert separator placement.

- [ ] **Step 3: Run the existing menu-touching test to confirm no regression**

Run: `npm run test -- --selectProjects unit --testPathPattern "tests/unit/app/commands/registerWorkspaceMenus.test.ts"`
Expected: PASS. This test ignores separators, so widening the `items` type is invisible to it.

- [ ] **Step 4: Commit**

```bash
git add tests/__mocks__/obsidian.ts
git commit -m "test(obsidian-mock): add addSeparator to Menu mock"
```

---

## Task 3: Implement `showWorkOrderContextMenu` helper (TDD)

**Files:**
- Create: `src/features/tasks/ui/workOrderContextMenu.ts`
- Create: `tests/unit/features/tasks/ui/workOrderContextMenu.test.ts`

The helper is a pure function. It owns Menu construction, favorites read, gating, picker dispatch, and `showAtMouseEvent`. View supplies plugin + conversation-gate callbacks.

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/features/tasks/ui/workOrderContextMenu.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { MENU_SEPARATOR, Menu, TFile } from 'obsidian';

import type { TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';
import { showWorkOrderContextMenu } from '@/features/tasks/ui/workOrderContextMenu';

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

const runQuickActionForFile = jest.fn().mockResolvedValue(undefined);
jest.mock('@/features/quickActions/runQuickActionForFile', () => ({
  runQuickActionForFile: (...args: unknown[]) => runQuickActionForFile(...args),
}));

const openContextMenuQuickAction = jest.fn();
jest.mock('@/features/quickActions/openContextMenuQuickAction', () => ({
  openContextMenuQuickAction: (...args: unknown[]) => openContextMenuQuickAction(...args),
}));

function makeTask(status: TaskStatus, conversationId?: string): TaskSpec {
  return {
    path: 'Agent Board/tasks/wo-1.md',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 'wo-1',
      title: 'WO 1',
      status,
      priority: '2 - normal',
      created: '2026-06-05T00:00:00Z',
      updated: '2026-06-05T00:00:00Z',
      attempts: 0,
      conversation_id: conversationId,
    },
    sections: {
      objective: '',
      acceptanceCriteria: '',
      context: '',
      constraints: '',
      ledger: '',
      handoff: '',
    },
    body: '',
    raw: '',
  };
}

function makePlugin(opts: {
  woFile?: TFile | null;
  favorites?: Array<{ id: string; name: string; prompt: string; icon?: string }>;
  hasFavoritesCache?: boolean;
}) {
  const woFile = opts.woFile === undefined
    ? Object.assign(Object.create(TFile.prototype), { path: 'Agent Board/tasks/wo-1.md' })
    : opts.woFile;
  const getAbstractFileByPath = jest.fn(() => woFile);
  const getFavorites = jest.fn(() => opts.favorites ?? []);
  return {
    app: { vault: { getAbstractFileByPath } },
    quickActionFavoritesCache: opts.hasFavoritesCache === false ? undefined : { getFavorites },
  };
}

function makeDeps(overrides: Partial<Parameters<typeof showWorkOrderContextMenu>[2]> = {}) {
  return {
    plugin: makePlugin({}) as unknown as Parameters<typeof showWorkOrderContextMenu>[2]['plugin'],
    onOpenNote: jest.fn(),
    onOpenConversation: jest.fn(),
    canOpenConversation: jest.fn(() => false),
    ...overrides,
  };
}

function titles(menu: Menu): string[] {
  return menu.items.map((entry) => {
    if (entry === MENU_SEPARATOR) return '<sep>';
    const calls = (entry.setTitle as jest.Mock).mock.calls;
    return calls.length > 0 ? String(calls[0][0]) : '';
  });
}

const mouseEvent = new MouseEvent('contextmenu');

beforeEach(() => {
  Menu.instances.length = 0;
  runQuickActionForFile.mockClear();
  openContextMenuQuickAction.mockClear();
});

describe('showWorkOrderContextMenu', () => {
  it('case 1: ready + conv + 2 favs + WO resolvable → full menu', () => {
    const task = makeTask('ready', 'conv-1');
    const plugin = makePlugin({
      favorites: [
        { id: 'a', name: 'Fav A', prompt: 'p1' },
        { id: 'b', name: 'Fav B', prompt: 'p2' },
      ],
    });
    const deps = makeDeps({
      plugin: plugin as never,
      canOpenConversation: jest.fn(() => true),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = Menu.instances[0];
    expect(titles(menu)).toEqual([
      'tasks.board.contextMenu.openNote',
      'tasks.board.contextMenu.openConversation',
      '<sep>',
      'Fav A',
      'Fav B',
      'quickActions.contextMenu.title',
    ]);
    expect(menu.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
  });

  it('case 2: ready, no conv, no favs, WO resolvable → Open note, sep, picker', () => {
    const task = makeTask('ready');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(Menu.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      '<sep>',
      'quickActions.contextMenu.title',
    ]);
  });

  it('case 3: running + conv + 3 favs → Open note + Open conversation only', () => {
    const task = makeTask('running', 'conv-1');
    const plugin = makePlugin({
      favorites: [
        { id: 'a', name: 'Fav A', prompt: 'p' },
        { id: 'b', name: 'Fav B', prompt: 'p' },
        { id: 'c', name: 'Fav C', prompt: 'p' },
      ],
    });
    const deps = makeDeps({
      plugin: plugin as never,
      canOpenConversation: jest.fn(() => true),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(Menu.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'tasks.board.contextMenu.openConversation',
    ]);
  });

  it('case 4: running, no conv → Open note only', () => {
    const task = makeTask('running');
    const plugin = makePlugin({ favorites: [{ id: 'a', name: 'A', prompt: 'p' }] });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(Menu.instances[0])).toEqual(['tasks.board.contextMenu.openNote']);
  });

  it('case 5: needs_input, no conv, 2 favs, WO resolvable → favs + picker shown', () => {
    const task = makeTask('needs_input');
    const plugin = makePlugin({
      favorites: [
        { id: 'a', name: 'Fav A', prompt: 'p' },
        { id: 'b', name: 'Fav B', prompt: 'p' },
      ],
    });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(Menu.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      '<sep>',
      'Fav A',
      'Fav B',
      'quickActions.contextMenu.title',
    ]);
  });

  it('case 6: needs_approval, no conv, 1 fav, WO resolvable → favs + picker shown', () => {
    const task = makeTask('needs_approval');
    const plugin = makePlugin({ favorites: [{ id: 'a', name: 'Fav A', prompt: 'p' }] });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(Menu.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      '<sep>',
      'Fav A',
      'quickActions.contextMenu.title',
    ]);
  });

  it('case 7: WO TFile unresolvable, ready, conv exists → Open note + Open conversation only', () => {
    const task = makeTask('ready', 'conv-1');
    const plugin = makePlugin({ woFile: null, favorites: [{ id: 'a', name: 'A', prompt: 'p' }] });
    const deps = makeDeps({
      plugin: plugin as never,
      canOpenConversation: jest.fn(() => true),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(Menu.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'tasks.board.contextMenu.openConversation',
    ]);
  });

  it('case 8: quickActionFavoritesCache undefined, ready, WO resolvable → Open note, sep, picker', () => {
    const task = makeTask('ready');
    const plugin = makePlugin({ hasFavoritesCache: false });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(Menu.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      '<sep>',
      'quickActions.contextMenu.title',
    ]);
  });

  it('case 9: conversation_id present but canOpenConversation false → Open conversation hidden', () => {
    const task = makeTask('ready', 'conv-1');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({
      plugin: plugin as never,
      canOpenConversation: jest.fn(() => false),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(Menu.instances[0])).not.toContain('tasks.board.contextMenu.openConversation');
    expect(deps.canOpenConversation).toHaveBeenCalledWith(task);
  });

  it('case 10: clicking a favorite invokes runQuickActionForFile with plugin + WO TFile + fav', () => {
    const task = makeTask('ready');
    const fav = { id: 'a', name: 'Fav A', prompt: 'p' };
    const woFile = Object.assign(Object.create(TFile.prototype), { path: 'Agent Board/tasks/wo-1.md' });
    const plugin = makePlugin({ favorites: [fav], woFile });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = Menu.instances[0];
    // index 0 = Open note, index 1 = separator, index 2 = Fav A
    const favItem = menu.items[2] as { clickHandler?: () => void };
    favItem.clickHandler?.();

    expect(runQuickActionForFile).toHaveBeenCalledWith(plugin, woFile, fav);
  });

  it('case 11: clicking the picker entry invokes openContextMenuQuickAction with plugin + WO TFile', () => {
    const task = makeTask('ready');
    const woFile = Object.assign(Object.create(TFile.prototype), { path: 'Agent Board/tasks/wo-1.md' });
    const plugin = makePlugin({ favorites: [], woFile });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = Menu.instances[0];
    // index 0 = Open note, index 1 = separator, index 2 = picker
    const pickerItem = menu.items[2] as { clickHandler?: () => void };
    pickerItem.clickHandler?.();

    expect(openContextMenuQuickAction).toHaveBeenCalledWith(plugin, woFile);
  });

  it('case 12: showAtMouseEvent is called exactly once at the end', () => {
    const task = makeTask('ready');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = Menu.instances[0];
    expect(menu.showAtMouseEvent).toHaveBeenCalledTimes(1);
    expect(menu.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails because the module does not exist**

Run: `npm run test -- --selectProjects unit --testPathPattern "tests/unit/features/tasks/ui/workOrderContextMenu.test.ts"`
Expected: FAIL with a module-not-found error for `@/features/tasks/ui/workOrderContextMenu`.

- [ ] **Step 3: Create the helper implementation**

Create `src/features/tasks/ui/workOrderContextMenu.ts`:

```ts
import { Menu, TFile } from 'obsidian';

import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
import { runQuickActionForFile } from '@/features/quickActions/runQuickActionForFile';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import type { TaskSpec } from '../model/taskTypes';

export interface WorkOrderContextMenuDeps {
  plugin: ClaudianPlugin;
  onOpenNote: (task: TaskSpec) => void;
  onOpenConversation: (task: TaskSpec) => void;
  canOpenConversation: (task: TaskSpec) => boolean;
}

/**
 * Build and show the right-click context menu for a work-order card on the
 * Agent Board.
 *
 * Always shows: Open note. Shows Open conversation only when the caller's
 * `canOpenConversation` gate returns true (mirrors the WorkOrderDetailModal
 * gate so we don't list broken navigation).
 *
 * Quick-action items (favorites + picker) are hidden when:
 *   - status === 'running' (avoid surprise side-prompts on an active run), OR
 *   - the work-order note path no longer resolves to a TFile (deleted/moved).
 *
 * Favorites come from the plugin-lifetime `QuickActionFavoritesCache`. Click
 * handlers delegate to `runQuickActionForFile` / `openContextMenuQuickAction`
 * with the WO note as the file argument so the existing tab-routing and pill
 * attach flow is reused unchanged.
 */
export function showWorkOrderContextMenu(
  task: TaskSpec,
  event: MouseEvent,
  deps: WorkOrderContextMenuDeps,
): void {
  const { plugin, onOpenNote, onOpenConversation, canOpenConversation } = deps;
  const menu = new Menu();

  menu.addItem((i) => i
    .setTitle(t('tasks.board.contextMenu.openNote'))
    .setIcon('file-text')
    .onClick(() => onOpenNote(task)));

  if (canOpenConversation(task)) {
    menu.addItem((i) => i
      .setTitle(t('tasks.board.contextMenu.openConversation'))
      .setIcon('messages-square')
      .onClick(() => onOpenConversation(task)));
  }

  const isRunning = task.frontmatter.status === 'running';
  const abstract = plugin.app.vault.getAbstractFileByPath(task.path);
  const woTFile = abstract instanceof TFile ? abstract : null;
  const canPromptOn = !isRunning && woTFile !== null;

  if (canPromptOn) {
    const favs = plugin.quickActionFavoritesCache?.getFavorites() ?? [];
    menu.addSeparator();
    for (const fav of favs) {
      menu.addItem((i) => i
        .setTitle(fav.name)
        .setIcon(fav.icon ?? 'star')
        .onClick(() => { void runQuickActionForFile(plugin, woTFile, fav); }));
    }
    menu.addItem((i) => i
      .setTitle(t('quickActions.contextMenu.title'))
      .setIcon('zap')
      .onClick(() => openContextMenuQuickAction(plugin, woTFile)));
  }

  menu.showAtMouseEvent(event);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern "tests/unit/features/tasks/ui/workOrderContextMenu.test.ts"`
Expected: PASS — all 12 cases green.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/ui/workOrderContextMenu.ts tests/unit/features/tasks/ui/workOrderContextMenu.test.ts
git commit -m "feat(tasks): add WO card right-click menu helper"
```

---

## Task 4: Add `onContextMenu` callback + bind listener on `AgentBoardRenderer`

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardRenderer.ts`
- Modify: `tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts`

- [ ] **Step 1: Add the failing test block to `AgentBoardRenderer.test.ts`**

Append at the end of the file:

```ts
function findFirstCard(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.claudian-agent-board-card') as HTMLElement | null;
}

describe('AgentBoardRenderer — contextmenu listener', () => {
  function makeCallbacksWithCtxMenu() {
    return { ...makeCallbacks(), onContextMenu: jest.fn() };
  }

  it('invokes onContextMenu with the task and the event when a card is right-clicked', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacksWithCtxMenu();
    const task = makeTask('r', 'ready');
    const state = makeState({ ready: [task] });

    renderer.render(host, state, callbacks);

    const card = findFirstCard(host);
    expect(card).not.toBeNull();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    card!.dispatchEvent(event);

    expect(callbacks.onContextMenu).toHaveBeenCalledTimes(1);
    expect(callbacks.onContextMenu).toHaveBeenCalledWith(task, event);
  });

  it('calls preventDefault on the contextmenu event', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacksWithCtxMenu();
    const state = makeState({ ready: [makeTask('r', 'ready')] });

    renderer.render(host, state, callbacks);

    const card = findFirstCard(host);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefault = jest.spyOn(event, 'preventDefault');
    card!.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
  });

  it('left-click still invokes onOpenDetail (additive contextmenu does not break click)', () => {
    const renderer = new AgentBoardRenderer();
    const host = document.createElement('div');
    const callbacks = makeCallbacksWithCtxMenu();
    const task = makeTask('r', 'ready');
    const state = makeState({ ready: [task] });

    renderer.render(host, state, callbacks);

    findFirstCard(host)!.click();

    expect(callbacks.onOpenDetail).toHaveBeenCalledWith(task);
    expect(callbacks.onContextMenu).not.toHaveBeenCalled();
  });
});
```

Update the existing `makeCallbacks()` helper (near the top of the file) to satisfy the wider `AgentBoardRenderCallbacks` type:

```ts
function makeCallbacks(): AgentBoardRenderCallbacks {
  return {
    onOpenDetail: jest.fn(),
    onRun: jest.fn(),
    onStop: jest.fn(),
    onAccept: jest.fn(),
    onRework: jest.fn(),
    onMarkReady: jest.fn(),
    onAddWorkOrder: jest.fn(),
    onRunNextReady: jest.fn(),
    onReopen: jest.fn(),
    onContextMenu: jest.fn(),
  };
}
```

- [ ] **Step 2: Run the renderer tests and confirm they fail**

Run: `npm run test -- --selectProjects unit --testPathPattern "tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts"`
Expected: FAIL — TypeScript complains that `AgentBoardRenderCallbacks` is missing `onContextMenu`, or the new tests fail because no `contextmenu` listener fires.

- [ ] **Step 3: Add `onContextMenu` to the callback interface**

In `src/features/tasks/ui/AgentBoardRenderer.ts`, find:

```ts
export interface AgentBoardRenderCallbacks {
  onOpenDetail(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onReopen(task: TaskSpec): void;
  onAddWorkOrder(): void;
  onRunNextReady(): void;
}
```

Replace with:

```ts
export interface AgentBoardRenderCallbacks {
  onOpenDetail(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onReopen(task: TaskSpec): void;
  onAddWorkOrder(): void;
  onRunNextReady(): void;
  onContextMenu(task: TaskSpec, event: MouseEvent): void;
}
```

- [ ] **Step 4: Bind the `contextmenu` listener inside `renderCard`**

In the same file, find the existing click binding inside `renderCard`:

```ts
    card.addEventListener('click', () => callbacks.onOpenDetail(task));
```

Add immediately after it:

```ts
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      callbacks.onContextMenu(task, event);
    });
```

- [ ] **Step 5: Run the renderer tests and confirm they pass**

Run: `npm run test -- --selectProjects unit --testPathPattern "tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts"`
Expected: PASS — original cases plus the three new ones.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL once because `AgentBoardView` does not yet pass `onContextMenu`. Note the error message; Task 5 fixes it. (If your harness blocks on typecheck failure here, skip Step 6 and run typecheck at the end of Task 5 instead.)

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/ui/AgentBoardRenderer.ts tests/unit/features/tasks/ui/AgentBoardRenderer.test.ts
git commit -m "feat(tasks): bind contextmenu listener on WO cards"
```

---

## Task 5: Wire `AgentBoardView` to dispatch through `showWorkOrderContextMenu`

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [ ] **Step 1: Add the helper import**

In `src/features/tasks/ui/AgentBoardView.ts`, find the existing imports block ending with:

```ts
import { AgentBoardRenderer } from './AgentBoardRenderer';
import { createWorkOrderInteractive } from './createWorkOrderInteractive';
import { WorkOrderDetailModal, type WorkOrderFieldUpdate } from './WorkOrderDetailModal';
```

Replace with:

```ts
import { AgentBoardRenderer } from './AgentBoardRenderer';
import { createWorkOrderInteractive } from './createWorkOrderInteractive';
import { WorkOrderDetailModal, type WorkOrderFieldUpdate } from './WorkOrderDetailModal';
import { showWorkOrderContextMenu } from './workOrderContextMenu';
```

- [ ] **Step 2: Pass the `onContextMenu` callback into the renderer**

In the same file, find the callbacks bag inside `this.renderer.render(...)`:

```ts
      {
        onOpenDetail: (task) => this.openDetail(task),
        onRun: (task) => void this.runTask(task),
        onStop: (task) => this.stopTask(task),
        onAccept: (task) => void this.transitionTask(task, 'done', 'Accepted from review.'),
        onRework: (task) => void this.reworkTask(task),
        onMarkReady: (task) => void this.transitionTask(task, 'ready', 'Marked ready.'),
        onReopen: (task) => void this.transitionTask(task, 'inbox', 'Reopened.'),
        onAddWorkOrder: () => void this.addWorkOrderFromBoard(),
        onRunNextReady: () => void this.runNextReady(),
      },
```

Replace with:

```ts
      {
        onOpenDetail: (task) => this.openDetail(task),
        onRun: (task) => void this.runTask(task),
        onStop: (task) => this.stopTask(task),
        onAccept: (task) => void this.transitionTask(task, 'done', 'Accepted from review.'),
        onRework: (task) => void this.reworkTask(task),
        onMarkReady: (task) => void this.transitionTask(task, 'ready', 'Marked ready.'),
        onReopen: (task) => void this.transitionTask(task, 'inbox', 'Reopened.'),
        onAddWorkOrder: () => void this.addWorkOrderFromBoard(),
        onRunNextReady: () => void this.runNextReady(),
        onContextMenu: (task, event) => showWorkOrderContextMenu(task, event, {
          plugin: this.plugin,
          onOpenNote: (target) => void this.openTask(target),
          onOpenConversation: (target) => {
            const conversationId = target.frontmatter.conversation_id;
            if (conversationId) void this.plugin.openConversation(conversationId);
          },
          canOpenConversation: (target) => {
            const conversationId = target.frontmatter.conversation_id;
            return Boolean(conversationId && this.plugin.getConversationSync(conversationId));
          },
        }),
      },
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — `AgentBoardRenderCallbacks` is now fully satisfied.

- [ ] **Step 4: Run the full unit suite for the tasks feature slice**

Run: `npm run test -- --selectProjects unit --testPathPattern "tests/unit/features/tasks/"`
Expected: PASS for all task-feature unit tests, including the existing `AgentBoardView` integration if any.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat(tasks): wire WO board to right-click context menu"
```

---

## Task 6: Final verification (typecheck + lint + full test + build)

**Files:** none.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors / 0 warnings. Per the `claudian-lint-clean` memory the project keeps lint at 0/0.

- [ ] **Step 3: Run the full unit test suite**

Run: `npm run test -- --selectProjects unit`
Expected: PASS.

- [ ] **Step 4: Run the integration suite**

Run: `npm run test -- --selectProjects integration`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS — production bundle emitted.

- [ ] **Step 6: Manual smoke test in the cursor fork build**

Per the `claudian-dev-build-setup` memory, the build step copies into the linked Obsidian plugin folder. Open the linked vault, reload the plugin, and:

1. Open the Agent Board view.
2. Right-click a card whose status is `inbox`, `ready`, `review`, `needs_fix`, `done`, `failed`, or `canceled`.
   - Verify: Open note, optional Open conversation, separator, favorites (if any), Quick actions…
3. Right-click a card whose status is `running`.
   - Verify: Open note + optional Open conversation only. No favorites, no picker.
4. Right-click a card whose status is `needs_input` or `needs_approval`.
   - Verify: full menu (favorites + picker shown).
5. Pick a favorite from a non-running card.
   - Verify: a chat tab opens, the WO note appears as a pill, the favorite's prompt fires.
6. Pick "Quick actions…" from a non-running card.
   - Verify: the picker modal opens; selecting an action attaches the WO note as a pill in the target tab.
7. Click "Open note".
   - Verify: the WO markdown opens in a new tab.
8. Click "Open conversation" (only visible when the WO has an active session).
   - Verify: the bound conversation opens in the chat sidebar.

- [ ] **Step 7: Final commit (only if any cleanup edits were needed)**

If the smoke test surfaced a bug fix, follow normal commit hygiene:

```bash
git add <fixed paths>
git commit -m "fix(tasks): <short summary>"
```

Otherwise no commit needed for verification.

---

## Self-Review

Ran against the spec:

1. **Spec coverage** — every spec requirement is implemented by a task:
   - Menu architecture & module boundaries → Task 3 (helper) + Task 4 (callback) + Task 5 (wiring).
   - Menu contents table → Task 3 production code + test cases 1–9.
   - Gating rules (running, needs_input/needs_approval, WO unresolvable, no favorites, conv gate) → Task 3 test cases 3, 4, 5, 6, 7, 8, 9.
   - Wiring code sketch (renderer + view) → Task 4 + Task 5.
   - i18n keys → Task 1.
   - Tests table (`workOrderContextMenu.test.ts` 12 cases + `AgentBoardRenderer.test.ts` augment) → Task 3 + Task 4.

2. **Placeholder scan** — none. Every step has either runnable commands or full code blocks.

3. **Type consistency** — `AgentBoardRenderCallbacks.onContextMenu(task: TaskSpec, event: MouseEvent): void` is the same shape used in renderer binding, view wiring, and renderer tests. `showWorkOrderContextMenu(task, event, deps)` signature matches its test imports and its view callsite. `WorkOrderContextMenuDeps` shape (`plugin`, `onOpenNote`, `onOpenConversation`, `canOpenConversation`) is identical across helper, test `makeDeps`, and view dispatch.
