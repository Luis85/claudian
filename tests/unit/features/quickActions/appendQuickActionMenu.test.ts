import { appendQuickActionFavoritesAndPicker } from '@/features/quickActions/appendQuickActionMenu';

const launchMock = jest.fn();
jest.mock('@/features/quickActions/launchQuickAction', () => ({
  launchQuickAction: (...args: unknown[]) => launchMock(...args),
}));

jest.mock('@/features/quickActions/openContextMenuQuickAction', () => ({
  openContextMenuQuickAction: jest.fn(),
}));

jest.mock('@/i18n/i18n', () => ({ t: (k: string) => k }));

class MockMenu {
  items: Array<{ title?: string; icon?: string; clickHandler?: () => void }> = [];
  addItem(cb: (item: any) => void): this {
    const item: any = {};
    item.setTitle = (title: string) => { item.title = title; return item; };
    item.setIcon = (icon: string) => { item.icon = icon; return item; };
    item.onClick = (h: () => void) => { item.clickHandler = h; return item; };
    cb(item);
    this.items.push(item);
    return this;
  }
}

beforeEach(() => jest.clearAllMocks());

describe('appendQuickActionFavoritesAndPicker', () => {
  it('favorite click delegates to launchQuickAction', () => {
    const menu = new MockMenu();
    const plugin = {
      quickActionFavoritesCache: {
        getFavorites: () => [
          { id: 'a', name: 'Fav', description: '', prompt: '', filePath: 'qa/fav.md' },
        ],
      },
    } as any;
    const file = { path: 'note.md' } as any;
    appendQuickActionFavoritesAndPicker(menu as any, plugin, file);
    const favItem = menu.items[1];
    favItem.clickHandler?.();
    expect(launchMock).toHaveBeenCalledWith(
      plugin,
      file,
      expect.objectContaining({ name: 'Fav' }),
    );
  });

  it('picker item still delegates to openContextMenuQuickAction', () => {
    const { openContextMenuQuickAction } = jest.requireMock(
      '@/features/quickActions/openContextMenuQuickAction',
    );
    const menu = new MockMenu();
    const plugin = {
      quickActionFavoritesCache: { getFavorites: () => [] },
    } as any;
    const file = { path: 'note.md' } as any;
    appendQuickActionFavoritesAndPicker(menu as any, plugin, file);
    menu.items[0].clickHandler?.();
    expect(openContextMenuQuickAction).toHaveBeenCalledWith(plugin, file);
  });

  it('no-ops cleanly when quickActionFavoritesCache is undefined', () => {
    const menu = new MockMenu();
    const plugin = {} as any;
    const file = { path: 'note.md' } as any;
    appendQuickActionFavoritesAndPicker(menu as any, plugin, file);
    // Picker entry still appended.
    expect(menu.items).toHaveLength(1);
  });

  it('appends favorites in the order returned by getFavorites()', () => {
    const menu = new MockMenu();
    const plugin = {
      quickActionFavoritesCache: {
        getFavorites: () => [
          { id: '1', name: 'First',  description: '', prompt: '', filePath: 'qa/first.md' },
          { id: '2', name: 'Second', description: '', prompt: '', filePath: 'qa/second.md' },
          { id: '3', name: 'Third',  description: '', prompt: '', filePath: 'qa/third.md' },
        ],
      },
    } as any;
    const file = { path: 'note.md' } as any;
    appendQuickActionFavoritesAndPicker(menu as any, plugin, file);
    // menu.items[0] is the picker; menu.items[1..3] are favorites in order.
    expect(menu.items[1].title).toBe('First');
    expect(menu.items[2].title).toBe('Second');
    expect(menu.items[3].title).toBe('Third');
  });
});
