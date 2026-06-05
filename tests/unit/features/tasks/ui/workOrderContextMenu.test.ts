/**
 * @jest-environment jsdom
 */
import { Menu, TFile } from 'obsidian';

import type { TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';
import { showWorkOrderContextMenu } from '@/features/tasks/ui/workOrderContextMenu';

// `MENU_SEPARATOR` only exists on the obsidian mock (real obsidian exports the
// `MenuSeparator` class instead). The `jest.requireActual('obsidian')` + cast
// bridge mirrors the pattern used by other obsidian-mock-dependent tests
// (e.g. tests/unit/features/chat/ui/FileContextManager.test.ts).
const { MENU_SEPARATOR } = jest.requireActual('obsidian') as { MENU_SEPARATOR: symbol };
type MockMenu = Menu & { items: Array<{ setTitle: jest.Mock; clickHandler?: () => void } | symbol> };
const MenuMock = Menu as typeof Menu & { instances: MockMenu[] };

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

function titles(menu: MockMenu): string[] {
  return menu.items.map((entry) => {
    if (entry === MENU_SEPARATOR) return '<sep>';
    const item = entry as { setTitle: jest.Mock };
    const calls = item.setTitle.mock.calls;
    return calls.length > 0 ? String(calls[0][0]) : '';
  });
}

const mouseEvent = new MouseEvent('contextmenu');

beforeEach(() => {
  MenuMock.instances.length = 0;
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

    const menu = MenuMock.instances[0];
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

    expect(titles(MenuMock.instances[0])).toEqual([
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

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'tasks.board.contextMenu.openConversation',
    ]);
  });

  it('case 4: running, no conv → Open note only', () => {
    const task = makeTask('running');
    const plugin = makePlugin({ favorites: [{ id: 'a', name: 'A', prompt: 'p' }] });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual(['tasks.board.contextMenu.openNote']);
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

    expect(titles(MenuMock.instances[0])).toEqual([
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

    expect(titles(MenuMock.instances[0])).toEqual([
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

    expect(titles(MenuMock.instances[0])).toEqual([
      'tasks.board.contextMenu.openNote',
      'tasks.board.contextMenu.openConversation',
    ]);
  });

  it('case 8: quickActionFavoritesCache undefined, ready, WO resolvable → Open note, sep, picker', () => {
    const task = makeTask('ready');
    const plugin = makePlugin({ hasFavoritesCache: false });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    expect(titles(MenuMock.instances[0])).toEqual([
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

    expect(titles(MenuMock.instances[0])).not.toContain('tasks.board.contextMenu.openConversation');
    expect(deps.canOpenConversation).toHaveBeenCalledWith(task);
  });

  it('case 10: clicking a favorite invokes runQuickActionForFile with plugin + WO TFile + fav', () => {
    const task = makeTask('ready');
    const fav = { id: 'a', name: 'Fav A', prompt: 'p' };
    const woFile = Object.assign(Object.create(TFile.prototype), { path: 'Agent Board/tasks/wo-1.md' });
    const plugin = makePlugin({ favorites: [fav], woFile });
    const deps = makeDeps({ plugin: plugin as never });

    showWorkOrderContextMenu(task, mouseEvent, deps);

    const menu = MenuMock.instances[0];
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

    const menu = MenuMock.instances[0];
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

    const menu = MenuMock.instances[0];
    expect(menu.showAtMouseEvent).toHaveBeenCalledTimes(1);
    expect(menu.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
  });
});
