/**
 * @jest-environment jsdom
 */
import { Menu, TFile } from 'obsidian';

import type { TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';
import { showWorkOrderContextMenu } from '@/features/tasks/ui/WorkOrderContextMenu';

// `MENU_SEPARATOR` is exported from the in-repo mock at `tests/__mocks__/obsidian.ts`
// — the real `obsidian` package exports a `MenuSeparator` class instead. Jest's
// `moduleNameMapper` rewrites the `obsidian` specifier to the mock for every
// import in this suite, including `requireActual`, so this resolves to the mock
// just like the top-of-file `import` does. The destructure + cast is the
// type-safe way to reach a symbol the published `obsidian.d.ts` doesn't expose.
const { MENU_SEPARATOR } = jest.requireActual('obsidian') as { MENU_SEPARATOR: symbol };
type MockMenuItem = { setTitle: jest.Mock; setIcon: jest.Mock; clickHandler?: () => void };
type MockMenu = Menu & { items: Array<MockMenuItem | symbol> };
const MenuMock = Menu as typeof Menu & { instances: MockMenu[] };

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

const runQuickActionForFile = jest.fn().mockResolvedValue(undefined);
jest.mock('@/features/quickActions/runQuickActionForFile', () => ({
  runQuickActionForFile: (...args: unknown[]) => runQuickActionForFile(...args),
  quickActionStemFromPath: (p: string) => p.split('/').pop()?.replace(/\.md$/i, '') ?? p,
}));

// `appendQuickActionFavoritesAndPicker` (in production) routes favorite clicks
// through `launchQuickAction`, which opens a provider+model picker modal before
// invoking `runQuickActionForFile`. These tests assert the legacy direct-dispatch
// shape, so stub `launchQuickAction` to forward straight to `runQuickActionForFile`
// — preserving the test contract without pulling in `ProviderRegistry`,
// `asSettingsBag`, or the modal UI.
jest.mock('@/features/quickActions/launchQuickAction', () => ({
  launchQuickAction: (plugin: unknown, file: unknown, action: unknown) => {
    runQuickActionForFile(plugin, file, action);
    return Promise.resolve();
  },
}));

const openContextMenuQuickAction = jest.fn();
jest.mock('@/features/quickActions/openContextMenuQuickAction', () => ({
  openContextMenuQuickAction: (...args: unknown[]) => openContextMenuQuickAction(...args),
}));

function makeTask(status: TaskStatus, conversationId?: string): TaskSpec {
  return {
    path: 'Agent Board/tasks/wo-1.md',
    frontmatter: {
      type: 'specorator-work-order',
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

type DepsArgs = Parameters<typeof showWorkOrderContextMenu>[2];
type PluginStub = DepsArgs['plugin'];

// `makePlugin` returns a hand-rolled stub satisfying the parts of `SpecoratorPlugin`
// the helper actually reads (`app.vault.getAbstractFileByPath`,
// `quickActionFavoritesCache?.getFavorites`). The single `as unknown as PluginStub`
// cast at the seam keeps the call sites cast-free.
function makePlugin(opts: {
  woFile?: unknown;
  favorites?: Array<{ id: string; name: string; prompt: string; icon?: string }>;
  hasFavoritesCache?: boolean;
}): PluginStub {
  const woFile = opts.woFile === undefined
    ? Object.assign(Object.create(TFile.prototype), { path: 'Agent Board/tasks/wo-1.md' })
    : opts.woFile;
  const getAbstractFileByPath = jest.fn(() => woFile);
  const getFavorites = jest.fn(() => opts.favorites ?? []);
  return {
    app: { vault: { getAbstractFileByPath } },
    quickActionFavoritesCache: opts.hasFavoritesCache === false ? undefined : { getFavorites },
  } as unknown as PluginStub;
}

function makeDeps(overrides: Partial<DepsArgs> = {}): DepsArgs {
  return {
    plugin: makePlugin({}),
    onOpenNote: jest.fn(),
    onOpenConversation: jest.fn(),
    canOpenConversation: jest.fn(() => false),
    onArchive: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  };
}

function titles(menu: MockMenu): string[] {
  return menu.items.map((entry) => {
    if (entry === MENU_SEPARATOR) return '<sep>';
    const item = entry as MockMenuItem;
    const calls = item.setTitle.mock.calls;
    return calls.length > 0 ? String(calls[0][0]) : '';
  });
}

describe('showWorkOrderContextMenu', () => {
  let mouseEvent: MouseEvent;

  beforeEach(() => {
    MenuMock.instances.length = 0;
    runQuickActionForFile.mockClear();
    openContextMenuQuickAction.mockClear();
    // Fresh per-test so an `it()` that calls `preventDefault()` or otherwise
    // mutates the event can never leak state into the next case.
    mouseEvent = new MouseEvent('contextmenu');
  });


  it('case 1: ready + conv + 2 favs + WO resolvable → top section then favs bracketed by seps', () => {
    const task = makeTask('ready', 'conv-1');
    const plugin = makePlugin({
      favorites: [
        { id: 'a', name: 'Fav A', prompt: 'p1', icon: 'rocket' },
        { id: 'b', name: 'Fav B', prompt: 'p2' },
      ],
    });
    const deps = makeDeps({
      plugin,
      canOpenConversation: jest.fn(() => true),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
    expect(titles(menu)).toEqual([
      'tasks.board.contextMenu.openNote',
      'tasks.board.contextMenu.openConversation',
      'quickActions.contextMenu.title',
      '<sep>',
      'Fav A',
      'Fav B',
      '<sep>',
    ]);
    expect(menu.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
    // Each item carries the expected icon — including the fav.icon override path
    // (Fav A → 'rocket') and the `?? 'star'` fallback (Fav B).
    const icons = (idx: number): string => {
      const item = menu.items[idx] as MockMenuItem;
      return String(item.setIcon.mock.calls[0][0]);
    };
    expect(icons(0)).toBe('file-text');
    expect(icons(1)).toBe('messages-square');
    expect(icons(2)).toBe('zap');
    expect(icons(4)).toBe('rocket');
    expect(icons(5)).toBe('star');
  });

  it('case 2: ready, no conv, no favs, WO resolvable → Open note + picker, no separators', () => {
    const task = makeTask('ready');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'quickActions.contextMenu.title',
    ]);
  });

  it('case 3: running + conv + 3 favs → Open note + Open conversation only (no picker, no favs)', () => {
    const task = makeTask('running', 'conv-1');
    const plugin = makePlugin({
      favorites: [
        { id: 'a', name: 'Fav A', prompt: 'p' },
        { id: 'b', name: 'Fav B', prompt: 'p' },
        { id: 'c', name: 'Fav C', prompt: 'p' },
      ],
    });
    const deps = makeDeps({
      plugin,
      canOpenConversation: jest.fn(() => true),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'tasks.board.contextMenu.openConversation',
    ]);
    // Gating must not skip the final show — single invariant across both happy
    // and gated paths.
    expect(MenuMock.instances[0].showAtMouseEvent).toHaveBeenCalledTimes(1);
  });

  it('case 4: running, no conv → Open note only', () => {
    const task = makeTask('running');
    const plugin = makePlugin({ favorites: [{ id: 'a', name: 'A', prompt: 'p' }] });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual(['tasks.board.contextMenu.openNote']);
    expect(MenuMock.instances[0].showAtMouseEvent).toHaveBeenCalledTimes(1);
  });

  it('case 5: needs_input, no conv, 2 favs, WO resolvable → picker in top, favs bracketed', () => {
    const task = makeTask('needs_input');
    const plugin = makePlugin({
      favorites: [
        { id: 'a', name: 'Fav A', prompt: 'p' },
        { id: 'b', name: 'Fav B', prompt: 'p' },
      ],
    });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'quickActions.contextMenu.title',
      '<sep>',
      'Fav A',
      'Fav B',
      '<sep>',
    ]);
  });

  it('case 6: needs_approval, no conv, 1 fav, WO resolvable → picker in top, fav bracketed', () => {
    const task = makeTask('needs_approval');
    const plugin = makePlugin({ favorites: [{ id: 'a', name: 'Fav A', prompt: 'p' }] });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'quickActions.contextMenu.title',
      '<sep>',
      'Fav A',
      '<sep>',
    ]);
  });

  it('case 7: WO TFile unresolvable, ready, conv exists → Open note + Open conversation only', () => {
    const task = makeTask('ready', 'conv-1');
    const plugin = makePlugin({ woFile: null, favorites: [{ id: 'a', name: 'A', prompt: 'p' }] });
    const deps = makeDeps({
      plugin,
      canOpenConversation: jest.fn(() => true),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'tasks.board.contextMenu.openConversation',
    ]);
    expect(MenuMock.instances[0].showAtMouseEvent).toHaveBeenCalledTimes(1);
  });

  it('case 8: quickActionFavoritesCache undefined, ready, WO resolvable → Open note + picker', () => {
    const task = makeTask('ready');
    const plugin = makePlugin({ hasFavoritesCache: false });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'quickActions.contextMenu.title',
    ]);
  });

  it('case 9: conversation_id present but canOpenConversation false → Open conversation hidden', () => {
    const task = makeTask('ready', 'conv-1');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({
      plugin,
      canOpenConversation: jest.fn(() => false),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).not.toContain('tasks.board.contextMenu.openConversation');
    expect(deps.canOpenConversation).toHaveBeenCalledWith(task);
  });

  it('case 10: clicking a favorite invokes runQuickActionForFile with plugin + WO TFile + fav', () => {
    const task = makeTask('ready');
    const fav = { id: 'a', name: 'Fav A', prompt: 'p' };
    const woFile = Object.assign(Object.create(TFile.prototype), { path: 'Agent Board/tasks/wo-1.md' });
    const plugin = makePlugin({ favorites: [fav], woFile });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
    // index 0 = Open note, 1 = picker, 2 = <sep>, 3 = Fav A
    const favItem = menu.items[3] as { clickHandler?: () => void };
    favItem.clickHandler?.();

    expect(runQuickActionForFile).toHaveBeenCalledWith(plugin, woFile, fav);
  });

  it('case 11: clicking the picker entry invokes openContextMenuQuickAction with plugin + WO TFile', () => {
    const task = makeTask('ready');
    const woFile = Object.assign(Object.create(TFile.prototype), { path: 'Agent Board/tasks/wo-1.md' });
    const plugin = makePlugin({ favorites: [], woFile });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
    // index 0 = Open note, 1 = picker (picker now sits in the top section with
    // no separator before it)
    const pickerItem = menu.items[1] as { clickHandler?: () => void };
    pickerItem.clickHandler?.();

    expect(openContextMenuQuickAction).toHaveBeenCalledWith(plugin, woFile);
  });

  it('case 12: showAtMouseEvent is called exactly once at the end', () => {
    const task = makeTask('ready');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
    expect(menu.showAtMouseEvent).toHaveBeenCalledTimes(1);
    expect(menu.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
  });

  it('case 13: clicking Open note invokes onOpenNote(task)', () => {
    const task = makeTask('ready');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin});

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
    // index 0 = Open note
    const openNoteItem = menu.items[0] as { clickHandler?: () => void };
    openNoteItem.clickHandler?.();

    expect(deps.onOpenNote).toHaveBeenCalledTimes(1);
    expect(deps.onOpenNote).toHaveBeenCalledWith(task);
    expect(deps.onOpenConversation).not.toHaveBeenCalled();
  });

  it('case 14: clicking Open conversation invokes onOpenConversation(task)', () => {
    const task = makeTask('ready', 'conv-1');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({
      plugin,
      canOpenConversation: jest.fn(() => true),
    });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
    // index 0 = Open note, index 1 = Open conversation
    const openConvItem = menu.items[1] as { clickHandler?: () => void };
    openConvItem.clickHandler?.();

    expect(deps.onOpenConversation).toHaveBeenCalledTimes(1);
    expect(deps.onOpenConversation).toHaveBeenCalledWith(task);
    expect(deps.onOpenNote).not.toHaveBeenCalled();
  });

  it('case 15: WO path resolves to a non-TFile (e.g. TFolder collision) → quick-action block hidden', () => {
    const task = makeTask('ready');
    // A plain object that is NOT on `TFile.prototype` (mimics a folder
    // colliding on the WO path, or any non-file abstract). The helper guards
    // via `instanceof TFile`, so favorites + picker must stay hidden.
    const fakeFolder = { path: 'Agent Board/tasks/wo-1.md' };
    const plugin = makePlugin({
      woFile: fakeFolder,
      favorites: [{ id: 'a', name: 'Fav A', prompt: 'p' }],
    });
    const deps = makeDeps({ plugin });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual(['tasks.board.contextMenu.openNote']);
    expect(MenuMock.instances[0].showAtMouseEvent).toHaveBeenCalledTimes(1);
  });

  it('case 16: status done, no favs → Archive item appended directly under picker (no separators)', () => {
    const task = makeTask('done');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'quickActions.contextMenu.title',
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

  it('case 21: status inbox, no favs → Archive + Delete appended at the bottom', () => {
    const task = makeTask('inbox');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'quickActions.contextMenu.title',
      'tasks.board.contextMenu.archive',
      'tasks.board.contextMenu.delete',
    ]);
  });

  it('case 22: clicking Archive (done, no favs) invokes onArchive(task)', () => {
    const task = makeTask('done');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
    // index 0 = Open note, 1 = picker, 2 = Archive
    const archiveItem = menu.items[2] as { clickHandler?: () => void };
    archiveItem.clickHandler?.();

    expect(deps.onArchive).toHaveBeenCalledTimes(1);
    expect(deps.onArchive).toHaveBeenCalledWith(task);
  });

  it('case 23: status inbox + 2 favs → favs section sits between top and bottom sections', () => {
    const task = makeTask('inbox');
    const plugin = makePlugin({
      favorites: [
        { id: 'a', name: 'Fav A', prompt: 'p' },
        { id: 'b', name: 'Fav B', prompt: 'p' },
      ],
    });
    const deps = makeDeps({ plugin });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'quickActions.contextMenu.title',
      '<sep>',
      'Fav A',
      'Fav B',
      '<sep>',
      'tasks.board.contextMenu.archive',
      'tasks.board.contextMenu.delete',
    ]);
  });

  it('case 24: clicking Delete (inbox, no favs) invokes onDelete(task)', () => {
    const task = makeTask('inbox');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
    // index 0 = Open note, 1 = picker, 2 = Archive, 3 = Delete
    const deleteItem = menu.items[3] as { clickHandler?: () => void };
    deleteItem.clickHandler?.();

    expect(deps.onDelete).toHaveBeenCalledTimes(1);
    expect(deps.onDelete).toHaveBeenCalledWith(task);
    expect(deps.onArchive).not.toHaveBeenCalled();
  });

  it('case 25: status done → Delete item absent (terminal status archives only)', () => {
    const task = makeTask('done');
    const plugin = makePlugin({ favorites: [] });
    const deps = makeDeps({ plugin });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).not.toContain('tasks.board.contextMenu.delete');
  });
});
