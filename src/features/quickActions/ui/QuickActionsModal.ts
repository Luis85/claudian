import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { QuickActionStorage } from '../QuickActionStorage';
import type { QuickAction } from '../types';
import { QuickActionEditorModal } from './QuickActionEditorModal';

export interface QuickActionsModalCallbacks {
  onRun: (action: QuickAction) => void;
  storage: QuickActionStorage;
}

export class QuickActionsModal extends Modal {
  private callbacks: QuickActionsModalCallbacks;
  private introEl: HTMLElement | null = null;
  private searchWrapEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private actions: QuickAction[] = [];
  private filter = '';

  constructor(app: App, callbacks: QuickActionsModalCallbacks) {
    super(app);
    this.callbacks = callbacks;
  }

  onOpen(): void {
    this.setTitle(t('quickActions.modal.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-quick-actions-modal');

    const body = this.contentEl.createDiv({ cls: 'claudian-quick-actions-body' });
    this.introEl = body.createDiv({ cls: 'claudian-quick-actions-intro' });

    this.searchWrapEl = body.createDiv({ cls: 'claudian-quick-actions-search' });
    const inputContainer = this.searchWrapEl.createDiv({ cls: 'claudian-quick-actions-search-container' });
    const placeholder = t('quickActions.modal.searchPlaceholder');
    this.searchInputEl = inputContainer.createEl('input', {
      type: 'search',
      cls: 'claudian-quick-actions-search-input',
      attr: { placeholder, 'aria-label': placeholder },
    });
    this.searchInputEl.addEventListener('input', () => {
      this.filter = this.searchInputEl?.value ?? '';
      this.renderList();
    });
    this.searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runFirstMatch();
      } else if (e.key === 'Escape' && this.searchInputEl?.value) {
        e.preventDefault();
        e.stopPropagation();
        this.searchInputEl.value = '';
        this.filter = '';
        this.renderList();
      }
    });

    // Reset button on right side of search
    const resetBtn = inputContainer.createEl('button', {
      cls: 'claudian-quick-actions-search-reset',
      text: '✕',
      attr: { title: 'Clear search', 'aria-label': 'Clear search' },
    });
    resetBtn.addEventListener('click', () => {
      this.setFilter('');
    });

    this.listEl = body.createDiv({ cls: 'claudian-quick-actions-list' });

    const footer = this.contentEl.createDiv({ cls: 'claudian-quick-actions-footer' });
    footer.createEl('button', {
      cls: 'mod-cta',
      text: t('quickActions.modal.add'),
    }).addEventListener('click', () => {
      this.openEditor(null);
    });

    void this.refreshList().then(() => {
      this.searchInputEl?.focus();
    });
  }

  private runFirstMatch(): void {
    const filtered = this.applyFilter(this.actions);
    const first = filtered[0];
    if (!first) {
      return;
    }
    this.callbacks.onRun(first);
    this.close();
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

    const filtered = this.applyFilter(this.actions);
    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.modal.noResults'),
      });
      return;
    }

    for (const action of filtered) {
      this.renderRow(action);
    }
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
      const hints = this.introEl.createEl('ul', { cls: 'claudian-quick-actions-intro-hints' });
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
      textCol.createDiv({ cls: 'claudian-quick-action-desc', text: action.description });
    }
    if (action.tags && action.tags.length > 0) {
      const tagsEl = textCol.createDiv({ cls: 'claudian-quick-action-tags' });
      for (const tag of action.tags) {
        const chip = tagsEl.createSpan({
          cls: 'claudian-quick-action-tag',
          text: `#${tag}`,
          attr: { role: 'button', tabindex: '0', 'aria-label': t('quickActions.modal.filterByTag', { tag }) },
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

    const actions = row.createDiv({ cls: 'claudian-quick-action-actions' });
    actions.createEl('button', { text: t('common.edit') }).addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditor(action);
    });
    actions.createEl('button', { text: t('common.delete') }).addEventListener('click', (e) => {
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
}
