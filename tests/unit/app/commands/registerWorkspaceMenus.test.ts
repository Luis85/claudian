import type { Editor, Menu, MenuItem, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { registerWorkspaceMenus } from '@/app/commands/registerWorkspaceMenus';
import type ClaudianPlugin from '@/main';

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

function createMenu(): { menu: Menu; items: MenuItem[] } {
  const items: MenuItem[] = [];
  const menu = {
    addItem: jest.fn((cb: (item: MenuItem) => void) => {
      const item = createMenuItem();
      items.push(item);
      cb(item);
      return menu;
    }),
  } as unknown as Menu;
  return { menu, items };
}

function createPlugin(): {
  plugin: ClaudianPlugin;
  fileMenu: { handler: FileMenuHandler | null };
  editorMenu: { handler: EditorMenuHandler | null };
} {
  const fileMenu: { handler: FileMenuHandler | null } = { handler: null };
  const editorMenu: { handler: EditorMenuHandler | null } = { handler: null };
  const plugin = {
    registerEvent: jest.fn((_evtRef: unknown) => undefined),
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
  return { plugin, fileMenu, editorMenu };
}

describe('registerWorkspaceMenus', () => {
  it('registers both file-menu and editor-menu handlers', () => {
    const { plugin } = createPlugin();
    registerWorkspaceMenus(plugin);
    expect((plugin.app.workspace.on as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      'file-menu',
      'editor-menu',
    ]);
    expect(plugin.registerEvent).toHaveBeenCalledTimes(2);
  });

  it('adds Claudian chat + work-order items for TFile entries', () => {
    const { plugin, fileMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const file = Object.create(TFile.prototype) as TFile;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, file);
    expect(items).toHaveLength(2);
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith('Add file to Claudian chat');
    expect((items[1].setTitle as jest.Mock)).toHaveBeenCalledWith('Create work order');
  });

  it('adds folder + work-order items for TFolder entries', () => {
    const { plugin, fileMenu } = createPlugin();
    registerWorkspaceMenus(plugin);
    const folder = Object.create(TFolder.prototype) as TFolder;
    const { menu, items } = createMenu();
    fileMenu.handler!(menu, folder);
    expect(items).toHaveLength(2);
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith('Add folder to Claudian chat');
    expect((items[1].setTitle as jest.Mock)).toHaveBeenCalledWith('Create work order');
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
    expect((items[0].setTitle as jest.Mock)).toHaveBeenCalledWith(
      'Create work order from selection',
    );
  });
});
