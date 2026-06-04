import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { QuickActionStorage } from '../QuickActionStorage';
import { assignNextFavoriteRank } from '../QuickActionStorage';
import type { SkillTabEntry, VaultSkillSource } from '../skills/types';
import type { QuickAction } from '../types';
import { QuickActionEditorModal } from './QuickActionEditorModal';
import { SkillsTabRenderer } from './SkillsTabRenderer';

export interface QuickActionsModalCallbacks {
  onRun: (action: QuickAction) => void;
  onRunSkill: (entry: SkillTabEntry) => void;
  /**
   * Invoked when the user clicks the per-row "Edit in {provider} settings"
   * button on the Skills tab. Implementations open the matching provider
   * settings sub-tab; the modal closes itself before firing.
   */
  onEditSkill: (entry: SkillTabEntry) => void;
  storage: QuickActionStorage;
  aggregator: VaultSkillSource;
  onFavoritesChanged?: () => void;
}

type ActiveTab = 'quickActions' | 'skills';

export class QuickActionsModal extends Modal {
  private callbacks: QuickActionsModalCallbacks;
  private activeTab: ActiveTab = 'quickActions';
  private tabStripEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  // Quick Actions tab state
  private introEl: HTMLElement | null = null;
  private searchWrapEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private actions: QuickAction[] = [];
  private filter = '';

  // Skills tab — delegated to a dedicated renderer.
  private skillsRenderer: SkillsTabRenderer;

  constructor(app: App, callbacks: QuickActionsModalCallbacks) {
    super(app);
    this.callbacks = callbacks;
    this.skillsRenderer = new SkillsTabRenderer(
      callbacks.aggregator,
      callbacks.onRunSkill,
      callbacks.onEditSkill,
      () => this.close(),
    );
  }

  onOpen(): void {
    this.setTitle(t('quickActions.modal.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-quick-actions-modal');

    this.tabStripEl = this.contentEl.createDiv({ cls: 'claudian-quick-actions-tabs' });
    this.renderTabStrip();

    this.bodyEl = this.contentEl.createDiv({ cls: 'claudian-quick-actions-body' });
    void this.renderActiveTab();
  }

  private renderTabStrip(): void {
    if (!this.tabStripEl) return;
    this.tabStripEl.empty();

    const entries: Array<{ key: ActiveTab; label: string }> = [
      { key: 'quickActions', label: t('quickActions.modal.tabs.quickActions') },
      { key: 'skills', label: t('quickActions.modal.tabs.skills') },
    ];

    for (const entry of entries) {
      const tab = this.tabStripEl.createEl('button', {
        cls: 'claudian-quick-actions-tab',
        text: entry.label,
        attr: { type: 'button' },
      });
      if (this.activeTab === entry.key) {
        tab.addClass('is-active');
      }
      tab.addEventListener('click', () => {
        if (this.activeTab === entry.key) return;
        this.activeTab = entry.key;
        this.renderTabStrip();
        void this.renderActiveTab();
      });
    }
  }

  private async renderActiveTab(): Promise<void> {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.introEl = null;
    this.searchWrapEl = null;
    this.searchInputEl = null;
    this.listEl = null;
    this.filter = '';

    let inputToFocus: HTMLInputElement | null;
    if (this.activeTab === 'quickActions') {
      inputToFocus = this.renderQuickActionsBody(this.bodyEl);
      await this.refreshList();
    } else {
      inputToFocus = await this.skillsRenderer.render(this.bodyEl);
    }
    inputToFocus?.focus();
  }

  // ============================================================
  // Quick Actions tab
  // ============================================================

  private renderQuickActionsBody(host: HTMLElement): HTMLInputElement {
    this.introEl = host.createDiv({ cls: 'claudian-quick-actions-intro' });

    this.searchWrapEl = host.createDiv({ cls: 'claudian-quick-actions-search' });
    const inputContainer = this.searchWrapEl.createDiv({
      cls: 'claudian-quick-actions-search-container',
    });
    const placeholder = t('quickActions.modal.searchPlaceholder');
    const searchInput = inputContainer.createEl('input', {
      type: 'search',
      cls: 'claudian-quick-actions-search-input',
      attr: { placeholder, 'aria-label': placeholder },
    });
    this.searchInputEl = searchInput;
    searchInput.addEventListener('input', () => {
      this.filter = searchInput.value ?? '';
      this.renderList();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runFirstMatch();
      } else if (e.key === 'Escape' && searchInput.value) {
        e.preventDefault();
        e.stopPropagation();
        searchInput.value = '';
        this.filter = '';
        this.renderList();
      }
    });

    const resetBtn = inputContainer.createEl('button', {
      cls: 'claudian-quick-actions-search-reset',
      text: '✕',
      attr: { title: 'Clear search', 'aria-label': 'Clear search' },
    });
    resetBtn.addEventListener('click', () => {
      this.setFilter('');
    });

    this.listEl = host.createDiv({ cls: 'claudian-quick-actions-list' });

    const footer = host.createDiv({ cls: 'claudian-quick-actions-footer' });
    footer
      .createEl('button', {
        cls: 'mod-cta',
        text: t('quickActions.modal.add'),
      })
      .addEventListener('click', () => {
        this.openEditor(null);
      });

    return searchInput;
  }

