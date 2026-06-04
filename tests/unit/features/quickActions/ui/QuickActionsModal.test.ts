/**
 * @jest-environment jsdom
 */
import type { SkillTabEntry } from '@/features/quickActions/skills/types';
import type { QuickAction } from '@/features/quickActions/types';
import type { QuickActionsModalCallbacks } from '@/features/quickActions/ui/QuickActionsModal';
import { QuickActionsModal } from '@/features/quickActions/ui/QuickActionsModal';

type ElementOpts = {
  cls?: string | string[];
  text?: string;
  type?: string;
  attr?: Record<string, string>;
};

function decorate<T extends HTMLElement>(el: T): T {
  const decorated = el as unknown as Record<string, unknown> & T;
  decorated.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  decorated.addClass = function (this: HTMLElement, ...names: string[]) {
    for (const name of names) this.classList.add(name);
  };
  decorated.removeClass = function (this: HTMLElement, ...names: string[]) {
    for (const name of names) this.classList.remove(name);
  };
  decorated.createDiv = function (
    this: HTMLElement,
    options?: string | ElementOpts,
  ) {
    return appendChild(this, document.createElement('div'), options);
  };
  decorated.createEl = function <K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    options?: ElementOpts,
  ) {
    return appendChild(this, document.createElement(tag), options);
  };
  decorated.createSpan = function (
    this: HTMLElement,
    options?: string | ElementOpts,
  ) {
    return appendChild(this, document.createElement('span'), options);
  };
  return decorated as T;
}

function appendChild<T extends HTMLElement>(
  parent: HTMLElement,
  child: T,
  options?: string | ElementOpts,
): T {
  if (typeof options === 'string') {
    child.className = options;
  } else if (options) {
    if (options.cls) {
      const cls = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
      child.className = cls;
    }
    if (options.text !== undefined) child.textContent = options.text;
    if (options.type && 'type' in child) (child as unknown as HTMLInputElement).type = options.type;
    if (options.attr) {
      for (const [k, v] of Object.entries(options.attr)) child.setAttribute(k, v);
    }
  }
  parent.appendChild(child);
  return decorate(child);
}

jest.mock('obsidian', () => {
  class Modal {
    app: unknown;
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    onOpen?: () => void;
    constructor(app: unknown) {
      this.app = app;
      this.modalEl = decorate(document.createElement('div'));
      this.contentEl = decorate(document.createElement('div'));
    }
    setTitle = jest.fn();
    open = jest.fn(function (this: Modal) {
      this.onOpen?.();
    });
    close = jest.fn();
  }
  return {
    Modal,
    Notice: jest.fn(),
    setIcon: jest.fn(),
  };
});

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/features/quickActions/ui/QuickActionEditorModal', () => ({
  QuickActionEditorModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

