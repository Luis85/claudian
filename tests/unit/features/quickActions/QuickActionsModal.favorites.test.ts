/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

import type { App} from 'obsidian';
import { Notice } from 'obsidian';

import type { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { VaultSkillSource } from '@/features/quickActions/skills/types';
import type { QuickAction } from '@/features/quickActions/types';
import { QuickActionsModal } from '@/features/quickActions/ui/QuickActionsModal';

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

// The favorites suite exercises the Quick Actions tab, but the modal shell
// requires Skills tab dependencies too — supply inert stand-ins so the
// favorites assertions stay focused on the Quick Actions tab.
const NOOP_AGGREGATOR: VaultSkillSource = {
  listAll: jest.fn().mockResolvedValue([]),
};
const NOOP_ON_RUN_SKILL = jest.fn();
const NOOP_ON_EDIT_SKILL = jest.fn();

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => jest.clearAllMocks());

describe('QuickActionsModal favorites', () => {
  it('renders favorites group above non-favorites, sorted by rank', async () => {
    const storage = makeStorage([
      makeAction({ name: 'Zebra' }),
      makeAction({ name: 'B', favorite: true, favoriteRank: 2 }),
      makeAction({ name: 'A', favorite: true, favoriteRank: 1 }),
    ]);
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
    });
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
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
    });
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
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
    });
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
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
    });
    modal.open();
    await flush();

    const stars = modal['contentEl'].querySelectorAll('.claudian-quick-action-favorite');
    const newStar = stars[stars.length - 1] as HTMLButtonElement;
    newStar.click();
    await flush();

    expect(Notice).toHaveBeenCalledWith('quickActions.modal.favoriteLimitReached');
    expect((storage.setFavorite as jest.Mock)).not.toHaveBeenCalled();
  });

  it('Enter runs the visually-first favorite when unfiltered', async () => {
    const onRun = jest.fn();
    const storage = makeStorage([
      makeAction({ name: 'Zebra', filePath: 'Quick Actions/zebra.md' }),
      makeAction({ name: 'B', favorite: true, favoriteRank: 2, filePath: 'Quick Actions/b.md' }),
      makeAction({ name: 'A', favorite: true, favoriteRank: 1, filePath: 'Quick Actions/a.md' }),
    ]);
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun,
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
    });
    modal.open();
    await flush();

    (modal as any).runFirstMatch();

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ name: 'A' }));
  });

  it('shows save-failed notice when setFavorite rejects', async () => {
    const storage = makeStorage([
      makeAction({ name: 'B', filePath: 'Quick Actions/b.md' }),
    ]);
    (storage.setFavorite as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.claudian-quick-action-favorite') as HTMLButtonElement;
    star.click();
    await flush();

    expect(Notice).toHaveBeenCalledWith('quickActions.editor.saveFailed');
  });

  it('calls onFavoritesChanged after starring an action', async () => {
    const onFavoritesChanged = jest.fn();
    const storage = makeStorage([
      makeAction({ name: 'B', filePath: 'Quick Actions/b.md' }),
    ]);
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
      onFavoritesChanged,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.claudian-quick-action-favorite') as HTMLButtonElement;
    star.click();
    await flush();

    expect(onFavoritesChanged).toHaveBeenCalledTimes(1);
  });

  it('calls onFavoritesChanged after unstarring an action', async () => {
    const onFavoritesChanged = jest.fn();
    const storage = makeStorage([
      makeAction({ name: 'A', favorite: true, favoriteRank: 1, filePath: 'Quick Actions/a.md' }),
    ]);
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
      onFavoritesChanged,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.claudian-quick-action-favorite') as HTMLButtonElement;
    star.click();
    await flush();

    expect(onFavoritesChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onFavoritesChanged when the storage call fails', async () => {
    const onFavoritesChanged = jest.fn();
    const storage = makeStorage([
      makeAction({ name: 'B', filePath: 'Quick Actions/b.md' }),
    ]);
    (storage.setFavorite as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
      onFavoritesChanged,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.claudian-quick-action-favorite') as HTMLButtonElement;
    star.click();
    await flush();

    expect(onFavoritesChanged).not.toHaveBeenCalled();
  });

  it('does not call onFavoritesChanged when the 5-fav limit is reached', async () => {
    const onFavoritesChanged = jest.fn();
    const storage = makeStorage([
      ...[1, 2, 3, 4, 5].map((r) =>
        makeAction({ name: `F${r}`, favorite: true, favoriteRank: r, filePath: `Quick Actions/f${r}.md` }),
      ),
      makeAction({ name: 'New', filePath: 'Quick Actions/new.md' }),
    ]);
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
      onFavoritesChanged,
    });
    modal.open();
    await flush();

    const stars = modal['contentEl'].querySelectorAll('.claudian-quick-action-favorite');
    const newStar = stars[stars.length - 1] as HTMLButtonElement;
    newStar.click();
    await flush();

    expect(onFavoritesChanged).not.toHaveBeenCalled();
  });
});
