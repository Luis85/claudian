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
  private listEl: HTMLElement | null = null;
  private actions: QuickAction[] = [];

  constructor(app: App, callbacks: QuickActionsModalCallbacks) {
    super(app);
    this.callbacks = callbacks;
  }

  onOpen(): void {
    this.setTitle(t('quickActions.modal.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-quick-actions-modal');

    const body = this.contentEl.createDiv({ cls: 'claudian-quick-actions-body' });
    this.introEl = body.createDiv({ cls: 'claudian-quick-actions-intro' });
    this.listEl = body.createDiv({ cls: 'claudian-quick-actions-list' });

    const footer = this.contentEl.createDiv({ cls: 'claudian-quick-actions-footer' });
    footer.createEl('button', {
      cls: 'mod-cta',
      text: t('quickActions.modal.add'),
    }).addEventListener('click', () => {
      this.openEditor(null);
    });

    void this.refreshList();
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl || !this.introEl) {
      return;
    }
    this.listEl.empty();
    this.actions = await this.callbacks.storage.loadAll();
    this.renderIntro();

    if (this.actions.length === 0) {
      this.listEl.addClass('claudian-quick-actions-list--empty');
      return;
    }

    this.listEl.removeClass('claudian-quick-actions-list--empty');
    for (const action of this.actions) {
      this.renderRow(action);
    }
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
