import { Setting } from 'obsidian';

import { t } from '../../i18n/i18n';

export interface DialogButtonsConfig {
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** `cta` (default) renders a primary confirm; `warning` a destructive one. */
  variant?: 'cta' | 'warning';
}

/**
 * Renders the shared Cancel / Confirm button row the small modals (Confirm,
 * Prompt) use: a localized Cancel on the left and a `confirmLabel` action on the
 * right, styled CTA or destructive. Keeps the button wiring in one place so the
 * two modals don't drift in label, order, or emphasis.
 */
export function renderDialogButtons(parent: HTMLElement, config: DialogButtonsConfig): void {
  new Setting(parent)
    .addButton((btn) => btn.setButtonText(t('common.cancel')).onClick(config.onCancel))
    .addButton((btn) => {
      btn.setButtonText(config.confirmLabel).onClick(config.onConfirm);
      if (config.variant === 'warning') btn.setWarning();
      else btn.setCta();
    });
}
