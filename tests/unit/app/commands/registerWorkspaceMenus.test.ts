import type { Editor, Menu, MenuItem, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { registerWorkspaceMenus } from '@/app/commands/registerWorkspaceMenus';
import type { QuickActionFavoritesCache } from '@/features/quickActions/QuickActionFavoritesCache';
import { runQuickActionForFile } from '@/features/quickActions/runQuickActionForFile';
import type { QuickAction } from '@/features/quickActions/types';
import type ClaudianPlugin from '@/main';

const { MENU_SEPARATOR } = jest.requireActual('obsidian') as { MENU_SEPARATOR: symbol };

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      'quickActions.contextMenu.title': 'Open Quick Actions',
    };
    return map[key] ?? key;
  },
}));

jest.mock('@/features/quickActions/openContextMenuQuickAction', () => ({
  openContextMenuQuickAction: jest.fn(),
}));

jest.mock('@/features/quickActions/runQuickActionForFile', () => ({
  runQuickActionForFile: jest.fn().mockResolvedValue(undefined),
}));

type FileMenuHandler = (menu: Menu, file: TAbstractFile) => void;
type EditorMenuHandler = (menu: Menu, editor: Editor) => void;

function createMenuItem(): MenuItem {
  const item = {
    setTitle: jest.fn().mockReturnThis(),
    setIcon: jest.fn().mockReturnThis(),
    onClick: jest.fn().mockReturnThis(),
  };
  return item as unknown as MenuItem;
}

function createMenu(): { menu: Menu; items: Array<MenuItem | symbol> } {
  const items: Array<MenuItem | symbol> = [];
  const menu = {
    addItem: jest.fn((cb: (item: MenuItem) => void) => {
      const item = createMenuItem();
      items.push(item);
      cb(item);
      return menu;
    }),
    addSeparator: jest.fn(() => {
      items.push(MENU_SEPARATOR);
      return menu;
    }),
  } as unknown as Menu;
  return { menu, items };
}

function isMenuItem(entry: MenuItem | symbol): entry is MenuItem {
  return entry !== MENU_SEPARATOR;
}

function titles(items: Array<MenuItem | symbol>): string[] {
  return items.map((entry) => {
    if (entry === MENU_SEPARATOR) return '<sep>';
    if (!isMenuItem(entry)) return '';
    const calls = (entry.setTitle as jest.Mock).mock.calls;
    return calls.length > 0 ? String(calls[0][0]) : '';
  });
}

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

describe('registerWorkspaceMenus', () => {
  beforeEach(() => {
    (runQuickActionForFile as jest.Mock).mockClear();
  });

  it('registers both file-menu and editor-menu handlers', () => {
    const { plugin } = createPlugin();
    registerWorkspaceMenus(plugin);
    expect((plugin.app.workspace.on as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      'file-menu',
      'editor-menu',
    ]);
    expect(plugin.registerEvent).toHaveBeenCalledTimes(2);
  });

  it('adds separator-bracketed Claudian chat, work-order, and quick-actions items for TFile entries', () => {
    const { plugin, fileMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);
    expect(titles(items)).toEqual([
      '<sep>',
      'Add file to Claudian chat',
      'Create work order',
      'Open Quick Actions',
      '<sep>',
    ]);
  });

  it('adds separator-bracketed folder, work-order, and quick-actions items for TFolder entries', () => {
    const { plugin, fileMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const folder = Object.create(TFolder.prototype) as TFolder;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, folder);
    expect(titles(items)).toEqual([
      '<sep>',
      'Add folder to Claudian chat',
      'Create work order',
      'Open Quick Actions',
      '<sep>',
    ]);
  });

  it('skips editor-menu item when selection is empty', () => {
    const { plugin, editorMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const editor = { getSelection: () => '   ' } as unknown as Editor;
    const { menu, items } = createMenu();
    editorMenu.handler!(menu, editor);
    expect(items).toHaveLength(0);
  });

  it('adds editor-menu item when selection is non-empty', () => {
    const { plugin, editorMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const editor = { getSelection: () => 'hello' } as unknown as Editor;
    const { menu, items } = createMenu();
    editorMenu.handler!(menu, editor);
    expect(items).toHaveLength(1);
    const item = items[0] as MenuItem;
    expect((item.setTitle as jest.Mock)).toHaveBeenCalledWith(
      'Create work order from selection',
    );
  });

  it('injects favorite items below the "Open Quick Actions" entry for files', () => {
    const favs: QuickAction[] = [
      { id: 'a', name: 'Refactor', description: 'Refactor', prompt: 'Refactor.', filePath: 'Quick Actions/refactor.md', favorite: true, favoriteRank: 1 },
      { id: 'b', name: 'Summarize', description: 'Summarize', prompt: 'Summarize.', filePath: 'Quick Actions/summarize.md', favorite: true, favoriteRank: 2 },
    ];
    const { plugin, fileMenu } = createPlugin(favs);
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);

    expect(titles(items)).toEqual([
      '<sep>',
      'Add file to Claudian chat',
      'Create work order',
      'Open Quick Actions',
      'Refactor',
      'Summarize',
      '<sep>',
    ]);
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

    const favItem = items[4] as MenuItem;
    const onClickCall = (favItem.onClick as jest.Mock).mock.calls[0]?.[0];
    expect(typeof onClickCall).toBe('function');
    onClickCall();
    expect(runQuickActionForFile).toHaveBeenCalledWith(plugin, file, favs[0]);
  });

  it('omits favorite items when the cache is not present', () => {
    const { plugin, fileMenu } = createPlugin();
    (plugin as unknown as { quickActionFavoritesCache: undefined }).quickActionFavoritesCache = undefined;
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);
    expect(titles(items)).toEqual([
      '<sep>',
      'Add file to Claudian chat',
      'Create work order',
      'Open Quick Actions',
      '<sep>',
    ]);
  });
});