function makeStorage(actions: QuickAction[] = []) {
  return {
    loadAll: jest.fn().mockResolvedValue(actions),
    save: jest.fn().mockResolvedValue(''),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as QuickActionsModalCallbacks['storage'];
}

function makeAggregator(entries: SkillTabEntry[] = []) {
  return {
    listAll: jest.fn().mockResolvedValue(entries),
    listCachedNow: jest.fn().mockReturnValue(entries),
    listAllStreaming: jest
      .fn()
      .mockImplementation(
        (
          onProviderResolved: (providerId: string, entries: SkillTabEntry[]) => void,
        ) => {
          // Group entries by providerId and dispatch one callback per provider so
          // the streaming refresh path is exercised the same way it is at runtime.
          const byProvider = new Map<string, SkillTabEntry[]>();
          for (const entry of entries) {
            const bucket = byProvider.get(entry.providerId) ?? [];
            bucket.push(entry);
            byProvider.set(entry.providerId, bucket);
          }
          for (const [providerId, bucket] of byProvider) {
            onProviderResolved(providerId, bucket);
          }
          return Promise.resolve();
        },
      ),
    invalidate: jest.fn(),
    dispose: jest.fn(),
  } as unknown as QuickActionsModalCallbacks['aggregator'];
}

function makeSkill(overrides: Partial<SkillTabEntry> = {}): SkillTabEntry {
  return {
    id: 'claude:skill-tdd',
    providerId: 'claude',
    providerDisplayName: 'Claude',
    name: 'tdd',
    description: 'red-green-refactor',
    insertPrefix: '/',
    sourceFilePath: '.claude/skills/tdd/SKILL.md',
    providerEnabled: true,
    ...overrides,
  };
}

async function openModal(
  overrides: Partial<QuickActionsModalCallbacks> = {},
): Promise<{ modal: QuickActionsModal; callbacks: QuickActionsModalCallbacks }> {
  const callbacks: QuickActionsModalCallbacks = {
    onRun: jest.fn(),
    onRunSkill: jest.fn(),
    onEditSkill: jest.fn(),
    storage: makeStorage(),
    aggregator: makeAggregator(),
    ...overrides,
  };
  const modal = new QuickActionsModal({} as never, callbacks);
  modal.open();
  await new Promise((r) => setTimeout(r, 0));
  return { modal, callbacks };
}

describe('QuickActionsModal tabs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders Quick Actions and Skills tabs with Quick Actions selected by default', async () => {
    const { modal } = await openModal();
    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].classList.contains('is-active')).toBe(true);
    expect(tabs[0].textContent).toBe('quickActions.modal.tabs.quickActions');
    expect(tabs[1].textContent).toBe('quickActions.modal.tabs.skills');
  });

  it('switching to Skills tab triggers aggregator and renders skill rows', async () => {
    const aggregator = makeAggregator([makeSkill({ name: 'brainstorming' })]);
    const { modal } = await openModal({ aggregator });

    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    // Phase A: instant paint reads from the in-memory cache; Phase B streams
    // a background refresh. The renderer no longer calls listAll().
    expect(
      (aggregator as unknown as { listCachedNow: jest.Mock }).listCachedNow,
    ).toHaveBeenCalled();
    expect(
      (aggregator as unknown as { listAllStreaming: jest.Mock }).listAllStreaming,
    ).toHaveBeenCalled();
    const skillRow = modal.contentEl.querySelector(
      '.claudian-quick-actions-skill-row:not(.is-skeleton)',
    );
    expect(skillRow).not.toBeNull();
    expect(skillRow?.textContent).toContain('brainstorming');
  });

  it('groups skills by provider with header rows', async () => {
    const aggregator = makeAggregator([
      makeSkill({ id: 'claude:skill-a', providerId: 'claude', name: 'a' }),
      makeSkill({
        id: 'codex:codex-skill-b',
        providerId: 'codex',
        providerDisplayName: 'Codex',
        insertPrefix: '$',
        name: 'b',
      }),
    ]);
    const { modal } = await openModal({ aggregator });

    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const headers = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-provider-header',
    );
    expect(Array.from(headers).map((h) => h.textContent)).toEqual(['Claude', 'Codex']);
  });

  it('clicking a skill row fires onRunSkill and closes the modal', async () => {
    const aggregator = makeAggregator([makeSkill({ name: 'tdd' })]);
    const { modal, callbacks } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const row = modal.contentEl.querySelector(
      '.claudian-quick-actions-skill-row-main',
    ) as HTMLElement;
    row.click();

    expect(callbacks.onRunSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude:skill-tdd', name: 'tdd' }),
    );
    expect(modal.close).toHaveBeenCalled();
  });

  it('hides edit button when sourceFilePath is null', async () => {
    const aggregator = makeAggregator([
      makeSkill({ name: 'runtime', sourceFilePath: null }),
    ]);
    const { modal } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const edit = modal.contentEl.querySelector('.claudian-quick-actions-skill-edit');
    expect(edit).toBeNull();
  });

  it('applies disabled-provider modifier class', async () => {
    const aggregator = makeAggregator([makeSkill({ providerEnabled: false })]);
    const { modal } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const row = modal.contentEl.querySelector('.claudian-quick-actions-skill-row');
    expect(row?.classList.contains('is-provider-disabled')).toBe(true);
  });

  it('renders skeleton placeholders when the cache is cold and the stream has not yielded', async () => {
    // makeAggregator() returns no entries, so listCachedNow() yields []
    // and listAllStreaming() never fires onProviderResolved. The new SWR
    // design shows skeleton rows instead of an empty-state message.
    const { modal } = await openModal();
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const skeletonRows = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-skill-row.is-skeleton',
    );
    expect(skeletonRows.length).toBeGreaterThan(0);
  });

  it('renders the Edit button when sourceFilePath is set', async () => {
    const aggregator = makeAggregator([makeSkill({ name: 'tdd' })]);
    const { modal } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const edit = modal.contentEl.querySelector('.claudian-quick-actions-skill-edit');
    expect(edit).not.toBeNull();
    expect(edit?.textContent).toContain('quickActions.skills.editInSettings');
  });

  it('clicking the Edit button fires onEditSkill with the entry and closes the modal', async () => {
    const aggregator = makeAggregator([makeSkill({ name: 'tdd' })]);
    const { modal, callbacks } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const edit = modal.contentEl.querySelector(
      '.claudian-quick-actions-skill-edit',
    ) as HTMLButtonElement;
    expect(edit).not.toBeNull();
    edit.click();

    expect(callbacks.onEditSkill).toHaveBeenCalledTimes(1);
    expect(callbacks.onEditSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude:skill-tdd', providerId: 'claude' }),
    );
    expect(modal.close).toHaveBeenCalled();
    // Edit click should NOT run the skill.
    expect(callbacks.onRunSkill).not.toHaveBeenCalled();
  });

  it('renders the disabled badge span on a disabled-provider row', async () => {
    const aggregator = makeAggregator([makeSkill({ providerEnabled: false })]);
    const { modal } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const badge = modal.contentEl.querySelector(
      '.claudian-quick-actions-skill-disabled-badge',
    );
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('quickActions.skills.disabledBadge');
  });

  it('clicking a disabled-provider row still fires onRunSkill (runVaultSkill handles the Notice)', async () => {
    const aggregator = makeAggregator([makeSkill({ providerEnabled: false })]);
    const { modal, callbacks } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const row = modal.contentEl.querySelector(
      '.claudian-quick-actions-skill-row-main',
    ) as HTMLElement;
    row.click();
    expect(callbacks.onRunSkill).toHaveBeenCalledTimes(1);
  });

  it('filters skills by name substring', async () => {
    const aggregator = makeAggregator([
      makeSkill({ id: 'claude:a', name: 'brainstorming' }),
      makeSkill({ id: 'claude:b', name: 'tdd' }),
    ]);
    const { modal } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const search = modal.contentEl.querySelector(
      '.claudian-quick-actions-skill-list ~ * input, input[type=search]',
    ) as HTMLInputElement;
    search.value = 'tdd';
    search.dispatchEvent(new Event('input'));

    const rows = modal.contentEl.querySelectorAll('.claudian-quick-actions-skill-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('tdd');
  });

  it('filters skills by providerDisplayName substring', async () => {
    const aggregator = makeAggregator([
      makeSkill({ id: 'claude:a', providerDisplayName: 'Claude', name: 'a' }),
      makeSkill({
        id: 'codex:b',
        providerId: 'codex',
        providerDisplayName: 'Codex',
        insertPrefix: '$',
        name: 'b',
      }),
    ]);
    const { modal } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const search = modal.contentEl.querySelector(
      'input[type=search]',
    ) as HTMLInputElement;
    search.value = 'codex';
    search.dispatchEvent(new Event('input'));

    const rows = modal.contentEl.querySelectorAll('.claudian-quick-actions-skill-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('b');
  });

  it('renders noResults when filter matches nothing', async () => {
    const aggregator = makeAggregator([makeSkill({ name: 'tdd' })]);
    const { modal } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const search = modal.contentEl.querySelector(
      'input[type=search]',
    ) as HTMLInputElement;
    search.value = 'nope';
    search.dispatchEvent(new Event('input'));

    const noResults = modal.contentEl.querySelector(
      '.claudian-quick-actions-empty-results',
    );
    expect(noResults?.textContent).toContain('quickActions.skills.noResults');
  });

  it('Enter on the skills search runs the first matching skill and closes', async () => {
    const aggregator = makeAggregator([
      makeSkill({ id: 'claude:a', name: 'brainstorming' }),
      makeSkill({ id: 'claude:b', name: 'tdd' }),
    ]);
    const { modal, callbacks } = await openModal({ aggregator });
    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const search = modal.contentEl.querySelector(
      'input[type=search]',
    ) as HTMLInputElement;
    search.value = 'tdd';
    search.dispatchEvent(new Event('input'));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(callbacks.onRunSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude:b', name: 'tdd' }),
    );
    expect(modal.close).toHaveBeenCalled();
  });

  it('clears the search input when switching tabs', async () => {
    const aggregator = makeAggregator([makeSkill()]);
    const storage = makeStorage([
      {
        id: 'a',
        name: 'one',
        description: 'd',
        prompt: 'p',
        filePath: 'qa/a.md',
      } as QuickAction,
    ]);
    const { modal } = await openModal({ aggregator, storage });

    const search = modal.contentEl.querySelector(
      'input[type=search]',
    ) as HTMLInputElement;
    search.value = 'foo';
    search.dispatchEvent(new Event('input'));

    const tabs = modal.contentEl.querySelectorAll(
      '.claudian-quick-actions-tab',
    ) as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setTimeout(r, 0));

    const refreshedSearch = modal.contentEl.querySelector(
      'input[type=search]',
    ) as HTMLInputElement;
    expect(refreshedSearch.value).toBe('');
  });
});
