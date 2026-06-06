---
title: Archive Action in Work-Order Context Menu Implementation Plan
date: 2026-06-06
status: done
scope: features/tasks
spec: "[[docs/superpowers/specs/2026-06-06-archive-action-context-menu-design.md]]"
parent: "[[Agent Kanban Board]]"
---

> Shipped by [[Agent Board/tasks/work-order-20260606-archive-action-context-menu]] (pending manual smoke).

# Archive Action in Work-Order Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Archive" item to the work-order right-click context menu, visible only when the card is in a terminal status (`done`, `failed`, `canceled`), that triggers the existing `AgentBoardView.archiveTask` flow.

**Architecture:** Purely additive UI surface. `WorkOrderContextMenuDeps` gains an `onArchive` callback; `showWorkOrderContextMenu` appends a separator + Archive item gated by a `ARCHIVABLE_STATUSES` set. `AgentBoardView`'s `onContextMenu` factory passes `onArchive: (target) => void this.archiveTask(target)` — `archiveTask` already exists. New i18n key in all 10 locales.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest, JSDOM. No new runtime deps.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/features/tasks/ui/WorkOrderContextMenu.ts` | Add `onArchive` to deps; render gated Archive item | Modify |
| `src/features/tasks/ui/AgentBoardView.ts` | Wire `onArchive` into the context-menu deps factory | Modify |
| `src/i18n/locales/en.json` | New translation key | Modify |
| `src/i18n/locales/de.json` | New translation key | Modify |
| `src/i18n/locales/es.json` | New translation key | Modify |
| `src/i18n/locales/fr.json` | New translation key | Modify |
| `src/i18n/locales/ja.json` | New translation key | Modify |
| `src/i18n/locales/ko.json` | New translation key | Modify |
| `src/i18n/locales/pt.json` | New translation key | Modify |
| `src/i18n/locales/ru.json` | New translation key | Modify |
| `src/i18n/locales/zh-CN.json` | New translation key | Modify |
| `src/i18n/locales/zh-TW.json` | New translation key | Modify |
| `tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts` | Cover Archive visibility + click for all relevant statuses | Modify |

---

## Task 1: Add i18n key in all 10 locales

**Files:**
- Modify: `src/i18n/locales/{en,de,es,fr,ja,ko,pt,ru,zh-CN,zh-TW}.json`

- [x] **Step 1: Add `archive` to `tasks.board.contextMenu` in `en.json`**

In `src/i18n/locales/en.json`, find the `"contextMenu"` block under `"tasks.board"` (search `"openNote": "Open note"`). Replace this block:

```json
      "contextMenu": {
        "openNote": "Open note",
        "openConversation": "Open conversation"
      }
```

with:

```json
      "contextMenu": {
        "openNote": "Open note",
        "openConversation": "Open conversation",
        "archive": "Archive"
      }
```

- [x] **Step 2: Apply the same shape change to the other 9 locales**

For each of `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`, locate the matching `tasks.board.contextMenu` block and add an `archive` key. Use these values verbatim:

| File | Value |
|------|-------|
| `de.json` | `"Archivieren"` |
| `es.json` | `"Archivar"` |
| `fr.json` | `"Archiver"` |
| `ja.json` | `"アーカイブ"` |
| `ko.json` | `"보관"` |
| `pt.json` | `"Arquivar"` |
| `ru.json` | `"В архив"` |
| `zh-CN.json` | `"归档"` |
| `zh-TW.json` | `"封存"` |

Each file's edit looks like the `en.json` edit above — append `"archive": "<value>"` after `"openConversation"`, with a comma after `"openConversation"`.

- [x] **Step 3: Verify all 10 files parse**

Run: `npm run typecheck`
Expected: PASS. (Locale JSON is loaded with `JSON.parse`; a malformed file would surface at runtime, but typecheck still catches any TS-side breakage. If you want a stricter early check, also run: `node -e "for (const f of ['en','de','es','fr','ja','ko','pt','ru','zh-CN','zh-TW']) JSON.parse(require('fs').readFileSync('src/i18n/locales/'+f+'.json','utf8'))"` — must exit 0.)

