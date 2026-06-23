/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

import type { App} from 'obsidian';
import { Notice } from 'obsidian';

import { EventBus } from '@/core/events/EventBus';
import type { UsageEventMap } from '@/core/usage/events';
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

jest.mock('@/features/quickActions/ui/UsageStatsTab', () => ({
  UsageStatsTab: jest.fn().mockImplementation(() => ({
    render: jest.fn(),
    dispose: jest.fn(),
  })),
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
    hasConfiguredFolder: jest.fn().mockReturnValue(true),
  } as unknown as QuickActionStorage;
}

// The favorites suite exercises the Quick Actions tab, but the modal shell
// requires Skills tab dependencies too — supply inert stand-ins so the
// favorites assertions stay focused on the Quick Actions tab.
const NOOP_AGGREGATOR: VaultSkillSource = {
  listAll: jest.fn().mockResolvedValue([]),
  listCachedNow: jest.fn().mockReturnValue([]),
  listAllStreaming: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn(),
  dispose: jest.fn(),
};
const NOOP_ON_RUN_SKILL = jest.fn();
const NOOP_ON_EDIT_SKILL = jest.fn();
const NOOP_USAGE_TRACKER = null;
const NOOP_EVENTS: EventBus<UsageEventMap> = new EventBus<UsageEventMap>();

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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const names = Array.from(modal['contentEl'].querySelectorAll('.specorator-quick-action-row strong'))
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const buttons = modal['contentEl'].querySelectorAll('.specorator-quick-action-favorite');
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.specorator-quick-action-favorite') as HTMLButtonElement;
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const stars = modal['contentEl'].querySelectorAll('.specorator-quick-action-favorite');
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.specorator-quick-action-favorite') as HTMLButtonElement;
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.specorator-quick-action-favorite') as HTMLButtonElement;
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.specorator-quick-action-favorite') as HTMLButtonElement;
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const star = modal['contentEl'].querySelector('.specorator-quick-action-favorite') as HTMLButtonElement;
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const stars = modal['contentEl'].querySelectorAll('.specorator-quick-action-favorite');
    const newStar = stars[stars.length - 1] as HTMLButtonElement;
    newStar.click();
    await flush();

    expect(onFavoritesChanged).not.toHaveBeenCalled();
  });

  it('calls onFavoritesChanged after deleting an action', async () => {
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const deleteButtons = Array.from(
      modal['contentEl'].querySelectorAll('.specorator-quick-action-actions button'),
    ).filter((b: any) => b.textContent === 'common.delete' || b.textContent === 'Delete');
    (deleteButtons[0] as HTMLButtonElement).click();
    await flush();

    expect(onFavoritesChanged).toHaveBeenCalled();
  });

  it('does not call onFavoritesChanged when delete fails', async () => {
    const onFavoritesChanged = jest.fn();
    const storage = makeStorage([
      makeAction({ name: 'A', favorite: true, favoriteRank: 1, filePath: 'Quick Actions/a.md' }),
    ]);
    (storage.delete as jest.Mock).mockRejectedValueOnce(new Error('vault locked'));
    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
      onFavoritesChanged,
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const deleteButtons = Array.from(
      modal['contentEl'].querySelectorAll('.specorator-quick-action-actions button'),
    ).filter((b: any) => b.textContent === 'common.delete' || b.textContent === 'Delete');
    (deleteButtons[0] as HTMLButtonElement).click();
    await flush();

    expect(onFavoritesChanged).not.toHaveBeenCalled();
  });

  it('serializes concurrent toggles so two rapid stars do not pick the same rank', async () => {
    // 4 favorites already exist with ranks 1-4. User clicks star on two
    // different non-favorite rows back-to-back. Without serialization, both
    // handlers would read the same stale this.actions and both pick rank 5.
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstSave = new Promise<void>((r) => { resolveFirst = r; });
    const secondSave = new Promise<void>((r) => { resolveSecond = r; });

    const setFavorite = jest.fn()
      .mockImplementationOnce(() => firstSave)
      .mockImplementationOnce(() => secondSave);

    const storage = {
      loadAll: jest.fn().mockResolvedValue([
        ...[1, 2, 3, 4].map((r) =>
          makeAction({ name: `F${r}`, favorite: true, favoriteRank: r, filePath: `Quick Actions/f${r}.md` }),
        ),
        makeAction({ name: 'X', filePath: 'Quick Actions/x.md' }),
        makeAction({ name: 'Y', filePath: 'Quick Actions/y.md' }),
      ]),
      save: jest.fn().mockResolvedValue('Quick Actions/x.md'),
      delete: jest.fn().mockResolvedValue(undefined),
      setFavorite,
      unsetFavorite: jest.fn().mockResolvedValue(undefined),
    } as unknown as QuickActionStorage;

    const modal = new QuickActionsModal({} as App, {
      storage,
      onRun: jest.fn(),
      onRunSkill: NOOP_ON_RUN_SKILL, onEditSkill: NOOP_ON_EDIT_SKILL,
      aggregator: NOOP_AGGREGATOR,
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    const stars = Array.from(
      modal['contentEl'].querySelectorAll('.specorator-quick-action-favorite'),
    ) as HTMLButtonElement[];
    // F1..F4 are filled (4 stars), X and Y are outline (2 more). Click the
    // last two — X and Y.
    const xStar = stars[stars.length - 2];
    const yStar = stars[stars.length - 1];

    xStar.click();
    yStar.click();
    await flush();

    // Only the first call should have happened so far; the second is queued.
    expect(setFavorite).toHaveBeenCalledTimes(1);
    expect(setFavorite).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'X' }), 5);

    // After the first save resolves, refreshList reloads from storage. Make
    // the second loadAll return X as already favorited with rank 5 so the
    // second toggle's assignNextFavoriteRank sees 5/5 used and returns null.
    (storage.loadAll as jest.Mock).mockResolvedValueOnce([
      ...[1, 2, 3, 4].map((r) =>
        makeAction({ name: `F${r}`, favorite: true, favoriteRank: r, filePath: `Quick Actions/f${r}.md` }),
      ),
      makeAction({ name: 'X', favorite: true, favoriteRank: 5, filePath: 'Quick Actions/x.md' }),
      makeAction({ name: 'Y', filePath: 'Quick Actions/y.md' }),
    ]);
    resolveFirst();
    await flush();
    await flush();
    await flush();

    // Second toggle ran AFTER first's refresh. It saw 5/5 favorites and
    // showed the limit notice without calling setFavorite a second time.
    expect(setFavorite).toHaveBeenCalledTimes(1);
    expect(Notice).toHaveBeenCalledWith('quickActions.modal.favoriteLimitReached');
    expect(yStar.disabled).toBe(false);

    // Avoid unused-variable lint for resolveSecond — second save never runs.
    void resolveSecond;
  });

  it('calls onFavoritesChanged after editor onSave resolves successfully', async () => {
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
      usageTracker: NOOP_USAGE_TRACKER,
      events: NOOP_EVENTS,
    });
    modal.open();
    await flush();

    // Invoke the editor onSave callback directly to simulate a successful edit.
    let capturedOnSave: ((action: QuickAction) => Promise<void>) | null = null;
    const { QuickActionEditorModal } = jest.requireMock(
      '@/features/quickActions/ui/QuickActionEditorModal',
    );
    // Replace the constructor to capture the onSave callback for this test.
    const originalCtor = QuickActionEditorModal;
    (jest.requireMock('@/features/quickActions/ui/QuickActionEditorModal') as any)
      .QuickActionEditorModal = class {
      constructor(_app: any, _existing: any, onSave: any) {
        capturedOnSave = onSave;
      }
      open() {}
    };

    try {
      (modal as any).openEditor(null);
      expect(capturedOnSave).not.toBeNull();
      await capturedOnSave!(makeAction({ name: 'NewAction', filePath: 'Quick Actions/new.md' }));
      await flush();

      expect(onFavoritesChanged).toHaveBeenCalled();
    } finally {
      (jest.requireMock('@/features/quickActions/ui/QuickActionEditorModal') as any)
        .QuickActionEditorModal = originalCtor;
    }
  });
});
