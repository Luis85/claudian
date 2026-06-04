---
status: done
---
# Quick Action Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface up to five star-marked quick actions as direct items in the vault right-click `file-menu` and `folder-menu`, above the existing "Quick action…" entry.

**Architecture:** Favorite state lives in each quick-action's YAML frontmatter (`favorite: true`, `favoriteRank: 1..5`); the file is the canonical store. A new `QuickActionFavoritesCache` subscribes to vault events on `quickActionsFolder` so the synchronous `file-menu` callback can read the sorted favorites without awaiting. The existing modal `onRun` flow is extracted into a shared `runQuickActionForFile` helper reused by both the modal callback and the new menu items.

**Tech Stack:** TypeScript, Obsidian Plugin API (`TFile`, `TFolder`, `Menu`, `Vault` events), Jest with Obsidian mocks under `tests/unit/**`, project i18n system (`src/i18n/types.ts` + 10 JSON locale files), Conventional Commits style.

**Spec:** `docs/superpowers/specs/2026-06-04-quick-action-favorites-design.md`

---

## File Structure

**Created:**

| Path | Responsibility |
|------|----------------|
| `src/features/quickActions/QuickActionFavoritesCache.ts` | Synchronous read-only favorites list backed by vault create/modify/delete/rename events on `quickActionsFolder`. |
| `src/features/quickActions/runQuickActionForFile.ts` | Pure flow: open or reuse a chat tab, attach the right-clicked file or folder as a pill, send the action's prompt. Shared by modal and menu. |
| `tests/unit/features/quickActions/QuickActionFavoritesCache.test.ts` | Unit tests for the cache. |
| `tests/unit/features/quickActions/runQuickActionForFile.test.ts` | Unit tests for the extracted run helper. |
| `tests/unit/features/quickActions/QuickActionStorage.favorites.test.ts` | Tests for `assignNextFavoriteRank`, `setFavorite`, `unsetFavorite`. |
| `tests/unit/features/quickActions/QuickActionsModal.favorites.test.ts` | Tests for the star button, sort, and limit notice. |
| `tests/unit/utils/frontmatter.extractNumber.test.ts` | Tests for the new `extractNumber` helper. |

**Modified:**

| Path | Change |
|------|--------|
| `src/utils/frontmatter.ts` | Add `extractNumber` helper. |
| `src/features/quickActions/types.ts` | Extend `QuickAction` and `QuickActionFrontmatter` with `favorite?: boolean`, `favoriteRank?: number`. |
| `src/features/quickActions/quickActionParse.ts` | Parse and serialize the new fields. |
| `src/features/quickActions/QuickActionStorage.ts` | Add `assignNextFavoriteRank`, `setFavorite`, `unsetFavorite`. |
| `src/features/quickActions/openContextMenuQuickAction.ts` | Delegate the `onRun` body to `runQuickActionForFile`. |
| `src/features/quickActions/ui/QuickActionsModal.ts` | Star button per row, favorites group sorted by rank at top, limit notice. |
| `src/app/commands/registerWorkspaceMenus.ts` | Inject favorite menu items above the existing "Quick action…" entry, via the cache. |
| `src/main.ts` | Construct `QuickActionFavoritesCache` after plugin load, dispose at unload. |
| `src/i18n/types.ts` | Add new key literals. |
| `src/i18n/locales/en.json` + 9 other locale JSON files | Add the new keys to all 10 locales (the `locales.test.ts` parity test enforces this). |
| `tests/unit/features/quickActions/quickActionParse.test.ts` | Add round-trip cases for the new fields. |
| `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts` | Adjust mock surface for the extracted helper (re-export delegation). |
| `tests/unit/app/commands/registerWorkspaceMenus.test.ts` | Cover favorites injection (with cache) and zero-favorites fallback. |
| `tests/integration/main.test.ts` | Smoke: cache constructed at load, disposed at unload. |

---

## Task 1: Add `extractNumber` frontmatter helper

**Files:**
- Modify: `src/utils/frontmatter.ts`
- Test: `tests/unit/utils/frontmatter.extractNumber.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/utils/frontmatter.extractNumber.test.ts`:

```ts
import { extractNumber } from '@/utils/frontmatter';

describe('extractNumber', () => {
  it('returns the number for a numeric value', () => {
    expect(extractNumber({ rank: 3 }, 'rank')).toBe(3);
  });

  it('returns the number for a numeric string', () => {
    expect(extractNumber({ rank: '4' }, 'rank')).toBe(4);
  });

  it('returns undefined for missing key', () => {
    expect(extractNumber({}, 'rank')).toBeUndefined();
  });

  it('returns undefined for non-numeric string', () => {
    expect(extractNumber({ rank: 'high' }, 'rank')).toBeUndefined();
  });

  it('returns undefined for boolean', () => {
    expect(extractNumber({ rank: true }, 'rank')).toBeUndefined();
  });

  it('returns undefined for null and array', () => {
    expect(extractNumber({ rank: null }, 'rank')).toBeUndefined();
    expect(extractNumber({ rank: [1, 2] }, 'rank')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern frontmatter.extractNumber`
Expected: FAIL with `extractNumber is not exported` (or `not a function`).

- [ ] **Step 3: Add the helper**

In `src/utils/frontmatter.ts`, add this export below `extractBoolean`:

```ts
export function extractNumber(
  fm: Record<string, unknown>,
  key: string
): number | undefined {
  const val = fm[key];
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern frontmatter.extractNumber`
Expected: PASS (6 assertions).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/frontmatter.ts tests/unit/utils/frontmatter.extractNumber.test.ts
git commit -m "feat(utils): add extractNumber frontmatter helper"
```

---

## Task 2: Extend types and round-trip favorite frontmatter fields

**Files:**
- Modify: `src/features/quickActions/types.ts`
- Modify: `src/features/quickActions/quickActionParse.ts`
- Test: `tests/unit/features/quickActions/quickActionParse.test.ts`

- [ ] **Step 1: Write failing parse-side test**

Append to `tests/unit/features/quickActions/quickActionParse.test.ts`:

```ts
import { QUICK_ACTION_FRONTMATTER_TYPE } from '@/features/quickActions/types';