- [x] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/de.json src/i18n/locales/es.json src/i18n/locales/fr.json src/i18n/locales/ja.json src/i18n/locales/ko.json src/i18n/locales/pt.json src/i18n/locales/ru.json src/i18n/locales/zh-CN.json src/i18n/locales/zh-TW.json
git commit -m "feat(i18n): add tasks.board.contextMenu.archive translations"
```

---

## Task 2: Add `onArchive` deps field + Archive menu item (TDD)

**Files:**
- Modify: `src/features/tasks/ui/WorkOrderContextMenu.ts`
- Test: `tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts`

- [x] **Step 1: Extend the `makeDeps` factory in the test file**

In `tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts`, find `function makeDeps(overrides...)` and replace it with:

```ts
function makeDeps(overrides: Partial<DepsArgs> = {}): DepsArgs {
  return {
    plugin: makePlugin({}),
    onOpenNote: jest.fn(),
    onOpenConversation: jest.fn(),
    canOpenConversation: jest.fn(() => false),
    onArchive: jest.fn(),
    ...overrides,
  };
}
```

- [x] **Step 2: Write the failing tests**

Append to `tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts` inside the existing `describe('showWorkOrderContextMenu', ...)`:

```ts
it('case 16: status done → Archive item appended with separator', () => {
  const task = makeTask('done');
  const plugin = makePlugin({ favorites: [] });
  const deps = makeDeps({ plugin });

  showWorkOrderContextMenu(task, mouseEvent, deps);

  expect(titles(MenuMock.instances[0])).toEqual([
    'tasks.board.contextMenu.openNote',
    '<sep>',
    'quickActions.contextMenu.title',
    '<sep>',
    'tasks.board.contextMenu.archive',
  ]);
});

it('case 17: status failed → Archive item appended', () => {
  const task = makeTask('failed');
  const plugin = makePlugin({ favorites: [] });
  const deps = makeDeps({ plugin });

  showWorkOrderContextMenu(task, mouseEvent, deps);

  expect(titles(MenuMock.instances[0])).toContain('tasks.board.contextMenu.archive');
});

it('case 18: status canceled → Archive item appended', () => {
  const task = makeTask('canceled');
  const plugin = makePlugin({ favorites: [] });
  const deps = makeDeps({ plugin });

  showWorkOrderContextMenu(task, mouseEvent, deps);

  expect(titles(MenuMock.instances[0])).toContain('tasks.board.contextMenu.archive');
});

it('case 19: status running → Archive item absent', () => {
  const task = makeTask('running');
  const plugin = makePlugin({ favorites: [] });
  const deps = makeDeps({ plugin });

  showWorkOrderContextMenu(task, mouseEvent, deps);

  expect(titles(MenuMock.instances[0])).not.toContain('tasks.board.contextMenu.archive');
});

it('case 20: status ready → Archive item absent', () => {
  const task = makeTask('ready');
  const plugin = makePlugin({ favorites: [] });
  const deps = makeDeps({ plugin });

  showWorkOrderContextMenu(task, mouseEvent, deps);

  expect(titles(MenuMock.instances[0])).not.toContain('tasks.board.contextMenu.archive');
});

it('case 21: status inbox → Archive item absent', () => {
  const task = makeTask('inbox');
  const plugin = makePlugin({ favorites: [] });
  const deps = makeDeps({ plugin });

  showWorkOrderContextMenu(task, mouseEvent, deps);

  expect(titles(MenuMock.instances[0])).not.toContain('tasks.board.contextMenu.archive');
});

it('case 22: clicking Archive invokes onArchive(task)', () => {
  const task = makeTask('done');
  const plugin = makePlugin({ favorites: [] });
  const deps = makeDeps({ plugin });

  showWorkOrderContextMenu(task, mouseEvent, deps);

  const menu = MenuMock.instances[0];
  // index 0 = Open note, 1 = <sep>, 2 = picker, 3 = <sep>, 4 = Archive
  const archiveItem = menu.items[4] as { clickHandler?: () => void };
  archiveItem.clickHandler?.();

  expect(deps.onArchive).toHaveBeenCalledTimes(1);
  expect(deps.onArchive).toHaveBeenCalledWith(task);
});
```

- [x] **Step 3: Run tests to verify they fail**

Run: `npm run test -- tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts`
Expected: FAIL — case 16 / 17 / 18 / 22 expect an `archive` item that the menu does not produce yet. Case 19 / 20 / 21 may already pass because there is no archive item rendered at all; that is fine.

- [x] **Step 4: Add `onArchive` to the deps interface**

In `src/features/tasks/ui/WorkOrderContextMenu.ts`, replace the `WorkOrderContextMenuDeps` interface with:

```ts
export interface WorkOrderContextMenuDeps {
  plugin: ClaudianPlugin;
  onOpenNote: (task: TaskSpec) => void;
  onOpenConversation: (task: TaskSpec) => void;
  /**
   * Returns true when Open conversation should be visible. The composed gate
   * (`conversation_id` present AND `getConversationSync(id)` resolves) lives in
   * `buildWorkOrderConversationBindings` so both this menu and the
   * `WorkOrderDetailModal` share one source of truth.
   */
  canOpenConversation: (task: TaskSpec) => boolean;
  /** Invoked when the user clicks Archive on a terminal-status card. */
  onArchive: (task: TaskSpec) => void;
}
```

- [x] **Step 5: Render the gated Archive item**

In `src/features/tasks/ui/WorkOrderContextMenu.ts`, find the destructure inside `showWorkOrderContextMenu`:

```ts
const { plugin, onOpenNote, onOpenConversation, canOpenConversation } = deps;
```

Replace with:

```ts
const { plugin, onOpenNote, onOpenConversation, canOpenConversation, onArchive } = deps;
```

Then, at the top of the file (below the existing imports), add:

```ts
const ARCHIVABLE_STATUSES: ReadonlySet<TaskSpec['frontmatter']['status']> = new Set([
  'done',
  'failed',
  'canceled',
]);
```

Finally, replace the trailing `menu.showAtMouseEvent(event);` block at the bottom of `showWorkOrderContextMenu` with:

```ts
  if (ARCHIVABLE_STATUSES.has(task.frontmatter.status)) {
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t('tasks.board.contextMenu.archive'))
      .setIcon('archive')
      .onClick(() => onArchive(task)));
  }

  menu.showAtMouseEvent(event);
