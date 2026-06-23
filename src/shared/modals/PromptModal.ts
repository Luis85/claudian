import { type App, Modal, Setting } from 'obsidian';

import { t } from '../../i18n/i18n';
import { renderDialogButtons } from './dialogButtons';

/**
 * Opens a small modal with a single text input and returns the trimmed value on
 * confirm, or `null` when the user dismisses without submitting. `confirmLabel`
 * defaults to the localized "Confirm".
 */
export function promptReason(app: App, title: string, placeholder = '', confirmLabel?: string): Promise<string | null> {
  return new Promise((resolve) => {
    new PromptModal(app, title, resolve, placeholder, confirmLabel ?? t('common.confirm')).open();
  });
}

class PromptModal extends Modal {
  private value = '';
  private resolved = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly resolve: (value: string | null) => void,
    private readonly placeholder: string,
    private readonly confirmLabel: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.modalEl.addClass('claudian-prompt-modal');

    new Setting(this.contentEl).addText((text) => {
      text.setPlaceholder(this.placeholder);
      text.inputEl.addEventListener('input', () => {
        this.value = text.getValue();
      });
      text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          this.resolved = true;
          this.resolve(this.value.trim() || null);
          this.close();
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    renderDialogButtons(this.contentEl, {
      confirmLabel: this.confirmLabel,
      onCancel: () => this.close(),
      onConfirm: () => {
        this.resolved = true;
        this.resolve(this.value.trim() || null);
        this.close();
      },
    });
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}