describe('quickActionParse favorites', () => {
  it('parses favorite and favoriteRank', () => {
    const content = `---
type: ${QUICK_ACTION_FRONTMATTER_TYPE}
name: Refactor
favorite: true
favoriteRank: 2
---

Body.
`;
    const action = parseQuickActionContent(content, 'Quick Actions/refactor.md');
    expect(action?.favorite).toBe(true);
    expect(action?.favoriteRank).toBe(2);
  });

  it('treats favorite=false as not a favorite', () => {
    const content = `---
type: ${QUICK_ACTION_FRONTMATTER_TYPE}
name: Plain
favorite: false
---

Body.
`;
    const action = parseQuickActionContent(content, 'Quick Actions/plain.md');
    expect(action?.favorite).toBeUndefined();
    expect(action?.favoriteRank).toBeUndefined();
  });

  it('ignores favoriteRank outside 1..5', () => {
    const content = `---
type: ${QUICK_ACTION_FRONTMATTER_TYPE}
name: Bad rank
favorite: true
favoriteRank: 9
---

Body.
`;
    const action = parseQuickActionContent(content, 'Quick Actions/bad.md');
    expect(action?.favorite).toBe(true);
    expect(action?.favoriteRank).toBeUndefined();
  });

  it('serializes favorite and favoriteRank only when favorite is true', () => {
    const serialized = serializeQuickAction({
      name: 'Star',
      prompt: 'Body.',
      favorite: true,
      favoriteRank: 3,
    });
    expect(serialized).toContain('favorite: true');
    expect(serialized).toContain('favoriteRank: 3');
  });

  it('omits favorite lines when favorite is false or absent', () => {
    const serialized = serializeQuickAction({
      name: 'Plain',
      prompt: 'Body.',
      favorite: false,
      favoriteRank: 3,
    });
    expect(serialized).not.toContain('favorite:');
    expect(serialized).not.toContain('favoriteRank:');
  });

  it('round-trips favorite and favoriteRank', () => {
    const serialized = serializeQuickAction({
      name: 'Round',
      prompt: 'Body.',
      favorite: true,
      favoriteRank: 4,
    });
    const parsed = parseQuickActionContent(serialized, 'Quick Actions/round.md');
    expect(parsed?.favorite).toBe(true);
    expect(parsed?.favoriteRank).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern quickActionParse`
Expected: FAIL — type does not include `favorite`, serialize does not handle it.

- [ ] **Step 3: Extend the types**

Replace the bodies of `QuickAction` and `QuickActionFrontmatter` in `src/features/quickActions/types.ts`:

```ts
export interface QuickAction {
  id: string;
  name: string;
  description: string;
  icon?: string;
  tags?: string[];
  prompt: string;
  filePath: string;
  favorite?: boolean;
  favoriteRank?: number;
}

export interface QuickActionFrontmatter {
  name: string;
  description?: string;
  icon?: string;
  tags?: string[];
  favorite?: boolean;
  favoriteRank?: number;
}
```

- [ ] **Step 4: Extend parse and serialize**

In `src/features/quickActions/quickActionParse.ts`:

Add to the existing import line:

```ts
import { extractBoolean, extractNumber, extractString, extractStringArray, parseFrontmatter } from '../../utils/frontmatter';
```

Replace the `parseQuickActionContent` return object so it also reads the new fields, and gate `favoriteRank` to `1..5`:

```ts
  const favorite = extractBoolean(fm, 'favorite') === true ? true : undefined;
  const rankRaw = extractNumber(fm, 'favoriteRank');
  const favoriteRank = Number.isInteger(rankRaw) && rankRaw! >= 1 && rankRaw! <= 5
    ? rankRaw
    : undefined;

  return {
    id: filePathToId(filePath),
    name,
    description,
    icon,
    tags: tags && tags.length > 0 ? tags : undefined,
    prompt: body,
    filePath,
    favorite,
    favoriteRank: favorite ? favoriteRank : undefined,
  };
```

Replace `serializeQuickAction` to emit the new lines only when `favorite === true`:

```ts
export function serializeQuickAction(action: QuickActionFrontmatter & { prompt: string }): string {
  const lines = ['---'];
  lines.push(`type: ${QUICK_ACTION_FRONTMATTER_TYPE}`);
  lines.push(`name: ${yamlQuote(action.name)}`);
  if (action.description?.trim() && action.description !== action.name) {
    lines.push(`description: ${yamlQuote(action.description.trim())}`);
  }
  if (action.icon?.trim()) {
    lines.push(`icon: ${yamlQuote(action.icon.trim())}`);
  }
  const tags = action.tags?.map((t) => t.trim()).filter(Boolean) ?? [];
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) {
      lines.push(`  - ${yamlQuote(tag)}`);
    }
  }
  if (action.favorite === true) {
    lines.push('favorite: true');
    if (
      typeof action.favoriteRank === 'number' &&
      Number.isInteger(action.favoriteRank) &&
      action.favoriteRank >= 1 &&
      action.favoriteRank <= 5
    ) {
      lines.push(`favoriteRank: ${action.favoriteRank}`);
    }
  }
  lines.push('---', '', action.prompt.trim(), '');
  return lines.join('\n');
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- --selectProjects unit --testPathPattern quickActionParse`
Expected: PASS (all existing tests plus the six new ones).

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/quickActions/types.ts src/features/quickActions/quickActionParse.ts tests/unit/features/quickActions/quickActionParse.test.ts
git commit -m "feat(quickActions): parse and serialize favorite + favoriteRank frontmatter"
```

---

## Task 3: Add favorite mutations to `QuickActionStorage`

**Files:**
- Modify: `src/features/quickActions/QuickActionStorage.ts`
- Test: `tests/unit/features/quickActions/QuickActionStorage.favorites.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/features/quickActions/QuickActionStorage.favorites.test.ts`:

```ts
import { QuickActionStorage, assignNextFavoriteRank } from '@/features/quickActions/QuickActionStorage';
import type { QuickAction } from '@/features/quickActions/types';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function makeAction(partial: Partial<QuickAction>): QuickAction {
  return {
    id: partial.id ?? 'id',
    name: partial.name ?? 'Name',
    description: partial.description ?? 'Name',
    prompt: partial.prompt ?? 'Body.',
    filePath: partial.filePath ?? 'Quick Actions/name.md',
    favorite: partial.favorite,
    favoriteRank: partial.favoriteRank,
    icon: partial.icon,
    tags: partial.tags,
  };
}

function makeAdapter() {
  const files = new Map<string, string>();
  return {
    files,
    read: jest.fn(async (p: string) => files.get(p) ?? ''),
    write: jest.fn(async (p: string, c: string) => { files.set(p, c); }),
    delete: jest.fn(async (p: string) => { files.delete(p); }),
    ensureFolder: jest.fn(async () => undefined),
    listFilesRecursive: jest.fn(async () => Array.from(files.keys())),
  } satisfies Partial<VaultFileAdapter> & { files: Map<string, string> };
}

describe('assignNextFavoriteRank', () => {
  it('returns 1 when no favorites exist', () => {
    expect(assignNextFavoriteRank([])).toBe(1);
  });

  it('returns the lowest unused rank in 1..5', () => {
    const favs = [
      makeAction({ favorite: true, favoriteRank: 1 }),
      makeAction({ favorite: true, favoriteRank: 2 }),
      makeAction({ favorite: true, favoriteRank: 4 }),
    ];
    expect(assignNextFavoriteRank(favs)).toBe(3);
  });

  it('returns null when all five slots are taken', () => {
    const favs = [1, 2, 3, 4, 5].map((r) => makeAction({ favorite: true, favoriteRank: r }));
    expect(assignNextFavoriteRank(favs)).toBeNull();
  });

  it('ignores non-favorites when computing the next rank', () => {
    const list = [
      makeAction({ favorite: false, favoriteRank: 1 }),
      makeAction({ favorite: true, favoriteRank: 2 }),
    ];
    expect(assignNextFavoriteRank(list)).toBe(1);
  });
});

describe('QuickActionStorage favorites', () => {
  it('setFavorite writes favorite: true and favoriteRank, preserves body', async () => {
    const adapter = makeAdapter();
    adapter.files.set('Quick Actions/foo.md', `---
type: quick-action
name: Foo
---

Original body.
`);
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({ name: 'Foo', filePath: 'Quick Actions/foo.md', prompt: 'Original body.' });

    await storage.setFavorite(action, 2);

    const written = adapter.files.get('Quick Actions/foo.md')!;
    expect(written).toContain('favorite: true');
    expect(written).toContain('favoriteRank: 2');
    expect(written).toContain('Original body.');
  });

  it('unsetFavorite strips both fields and preserves body', async () => {
    const adapter = makeAdapter();
    adapter.files.set('Quick Actions/foo.md', `---
type: quick-action
name: Foo
favorite: true
favoriteRank: 3
---

Original body.
`);
    const storage = new QuickActionStorage(adapter as unknown as VaultFileAdapter, () => 'Quick Actions');
    const action = makeAction({
      name: 'Foo',
      filePath: 'Quick Actions/foo.md',
      prompt: 'Original body.',
      favorite: true,
      favoriteRank: 3,
    });

    await storage.unsetFavorite(action);

    const written = adapter.files.get('Quick Actions/foo.md')!;
    expect(written).not.toContain('favorite:');
    expect(written).not.toContain('favoriteRank:');
    expect(written).toContain('Original body.');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- --selectProjects unit --testPathPattern QuickActionStorage.favorites`
Expected: FAIL with `assignNextFavoriteRank is not exported` and `setFavorite is not a function`.

- [ ] **Step 3: Implement the helper and methods**

In `src/features/quickActions/QuickActionStorage.ts`, add a top-level export:

```ts
export function assignNextFavoriteRank(actions: QuickAction[]): number | null {
  const used = new Set<number>();
  for (const a of actions) {
    if (a.favorite === true && typeof a.favoriteRank === 'number') {
      used.add(a.favoriteRank);
    }
  }
  for (let r = 1; r <= 5; r++) {
    if (!used.has(r)) return r;
  }
  return null;
}
```

Add two methods to the `QuickActionStorage` class:

```ts
  async setFavorite(action: QuickAction, rank: number): Promise<void> {
    if (!Number.isInteger(rank) || rank < 1 || rank > 5) {
      throw new Error(`invalid favoriteRank: ${rank}`);
    }
    await this.save({ ...action, favorite: true, favoriteRank: rank });
  }

  async unsetFavorite(action: QuickAction): Promise<void> {
    const { favorite: _favorite, favoriteRank: _favoriteRank, ...rest } = action;
    await this.save({ ...rest, favorite: undefined, favoriteRank: undefined });
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- --selectProjects unit --testPathPattern QuickActionStorage.favorites`
Expected: PASS (six assertions across two describe blocks).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/QuickActionStorage.ts tests/unit/features/quickActions/QuickActionStorage.favorites.test.ts
git commit -m "feat(quickActions): add assignNextFavoriteRank, setFavorite, unsetFavorite"
```

---

## Task 4: Extract `runQuickActionForFile` shared helper

**Files:**
- Create: `src/features/quickActions/runQuickActionForFile.ts`
- Modify: `src/features/quickActions/openContextMenuQuickAction.ts`
- Test: `tests/unit/features/quickActions/runQuickActionForFile.test.ts`
- Modify: `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts` (only if the module mock surface changes)

- [ ] **Step 1: Write the failing test for the new helper**

Create `tests/unit/features/quickActions/runQuickActionForFile.test.ts`:

```ts
import { Notice, TFile, TFolder } from 'obsidian';

import { runQuickActionForFile } from '@/features/quickActions/runQuickActionForFile';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

const MOCK_ACTION: QuickAction = {
  id: 'act',
  name: 'Summarize',
  description: 'Summarize',
  prompt: 'Summarize this.',
  filePath: 'Quick Actions/summarize.md',
};

function makeMockTab(lifecycleState: 'blank' | 'active') {
  return {
    id: 'tab-1',
    lifecycleState,
    ui: {
      fileContextManager: {
        attachFileAsPill: jest.fn(),
        attachFolderAsPill: jest.fn(),
      },
    },
    controllers: {
      inputController: { sendMessage: jest.fn() },
    },
  };
}

function makeMockTabManager(opts: {
  activeTab: ReturnType<typeof makeMockTab> | null;
  canCreate: boolean;
  newTab?: ReturnType<typeof makeMockTab> | null;
}) {
  return {
    getActiveTab: jest.fn(() => opts.activeTab),
    canCreateTab: jest.fn(() => opts.canCreate),
    createTab: jest.fn().mockResolvedValue(opts.newTab ?? null),
    switchToTab: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockPlugin(tabManager: ReturnType<typeof makeMockTabManager> | null) {
  const view = { getTabManager: jest.fn(() => tabManager) };
  return {
    app: { vault: {} },
    getView: jest.fn(() => view),
    activateView: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('runQuickActionForFile', () => {
  it('reuses a blank active tab, attaches file pill after switch, sends prompt', async () => {
    const tab = makeMockTab('blank');
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true });
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runQuickActionForFile(plugin as any, file, MOCK_ACTION);

    expect(tm.switchToTab).toHaveBeenCalledWith('tab-1');
    expect(tab.ui.fileContextManager.attachFileAsPill).toHaveBeenCalledWith('note.md');
    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledWith({ content: 'Summarize this.' });

    const switchOrder = (tm.switchToTab as jest.Mock).mock.invocationCallOrder[0];
    const attachOrder = (tab.ui.fileContextManager.attachFileAsPill as jest.Mock).mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(attachOrder);
  });

  it('attaches folder pill when given a TFolder', async () => {
    const tab = makeMockTab('blank');
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true });
    const plugin = makeMockPlugin(tm);
    const folder = Object.assign(Object.create(TFolder.prototype), { path: 'docs' });

    await runQuickActionForFile(plugin as any, folder, MOCK_ACTION);

    expect(tab.ui.fileContextManager.attachFolderAsPill).toHaveBeenCalledWith('docs');
  });

  it('creates a new tab when the active tab is not blank', async () => {
    const active = makeMockTab('active');
    const newTab = makeMockTab('blank');
    newTab.id = 'tab-2';
    const tm = makeMockTabManager({ activeTab: active, canCreate: true, newTab });
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runQuickActionForFile(plugin as any, file, MOCK_ACTION);

    expect(tm.createTab).toHaveBeenCalledWith(null, undefined, { activate: false });
    expect(tm.switchToTab).toHaveBeenCalledWith('tab-2');
  });

  it('shows the tab-limit notice when canCreateTab returns false', async () => {
    const active = makeMockTab('active');
    const tm = makeMockTabManager({ activeTab: active, canCreate: false });
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runQuickActionForFile(plugin as any, file, MOCK_ACTION);

    expect(Notice).toHaveBeenCalledWith('quickActions.contextMenu.tabLimitReached');
    expect(tm.switchToTab).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern runQuickActionForFile`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/features/quickActions/runQuickActionForFile.ts`:

```ts
import { Notice, type TAbstractFile, TFile, TFolder } from 'obsidian';

import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import type { QuickAction } from './types';

/**
 * Shared run flow used by both the quick-actions modal callback and the
 * favorite items injected into the file/folder right-click menu.
 *
 * Ensures the chat view is open, picks (or creates) a target tab, switches
 * to it FIRST so the welcome reset does not wipe the chip, then attaches
 * the right-clicked file or folder as a pill and fires the action prompt.
 */
export async function runQuickActionForFile(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
  action: QuickAction,
): Promise<void> {
  let view = plugin.getView();
  if (!view) {
    await plugin.activateView();
    view = plugin.getView();
  }
  if (!view) return;

  const tabManager = view.getTabManager();
  if (!tabManager) return;

  const activeTab = tabManager.getActiveTab();
  const isBlank = activeTab?.lifecycleState === 'blank';
  let targetTab;

  if (isBlank && activeTab) {
    targetTab = activeTab;
  } else if (tabManager.canCreateTab()) {
    const newTab = await tabManager.createTab(null, undefined, { activate: false });
    if (!newTab) {
      new Notice(t('quickActions.contextMenu.tabLimitReached'));
      return;
    }
    targetTab = newTab;
  } else {
    new Notice(t('quickActions.contextMenu.tabLimitReached'));
    return;
  }

  // Switch BEFORE attaching so the blank-tab welcome reset does not wipe
  // the pill. See openContextMenuQuickAction comment block for full
  // rationale.
  await tabManager.switchToTab(targetTab.id);

  if (file instanceof TFile) {
    targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
  } else if (file instanceof TFolder) {
    targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
  }

  void targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
}
```

- [ ] **Step 4: Run the helper tests to verify pass**

Run: `npm run test -- --selectProjects unit --testPathPattern runQuickActionForFile`
Expected: PASS (4 assertions).

- [ ] **Step 5: Refactor `openContextMenuQuickAction` to delegate**

Replace the body of `src/features/quickActions/openContextMenuQuickAction.ts`:

```ts
import type { TAbstractFile } from 'obsidian';

import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type ClaudianPlugin from '@/main';

import { QuickActionStorage } from './QuickActionStorage';
import { runQuickActionForFile } from './runQuickActionForFile';
import { QuickActionsModal } from './ui/QuickActionsModal';

/**
 * Opens the quick actions picker modal for the given vault file or folder.
 * On selection, delegates to runQuickActionForFile which encapsulates the
 * shared tab/pill/send flow also used by favorite menu items.
 */
export function openContextMenuQuickAction(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): void {
  const storage = new QuickActionStorage(
    new VaultFileAdapter(plugin.app),
    () => plugin.settings.quickActionsFolder ?? 'Quick Actions',
  );

  new QuickActionsModal(plugin.app, {
    storage,
    onRun: (action) => {
      void runQuickActionForFile(plugin, file, action);
    },
  }).open();
}
```

- [ ] **Step 6: Re-run the existing modal-delegating tests**

Run: `npm run test -- --selectProjects unit --testPathPattern openContextMenuQuickAction`
Expected: PASS — every existing assertion still holds because the behavior is now produced by the extracted helper called from the same `onRun` closure. If the tests fail solely because the mock surface drifted (e.g. they mock `runQuickActionForFile`), add this mock at the top of `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`:

```ts
jest.mock('@/features/quickActions/runQuickActionForFile', () => ({
  runQuickActionForFile: jest.fn().mockResolvedValue(undefined),
}));
```

…and replace per-test behavioral assertions (`attachFileAsPill`, `sendMessage`, `switchToTab`) with a single assertion that `runQuickActionForFile` was called with `(plugin, file, MOCK_ACTION)`. The behavioral tests already live in `runQuickActionForFile.test.ts` so we are not losing coverage.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/features/quickActions/runQuickActionForFile.ts src/features/quickActions/openContextMenuQuickAction.ts tests/unit/features/quickActions/runQuickActionForFile.test.ts tests/unit/features/quickActions/openContextMenuQuickAction.test.ts
git commit -m "refactor(quickActions): extract runQuickActionForFile shared flow"
```

---

## Task 5: Create `QuickActionFavoritesCache`

**Files:**
- Create: `src/features/quickActions/QuickActionFavoritesCache.ts`
- Test: `tests/unit/features/quickActions/QuickActionFavoritesCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/quickActions/QuickActionFavoritesCache.test.ts`:

```ts
import { QuickActionFavoritesCache } from '@/features/quickActions/QuickActionFavoritesCache';
import type { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => ({
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

function makeAction(rank: number | undefined, name: string, filePath: string): QuickAction {
  return {
    id: filePath,
    name,
    description: name,
    prompt: 'Body.',
    filePath,
    favorite: rank !== undefined ? true : undefined,
    favoriteRank: rank,
  };
}

function makeApp() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    handlers,
    vault: {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = handlers[event] ?? [];
        handlers[event].push(cb);
        return { event } as unknown;
      }),
      offref: jest.fn(),
    },
  };
}

function makeStorage(actions: QuickAction[]) {
  return {
    loadAll: jest.fn().mockResolvedValue(actions),
  } as unknown as QuickActionStorage;
}

async function flush() {
  await new Promise((r) => setImmediate(r));
}

describe('QuickActionFavoritesCache', () => {
  it('returns empty before initial load resolves', () => {
    const app = makeApp();
    const cache = new QuickActionFavoritesCache(makeStorage([]), app as any, () => 'Quick Actions');
    expect(cache.getFavorites()).toEqual([]);
    cache.dispose();
  });

  it('returns favorites sorted by rank after initial load', async () => {
    const app = makeApp();
    const storage = makeStorage([
      makeAction(3, 'C', 'Quick Actions/c.md'),
      makeAction(1, 'A', 'Quick Actions/a.md'),
      makeAction(undefined, 'Z', 'Quick Actions/z.md'),
    ]);
    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    await flush();

    const favs = cache.getFavorites();
    expect(favs.map((f) => f.favoriteRank)).toEqual([1, 3]);
    cache.dispose();
  });

  it('caps the returned list at five', async () => {
    const app = makeApp();
    const storage = makeStorage([1, 2, 3, 4, 5, 6].map((r) => makeAction(r > 5 ? undefined : r, `A${r}`, `Quick Actions/a${r}.md`)));
    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    await flush();
    expect(cache.getFavorites()).toHaveLength(5);
    cache.dispose();
  });

  it('reloads on vault modify event inside the favorites folder', async () => {
    const app = makeApp();
    const storage = makeStorage([makeAction(1, 'A', 'Quick Actions/a.md')]);
    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    await flush();
    expect(storage.loadAll).toHaveBeenCalledTimes(1);

    (storage.loadAll as jest.Mock).mockResolvedValue([
      makeAction(1, 'A', 'Quick Actions/a.md'),
      makeAction(2, 'B', 'Quick Actions/b.md'),
    ]);
    app.handlers.modify[0]({ path: 'Quick Actions/b.md' });
    await flush();

    expect(storage.loadAll).toHaveBeenCalledTimes(2);
    expect(cache.getFavorites()).toHaveLength(2);
    cache.dispose();
  });

  it('ignores events outside the favorites folder', async () => {
    const app = makeApp();
    const storage = makeStorage([]);
    const cache = new QuickActionFavoritesCache(storage, app as any, () => 'Quick Actions');
    cache.start();
    await flush();
    const beforeCalls = (storage.loadAll as jest.Mock).mock.calls.length;

    app.handlers.modify[0]({ path: 'Notes/other.md' });
    await flush();

    expect((storage.loadAll as jest.Mock).mock.calls.length).toBe(beforeCalls);
    cache.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern QuickActionFavoritesCache`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the cache**

Create `src/features/quickActions/QuickActionFavoritesCache.ts`:

```ts
import type { App, EventRef, TAbstractFile } from 'obsidian';

import type { QuickActionStorage } from './QuickActionStorage';
import type { QuickAction } from './types';

const MAX_FAVORITES = 5;

/**
 * Synchronous read-only view of the favorite quick actions. The
 * Obsidian `file-menu` callback runs synchronously, so it needs a
 * non-async way to read the current favorites. This cache subscribes
 * to vault events scoped to `quickActionsFolder` and refreshes its
 * internal list on each relevant event.
 */
export class QuickActionFavoritesCache {
  private favorites: QuickAction[] = [];
  private refs: EventRef[] = [];
  private currentFolder = '';

  constructor(
    private storage: QuickActionStorage,
    private app: App,
    private getFolderPath: () => string,
  ) {}

  start(): void {
    this.currentFolder = this.normalizedFolder();
    this.subscribe();
    void this.reload();
  }

  /** Returns the favorites sorted by rank ascending, capped at five. */
  getFavorites(): QuickAction[] {
    return this.favorites;
  }

  /** Re-reads the folder setting and re-subscribes if it changed; reloads either way. */
  refresh(): void {
    const next = this.normalizedFolder();
    if (next !== this.currentFolder) {
      this.unsubscribe();
      this.currentFolder = next;
      this.subscribe();
    }
    void this.reload();
  }

  dispose(): void {
    this.unsubscribe();
    this.favorites = [];
  }

  private subscribe(): void {
    const handler = (file: TAbstractFile, _oldPath?: string) => {
      const path = (file as { path?: string })?.path ?? '';
      const oldPath = typeof _oldPath === 'string' ? _oldPath : '';
      if (this.isUnderFolder(path) || (oldPath && this.isUnderFolder(oldPath))) {
        void this.reload();
      }
    };
    this.refs.push(this.app.vault.on('create', handler));
    this.refs.push(this.app.vault.on('modify', handler));
    this.refs.push(this.app.vault.on('delete', handler));
    this.refs.push(this.app.vault.on('rename', handler));
  }

  private unsubscribe(): void {
    for (const ref of this.refs) {
      this.app.vault.offref(ref);
    }
    this.refs = [];
  }

  private async reload(): Promise<void> {
    const all = await this.storage.loadAll();
    const favs = all
      .filter((a) => a.favorite === true)
      .sort((a, b) => {
        const ar = a.favoriteRank ?? Number.POSITIVE_INFINITY;
        const br = b.favoriteRank ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_FAVORITES);
    this.favorites = favs;
  }

  private normalizedFolder(): string {
    const raw = (this.getFolderPath() ?? '').trim();
    return raw.replace(/\/+$/, '');
  }

  private isUnderFolder(path: string): boolean {
    if (!this.currentFolder) return false;
    return path === this.currentFolder
      || path.startsWith(`${this.currentFolder}/`);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- --selectProjects unit --testPathPattern QuickActionFavoritesCache`
Expected: PASS (five test cases).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/QuickActionFavoritesCache.ts tests/unit/features/quickActions/QuickActionFavoritesCache.test.ts
git commit -m "feat(quickActions): add QuickActionFavoritesCache backed by vault events"
```

---

## Task 6: Wire the cache into the plugin lifecycle

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/integration/main.test.ts`

- [ ] **Step 1: Read the existing main.ts lifecycle around `registerWorkspaceMenus`**

Open `src/main.ts` and locate the existing call `registerWorkspaceMenus(this);` (currently near line 126). The cache must be constructed BEFORE `registerWorkspaceMenus` because the menu wiring (Task 9) accepts the cache as an argument.

- [ ] **Step 2: Inspect existing main integration test infrastructure**

Open `tests/integration/main.test.ts` and read the file end to end. Identify:

- The factory or `beforeEach` that constructs a plugin instance and calls `onload`.
- The mock used for `App`/`Vault`/`Workspace`.
- The pattern existing tests use to reach plugin-level fields (direct property access vs. an exposed getter).

Write the new test in the same style. Concretely, you want a test that:

1. Loads the plugin through that file's existing setup helper (do not invent a new one).
2. Asserts `plugin.quickActionFavoritesCache instanceof QuickActionFavoritesCache` (import the class).
3. Spies on `plugin.quickActionFavoritesCache.dispose`, calls `plugin.onunload()`, and asserts the spy fired exactly once.

If the integration test file does not already have a plugin-construction helper or uses a different unload signal (e.g. `unload` instead of `onunload`), match the file's pattern. Do not change other tests' shape.

- [ ] **Step 2a: Add the failing test**

Following the conventions confirmed in Step 2, insert the new test inside the appropriate describe block. Reference shape:

```ts
import { QuickActionFavoritesCache } from '@/features/quickActions/QuickActionFavoritesCache';

it('constructs the QuickActionFavoritesCache at load and disposes it at unload', async () => {
  // Replace `setupPlugin` with the file's existing helper.
  const plugin = await setupPlugin();
  expect(plugin.quickActionFavoritesCache).toBeInstanceOf(QuickActionFavoritesCache);
  const disposeSpy = jest.spyOn(plugin.quickActionFavoritesCache!, 'dispose');
  plugin.onunload();
  expect(disposeSpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- --selectProjects integration --testPathPattern main`
Expected: FAIL — `quickActionFavoritesCache` is undefined.

- [ ] **Step 4: Wire the cache into `main.ts`**

Add imports near the existing quick-actions adjacent imports:

```ts
import { QuickActionStorage } from './features/quickActions/QuickActionStorage';
import { QuickActionFavoritesCache } from './features/quickActions/QuickActionFavoritesCache';
import { VaultFileAdapter } from './core/storage/VaultFileAdapter';
```

Add a public field on the plugin class (public so `registerWorkspaceMenus` in Task 9 can read it without an accessor):

```ts
  public quickActionFavoritesCache: QuickActionFavoritesCache | null = null;
```

In the existing `onload` body, immediately before the existing line `registerWorkspaceMenus(this);`, insert:

```ts
    const quickActionStorage = new QuickActionStorage(
      new VaultFileAdapter(this.app),
      () => this.settings.quickActionsFolder ?? 'Quick Actions',
    );
    this.quickActionFavoritesCache = new QuickActionFavoritesCache(
      quickActionStorage,
      this.app,
      () => this.settings.quickActionsFolder ?? 'Quick Actions',
    );
    this.quickActionFavoritesCache.start();
```

Update the `registerWorkspaceMenus(this);` call to pass the cache (the signature change happens in Task 9; in this task we only construct and start the cache, then leave the existing call site untouched until Task 9 adjusts the signature). For now, only the construction and lifecycle is wired.

In the plugin's `onunload` method, add (or, if `onunload` does not exist, declare it):

```ts
  onunload(): void {
    this.quickActionFavoritesCache?.dispose();
    this.quickActionFavoritesCache = null;
  }
```

If an `onunload` already exists, add the two lines above to the top of its body, preserving the rest.

- [ ] **Step 5: Re-add the getter exposed to the test**

The integration test reads `plugin['quickActionFavoritesCache']`. The private field above is accessible via bracket indexing, so no extra getter is required.

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -- --selectProjects integration --testPathPattern main`
Expected: PASS — the new integration assertion succeeds.

Also run: `npm run test -- --selectProjects unit`
Expected: existing unit suite still PASS.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts tests/integration/main.test.ts
git commit -m "feat(quickActions): construct and dispose QuickActionFavoritesCache with plugin lifecycle"
```

---

## Task 7: Star toggle and favorites group in `QuickActionsModal`

**Files:**
- Modify: `src/features/quickActions/ui/QuickActionsModal.ts`
- Test: `tests/unit/features/quickActions/QuickActionsModal.favorites.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/quickActions/QuickActionsModal.favorites.test.ts`:

```ts
import { App, Notice } from 'obsidian';

import { QuickActionsModal } from '@/features/quickActions/ui/QuickActionsModal';
import type { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => {
  class Modal {
    app: any;
    contentEl: any;
    modalEl: any;
    constructor(app: any) {
      this.app = app;
      this.contentEl = document.createElement('div');
      this.modalEl = document.createElement('div');
    }
    setTitle() {}
    open() { this.onOpen?.(); }
    close() {}
    onOpen?(): void;
  }
  return {
    Modal,
    Notice: jest.fn(),
    setIcon: jest.fn(),
  };
});

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: Record<string, string>) => params ? `${key}:${JSON.stringify(params)}` : key,
}));

jest.mock('@/features/quickActions/ui/QuickActionEditorModal', () => ({
  QuickActionEditorModal: class { open() {} },
}));

function makeAction(p: Partial<QuickAction>): QuickAction {
  return {
    id: p.filePath ?? p.name ?? 'id',
    name: p.name ?? 'Name',
    description: p.description ?? p.name ?? 'Name',
    prompt: p.prompt ?? 'Body.',
    filePath: p.filePath ?? 'Quick Actions/name.md',
    favorite: p.favorite,
    favoriteRank: p.favoriteRank,
    icon: p.icon,
    tags: p.tags,
  };
}

function makeStorage(actions: QuickAction[]): QuickActionStorage {
  return {
    loadAll: jest.fn().mockResolvedValue(actions),
    save: jest.fn().mockResolvedValue('Quick Actions/x.md'),
    delete: jest.fn().mockResolvedValue(undefined),
    setFavorite: jest.fn().mockResolvedValue(undefined),
    unsetFavorite: jest.fn().mockResolvedValue(undefined),
  } as unknown as QuickActionStorage;
}

async function flush() { await new Promise((r) => setImmediate(r)); }

beforeEach(() => jest.clearAllMocks());

describe('QuickActionsModal favorites', () => {
  it('renders favorites group above non-favorites, sorted by rank', async () => {
    const storage = makeStorage([
      makeAction({ name: 'Zebra' }),
      makeAction({ name: 'B', favorite: true, favoriteRank: 2 }),
      makeAction({ name: 'A', favorite: true, favoriteRank: 1 }),
    ]);
    const modal = new QuickActionsModal({} as App, { storage, onRun: jest.fn() });
    modal.open();
    await flush();

    const names = Array.from(modal['contentEl'].querySelectorAll('.claudian-quick-action-row strong'))
      .map((el: any) => el.textContent);
    expect(names).toEqual(['A', 'B', 'Zebra']);
  });

  it('clicking outline star calls setFavorite with the next free rank', async () => {
    const storage = makeStorage([
      makeAction({ name: 'A', favorite: true, favoriteRank: 1, filePath: 'Quick Actions/a.md' }),
      makeAction({ name: 'B', filePath: 'Quick Actions/b.md' }),
    ]);
    const modal = new QuickActionsModal({} as App, { storage, onRun: jest.fn() });
    modal.open();
    await flush();

    const buttons = modal['contentEl'].querySelectorAll('.claudian-quick-action-favorite');
    const bStar = buttons[1] as HTMLButtonElement;
    bStar.click();
    await flush();

    expect((storage.setFavorite as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'B' }),
      2,
    );
  });

  it('clicking filled star calls unsetFavorite', async () => {
    const storage = makeStorage([
      makeAction({ name: 'A', favorite: true, favoriteRank: 1, filePath: 'Quick Actions/a.md' }),
    ]);
    const modal = new QuickActionsModal({} as App, { storage, onRun: jest.fn() });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.claudian-quick-action-favorite') as HTMLButtonElement;
    star.click();
    await flush();

    expect((storage.unsetFavorite as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'A' }),
    );
  });

  it('shows the limit notice and skips save when starring a sixth action', async () => {
    const storage = makeStorage([
      ...[1, 2, 3, 4, 5].map((r) =>
        makeAction({ name: `F${r}`, favorite: true, favoriteRank: r, filePath: `Quick Actions/f${r}.md` }),
      ),
      makeAction({ name: 'New', filePath: 'Quick Actions/new.md' }),
    ]);
    const modal = new QuickActionsModal({} as App, { storage, onRun: jest.fn() });
    modal.open();
    await flush();

    const stars = modal['contentEl'].querySelectorAll('.claudian-quick-action-favorite');
    const newStar = stars[stars.length - 1] as HTMLButtonElement;
    newStar.click();
    await flush();

    expect(Notice).toHaveBeenCalledWith('quickActions.modal.favoriteLimitReached');
    expect((storage.setFavorite as jest.Mock)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern QuickActionsModal.favorites`
Expected: FAIL — the modal does not render a star button class, sorting is alphabetical only, and `setFavorite`/`unsetFavorite` paths do not exist.

- [ ] **Step 3: Update `QuickActionsModal.ts`**

In `src/features/quickActions/ui/QuickActionsModal.ts`, replace the existing `renderList` body so it groups favorites first when no filter is active:

```ts
  private renderList(): void {
    if (!this.listEl || !this.searchWrapEl) {
      return;
    }
    this.listEl.empty();

    if (this.actions.length === 0) {
      this.listEl.addClass('claudian-quick-actions-list--empty');
      this.searchWrapEl.addClass('claudian-quick-actions-search--hidden');
      return;
    }

    this.listEl.removeClass('claudian-quick-actions-list--empty');
    this.searchWrapEl.removeClass('claudian-quick-actions-search--hidden');

    const filtered = this.applyFilter(this.actions);
    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.modal.noResults'),
      });
      return;
    }

    const isFiltering = this.filter.trim().length > 0;
    const ordered = isFiltering ? filtered : this.sortFavoritesFirst(filtered);
    for (const action of ordered) {
      this.renderRow(action);
    }
  }

  private sortFavoritesFirst(actions: QuickAction[]): QuickAction[] {
    const favs = actions
      .filter((a) => a.favorite === true)
      .sort((a, b) => {
        const ar = a.favoriteRank ?? Number.POSITIVE_INFINITY;
        const br = b.favoriteRank ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return a.name.localeCompare(b.name);
      });
    const rest = actions
      .filter((a) => a.favorite !== true)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...favs, ...rest];
  }
```

(Be sure to import `QuickAction` if it is not already in scope.)

In `renderRow`, immediately before the existing line `const actions = row.createDiv({ cls: 'claudian-quick-action-actions' });`, insert:

```ts
    const starBtn = row.createEl('button', {
      cls: 'claudian-quick-action-favorite',
      attr: {
        'aria-label': action.favorite
          ? t('quickActions.modal.unmarkFavorite')
          : t('quickActions.modal.markFavorite'),
      },
    });
    setIcon(starBtn, 'star');
    if (action.favorite) {
      starBtn.addClass('is-favorite');
    }
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.toggleFavorite(action, starBtn);
    });
```

Add a new method below `deleteAction`:

```ts
  private async toggleFavorite(action: QuickAction, button: HTMLButtonElement): Promise<void> {
    if (button.disabled) return;
    button.disabled = true;
    try {
      if (action.favorite === true) {
        await this.callbacks.storage.unsetFavorite(action);
      } else {
        const rank = assignNextFavoriteRank(this.actions);
        if (rank === null) {
          new Notice(t('quickActions.modal.favoriteLimitReached'));
          return;
        }
        await this.callbacks.storage.setFavorite(action, rank);
      }
      await this.refreshList();
    } finally {
      button.disabled = false;
    }
  }
```

Add to the top imports:

```ts
import { assignNextFavoriteRank } from '../QuickActionStorage';
```

- [ ] **Step 4: Add minimal styling**

Add to the closest existing CSS file for the modal (search for `.claudian-quick-action-row` selector; add the rule in the same file):

```css
.claudian-quick-action-favorite {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.5;
}
.claudian-quick-action-favorite.is-favorite {
  opacity: 1;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- --selectProjects unit --testPathPattern QuickActionsModal.favorites`
Expected: PASS (four assertions).

Also re-run the existing modal-adjacent tests:

Run: `npm run test -- --selectProjects unit --testPathPattern features/quickActions`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/quickActions/ui/QuickActionsModal.ts src/style tests/unit/features/quickActions/QuickActionsModal.favorites.test.ts
git commit -m "feat(quickActions): star toggle and favorites-first sort in modal"
```

---

## Task 8: i18n keys across all 10 locales

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/locales/en.json` and the 9 sibling locale JSON files

The `tests/unit/i18n/locales.test.ts` test asserts that every locale has exactly the English key set, so all 10 files must be updated together.

- [ ] **Step 1: Verify the locale parity test fails after Task 7**

If Task 7's new key references (`quickActions.modal.markFavorite`, `quickActions.modal.unmarkFavorite`, `quickActions.modal.favoriteLimitReached`) only exist as `t(...)` calls and not in the type union, TypeScript will fail first. Confirm:

Run: `npm run typecheck`
Expected: FAIL with `Argument of type '"quickActions.modal.markFavorite"' is not assignable to parameter of type 'TranslationKey'` (or similar).

- [ ] **Step 2: Extend the key union**

In `src/i18n/types.ts`, locate the existing `quickActions.modal.*` block (around lines 278-288). Add these three lines just below `'quickActions.modal.filterByTag'`:

```ts
  | 'quickActions.modal.markFavorite'
  | 'quickActions.modal.unmarkFavorite'
  | 'quickActions.modal.favoriteLimitReached'
```

- [ ] **Step 3: Add the keys to all 10 locale files**

In each of `src/i18n/locales/en.json`, `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`, locate the `quickActions.modal` object and append three keys before its closing `}`. Use these strings (translate per-locale; English shown):

```json
"markFavorite": "Mark as favorite",
"unmarkFavorite": "Unmark favorite",
"favoriteLimitReached": "You can favorite up to 5 quick actions"
```

For non-English locales, use natural translations matching the surrounding tone (do not leave English strings — `localizedKeys` is not strictly enforced for the new keys, but matching the locale's existing tone is required). Reference adjacent existing strings in the same `quickActions.modal` block for style.

- [ ] **Step 4: Run the locale parity test**

Run: `npm run test -- --selectProjects unit --testPathPattern i18n/locales`
Expected: PASS — every locale carries identical structure.

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test -- --selectProjects unit`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/types.ts src/i18n/locales/
git commit -m "feat(i18n): add quickActions favorite mark/unmark/limit keys across 10 locales"
```

---

## Task 9: Inject favorite items into the right-click menu

**Files:**
- Modify: `src/app/commands/registerWorkspaceMenus.ts`
- Modify: `src/main.ts` (pass the cache into the call)
- Modify: `tests/unit/app/commands/registerWorkspaceMenus.test.ts`

- [ ] **Step 1: Write the failing test**

Modify `tests/unit/app/commands/registerWorkspaceMenus.test.ts` to support a cache argument. Add at the top:

```ts
import type { QuickActionFavoritesCache } from '@/features/quickActions/QuickActionFavoritesCache';
import { runQuickActionForFile } from '@/features/quickActions/runQuickActionForFile';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('@/features/quickActions/runQuickActionForFile', () => ({
  runQuickActionForFile: jest.fn().mockResolvedValue(undefined),
}));
```

Extend `createPlugin` to accept an injected cache (default empty):

```ts
function createPlugin(favorites: QuickAction[] = []): {
  plugin: ClaudianPlugin;
  fileMenu: { handler: FileMenuHandler | null };
  editorMenu: { handler: EditorMenuHandler | null };
  cache: { getFavorites: jest.Mock };
} {
  const fileMenu: { handler: FileMenuHandler | null } = { handler: null };
  const editorMenu: { handler: EditorMenuHandler | null } = { handler: null };
  const cache = { getFavorites: jest.fn(() => favorites) };
  const plugin = {
    registerEvent: jest.fn((_evtRef: unknown) => undefined),
    quickActionFavoritesCache: cache as unknown as QuickActionFavoritesCache,
    app: {
      workspace: {
        on: jest.fn((event: string, handler: unknown) => {
          if (event === 'file-menu') fileMenu.handler = handler as FileMenuHandler;
          if (event === 'editor-menu') editorMenu.handler = handler as EditorMenuHandler;
          return { event } as unknown;
        }),
      },
    },
  } as unknown as ClaudianPlugin;
  return { plugin, fileMenu, editorMenu, cache };
}
```

Update the existing two "adds Claudian chat, work-order, and quick-actions items" tests to assert that with zero favorites the count stays at 3 (no behavior change). Then add new tests:

```ts
  it('injects favorite items above the existing "Quick actions" entry for files', () => {
    const favs: QuickAction[] = [
      { id: 'a', name: 'Refactor', description: 'Refactor', prompt: 'Refactor.', filePath: 'Quick Actions/refactor.md', favorite: true, favoriteRank: 1 },
      { id: 'b', name: 'Summarize', description: 'Summarize', prompt: 'Summarize.', filePath: 'Quick Actions/summarize.md', favorite: true, favoriteRank: 2 },
    ];
    const { plugin, fileMenu } = createPlugin(favs);
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);

    expect(items).toHaveLength(5);
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith('Add file to Claudian chat');
    expect((items[1].setTitle as jest.Mock)).toHaveBeenCalledWith('Create work order');
    expect((items[2].setTitle as jest.Mock)).toHaveBeenCalledWith('Refactor');
    expect((items[3].setTitle as jest.Mock)).toHaveBeenCalledWith('Summarize');
    expect((items[4].setTitle as jest.Mock)).toHaveBeenCalledWith('Quick actions');
  });

  it('clicking a favorite item routes through runQuickActionForFile', () => {
    const favs: QuickAction[] = [
      { id: 'a', name: 'Refactor', description: 'Refactor', prompt: 'Refactor.', filePath: 'Quick Actions/refactor.md', favorite: true, favoriteRank: 1 },
    ];
    const { plugin, fileMenu } = createPlugin(favs);
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);

    const favItem = items[2];
    const onClickCall = (favItem.onClick as jest.Mock).mock.calls[0]?.[0];
    expect(typeof onClickCall).toBe('function');
    onClickCall();
    expect(runQuickActionForFile).toHaveBeenCalledWith(plugin, file, favs[0]);
  });

  it('omits favorite items when the cache is not present', () => {
    const { plugin, fileMenu } = createPlugin();
    (plugin as any).quickActionFavoritesCache = undefined;
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);
    expect(items).toHaveLength(3);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- --selectProjects unit --testPathPattern registerWorkspaceMenus`
Expected: FAIL — current implementation does not consult a cache.

- [ ] **Step 3: Update `registerWorkspaceMenus.ts`**

Replace the contents of `src/app/commands/registerWorkspaceMenus.ts`:

```ts
import type { Editor, Menu, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
import { runQuickActionForFile } from '@/features/quickActions/runQuickActionForFile';
import type { QuickAction } from '@/features/quickActions/types';
import { createWorkOrderFromSelectionInteractive, createWorkOrderInteractive } from '@/features/tasks/ui/createWorkOrderInteractive';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

function addFavoriteItems(
  menu: Menu,
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): void {
  const cache = plugin.quickActionFavoritesCache;
  if (!cache) return;
  for (const fav of cache.getFavorites()) {
    menu.addItem((item) => {
      item
        .setTitle(fav.name)
        .setIcon(fav.icon ?? 'star')
        .onClick(() => {
          void runQuickActionForFile(plugin, file, fav);
        });
    });
  }
}

export function registerWorkspaceMenus(plugin: ClaudianPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
      if (file instanceof TFile) {
        menu.addItem((item) => {
          item
            .setTitle('Add file to Claudian chat')
            .setIcon('at-sign')
            .onClick(() => {
              void plugin.addFileToActiveChat(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Create work order')
            .setIcon('kanban-square')
            .onClick(() => {
              void createWorkOrderInteractive(plugin, file);
            });
        });
        addFavoriteItems(menu, plugin, file);
        menu.addItem((item) => {
          item
            .setTitle(t('quickActions.contextMenu.title'))
            .setIcon('zap')
            .onClick(() => {
              openContextMenuQuickAction(plugin, file);
            });
        });
      } else if (file instanceof TFolder) {
        menu.addItem((item) => {
          item
            .setTitle('Add folder to Claudian chat')
            .setIcon('folder')
            .onClick(() => {
              void plugin.addFolderToActiveChat(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Create work order')
            .setIcon('kanban-square')
            .onClick(() => {
              void createWorkOrderInteractive(plugin, file);
            });
        });
        addFavoriteItems(menu, plugin, file);
        menu.addItem((item) => {
          item
            .setTitle(t('quickActions.contextMenu.title'))
            .setIcon('zap')
            .onClick(() => {
              openContextMenuQuickAction(plugin, file);
            });
        });
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
      if (!editor.getSelection().trim()) return;
      menu.addItem((item) => {
        item
          .setTitle('Create work order from selection')
          .setIcon('kanban-square')
          .onClick(() => {
            void createWorkOrderFromSelectionInteractive(plugin);
          });
      });
    }),
  );
}
```

Add a public typing for the cache on the plugin. In `src/main.ts`, change the field declaration added in Task 6 to be public:

```ts
  public quickActionFavoritesCache: QuickActionFavoritesCache | null = null;
```

(If the field name needs to be referenced from this menu file, the bracket access `plugin.quickActionFavoritesCache` works on the public field.)

Optionally export a typed accessor if linting forbids public fields — follow the project's existing convention shown in nearby files.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- --selectProjects unit --testPathPattern registerWorkspaceMenus`
Expected: PASS — five existing-plus-new file menu cases.

- [ ] **Step 5: Run the full unit + integration suites**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 8: Commit**

```bash
git add src/app/commands/registerWorkspaceMenus.ts src/main.ts tests/unit/app/commands/registerWorkspaceMenus.test.ts
git commit -m "feat(quickActions): show favorite quick actions in right-click file/folder menu"
```

---

## Self-Review

After completing all tasks, verify against the spec:

1. **Spec coverage** — every spec section mapped:
   - Data model → Tasks 1, 2.
   - Modal star toggle → Task 7.
   - Favorites cache → Task 5.
   - Menu wiring → Task 9.
   - Shared run flow → Task 4.
   - Code layout → Tasks 4, 5.
   - Edge cases — sixth click blocked (Task 7), duplicate rank handled at sort time (Task 5), rank outside 1..5 dropped at parse (Task 2), favorite without rank shown at end of group (Task 5 sort by `rank ?? Infinity`), file rename/delete invalidates cache (Task 5), folder path change handled via `refresh()` (Task 5 — note: hook into a settings-change observer if one exists, otherwise call `refresh()` on plugin settings save; if no such hook exists in the codebase, defer to a follow-up).
   - Testing — every spec testing row has a matching Task spec.

2. **Placeholder scan** — no TBD/TODO/"implement later" markers. The single optional hook in Task 9 ("export a typed accessor if linting forbids public fields") points at a concrete fallback (follow existing convention) and does not block completion.

3. **Type consistency** — `assignNextFavoriteRank`, `setFavorite(action, rank)`, `unsetFavorite(action)`, `QuickActionFavoritesCache.getFavorites()`, `runQuickActionForFile(plugin, file, action)` — all signatures stable across tasks.

4. **Open follow-up** — A settings-change observer that calls `cache.refresh()` when `quickActionsFolder` changes is desirable but not in scope; the vault event subscription still works because new-folder events would arrive through `create` on the next file added. Capture as a follow-up issue once the feature ships.