```

The Archive block sits AFTER the quick-actions block and BEFORE the final `showAtMouseEvent` call. The separator is inside the gate so non-terminal cards never end with a trailing divider.

- [x] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts`
Expected: PASS. If case 16's title ordering does not match, double-check that the gate runs AFTER `appendQuickActionFavoritesAndPicker` — the expected order is Open note → sep → picker → sep → Archive.

- [x] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL with one error: `AgentBoardView`'s `showWorkOrderContextMenu` call site does not supply `onArchive`. Task 3 fixes it. Do not commit yet — Task 3 will.

- [x] **Step 8: Commit (just the surface + tests)**

```bash
git add src/features/tasks/ui/WorkOrderContextMenu.ts tests/unit/features/tasks/ui/WorkOrderContextMenu.test.ts
git commit -m "feat(tasks): add Archive item to work-order context menu"
```

Note: typecheck is intentionally still broken at this point. Task 3 closes the loop.

---

## Task 3: Wire `onArchive` in `AgentBoardView`

**Files:**
- Modify: `src/features/tasks/ui/AgentBoardView.ts`

- [x] **Step 1: Add `onArchive` to the context-menu deps factory**

In `src/features/tasks/ui/AgentBoardView.ts`, find the existing `onContextMenu` handler (search for `showWorkOrderContextMenu(task, event,`). Replace this block:

```ts
        onContextMenu: (task, event) => showWorkOrderContextMenu(task, event, {
          plugin: this.plugin,
          onOpenNote: (target) => void this.openTask(target),
          ...buildWorkOrderConversationBindings(this.plugin),
        }),
```

with:

```ts
        onContextMenu: (task, event) => showWorkOrderContextMenu(task, event, {
          plugin: this.plugin,
          onOpenNote: (target) => void this.openTask(target),
          ...buildWorkOrderConversationBindings(this.plugin),
          onArchive: (target) => void this.archiveTask(target),
        }),
```

`archiveTask` is already defined on the class (search `private async archiveTask`). No additional changes required.

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 3: Run all task unit tests**

Run: `npm run test -- tests/unit/features/tasks`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/features/tasks/ui/AgentBoardView.ts
git commit -m "feat(tasks): wire Archive context-menu action through AgentBoardView"
```

---

## Task 4: Full verification

- [x] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 problems.

- [x] **Step 3: Unit + integration tests**

Run: `npm run test`
Expected: PASS.

- [x] **Step 4: Production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

In the dev vault: reload the plugin → open Agent Board → right-click a `done` work-order card → verify "Archive" sits at the bottom with a separator before it → click → confirm modal appears → confirm → card moves into archive folder and disappears from the board. Repeat for a `failed` card and a `canceled` card. Right-click a `ready` or `running` card → verify Archive is NOT present.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|--------------|------------|
| `WorkOrderContextMenuDeps.onArchive` field | Task 2 Step 4 |
| `ARCHIVABLE_STATUSES` gate (`done`, `failed`, `canceled`) | Task 2 Step 5 |
| Archive item with `archive` icon at bottom, separator before | Task 2 Step 5 |
| Reuse `t('tasks.board.contextMenu.archive')` | Task 1 + Task 2 Step 5 |
| `AgentBoardView` wires `onArchive` → `archiveTask` | Task 3 Step 1 |
| i18n in all 10 locales | Task 1 |
| Unit tests for visibility and click | Task 2 Step 2 |

**Placeholder scan:** No TBDs / "implement later". Code blocks complete. Status set is concrete. Each locale value is given verbatim. Click-handler test asserts the exact menu index (commented inline).

**Type consistency:** `onArchive: (task: TaskSpec) => void` is identical at the interface (Task 2 Step 4), the test factory (Task 2 Step 1), and the wire-up site (Task 3 Step 1). The i18n key `tasks.board.contextMenu.archive` matches across locales (Task 1), tests (Task 2 Step 2), and menu render (Task 2 Step 5). `ARCHIVABLE_STATUSES` is the only literal set — declared once, referenced once.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-archive-action-context-menu.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batch with checkpoints.

Which approach?