  private runFirstMatch(): void {
    const first = this.applyFilteredOrder()[0];
    if (!first) {
      return;
    }
    this.callbacks.onRun(first);
    this.close();
  }

  private applyFilteredOrder(): QuickAction[] {
    const filtered = this.applyFilter(this.actions);
    const isFiltering = this.filter.trim().length > 0;
    return isFiltering ? filtered : this.sortFavoritesFirst(filtered);
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl || !this.introEl) {
      return;
    }
    this.actions = await this.callbacks.storage.loadAll();
    this.renderIntro();
    this.renderList();
  }

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

    const ordered = this.applyFilteredOrder();
    if (ordered.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.modal.noResults'),
      });
      return;
    }

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

  private setFilter(value: string): void {
    this.filter = value;
    if (this.searchInputEl) {
      this.searchInputEl.value = value;
      this.searchInputEl.focus();
    }
    this.renderList();
  }

  private applyFilter(actions: QuickAction[]): QuickAction[] {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) {
      return actions;
    }
    return actions.filter((a) => {
      if (a.name.toLowerCase().includes(needle)) return true;
      if (a.description.toLowerCase().includes(needle)) return true;
      if (a.tags?.some((tag) => tag.toLowerCase().includes(needle))) return true;
      return false;
    });
  }

  private renderIntro(): void {
    if (!this.introEl) {
      return;
    }
    this.introEl.empty();

    if (this.actions.length === 0) {
      this.introEl.addClass('claudian-quick-actions-intro--empty');
      this.introEl.createEl('p', {
        cls: 'claudian-quick-actions-intro-lead',
        text: t('quickActions.modal.emptyLead'),
      });
      const hints = this.introEl.createEl('ul', {
        cls: 'claudian-quick-actions-intro-hints',
      });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintVault') });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintRun') });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintCreate') });
      return;
    }

    this.introEl.removeClass('claudian-quick-actions-intro--empty');
    this.introEl.createEl('p', { text: t('quickActions.modal.intro') });
  }

  private renderRow(action: QuickAction): void {
    if (!this.listEl) {
      return;
    }

    const row = this.listEl.createDiv({ cls: 'claudian-quick-action-row' });
    const main = row.createDiv({ cls: 'claudian-quick-action-main' });

    if (action.icon) {
      const iconEl = main.createSpan({ cls: 'claudian-quick-action-icon' });
      setIcon(iconEl, action.icon);
    }

    const textCol = main.createDiv({ cls: 'claudian-quick-action-text' });
    textCol.createEl('strong', { text: action.name });
    if (action.description !== action.name) {
      textCol.createDiv({
        cls: 'claudian-quick-action-desc',
        text: action.description,
      });
    }
    if (action.tags && action.tags.length > 0) {
      const tagsEl = textCol.createDiv({ cls: 'claudian-quick-action-tags' });
      for (const tag of action.tags) {
        const chip = tagsEl.createSpan({
          cls: 'claudian-quick-action-tag',
          text: `#${tag}`,
          attr: {
            role: 'button',
            tabindex: '0',
            'aria-label': t('quickActions.modal.filterByTag', { tag }),
          },
        });
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setFilter(tag);
        });
        chip.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            this.setFilter(tag);
          }
        });
      }
    }

    main.addEventListener('click', () => {
      this.callbacks.onRun(action);
      this.close();
    });

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

    const actions = row.createDiv({ cls: 'claudian-quick-action-actions' });
    actions
      .createEl('button', { text: t('common.edit') })
      .addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditor(action);
      });
    actions
      .createEl('button', { text: t('common.delete') })
      .addEventListener('click', (e) => {
        e.stopPropagation();
        void this.deleteAction(action);
      });
  }

  private openEditor(existing: QuickAction | null): void {
    new QuickActionEditorModal(this.app, existing, async (action) => {
      const filePath = await this.callbacks.storage.save(action);
      action.filePath = filePath;
      await this.refreshList();
    }).open();
  }

  private async deleteAction(action: QuickAction): Promise<void> {
    if (!action.filePath) {
      return;
    }
    try {
      await this.callbacks.storage.delete(action.filePath);
      await this.refreshList();
    } catch {
      new Notice(t('quickActions.modal.deleteFailed'));
    }
  }

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
      this.callbacks.onFavoritesChanged?.();
      await this.refreshList();
    } catch {
      new Notice(t('quickActions.editor.saveFailed'));
      await this.refreshList();
    } finally {
      button.disabled = false;
    }
  }
}
