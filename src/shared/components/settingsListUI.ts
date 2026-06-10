import { setIcon } from 'obsidian';

export interface SettingsActionButtonOptions {
  icon: string;
  ariaLabel: string;
  /** Adds the delete-button styling on top of the base action-button class. */
  danger?: boolean;
  onClick: () => void;
}

export function createSettingsActionButton(
  parentEl: HTMLElement,
  options: SettingsActionButtonOptions,
): HTMLButtonElement {
  const btn = parentEl.createEl('button', {
    cls: options.danger
      ? 'claudian-settings-action-btn claudian-settings-delete-btn'
      : 'claudian-settings-action-btn',
    attr: { 'aria-label': options.ariaLabel },
  });
  setIcon(btn, options.icon);
  btn.addEventListener('click', options.onClick);
  return btn;
}

interface SettingsListItemOptions {
  name: string;
  description?: string;
  actions: SettingsActionButtonOptions[];
}

/**
 * Standard settings list row: name header, optional description, and a row of
 * action buttons. Returns the header row so callers can append badges after
 * the name span.
 */
export function renderSettingsListItem(
  listEl: HTMLElement,
  options: SettingsListItemOptions,
): { headerRow: HTMLElement } {
  const itemEl = listEl.createDiv({ cls: 'claudian-sp-item' });
  const infoEl = itemEl.createDiv({ cls: 'claudian-sp-info' });

  const headerRow = infoEl.createDiv({ cls: 'claudian-sp-item-header' });
  const nameEl = headerRow.createSpan({ cls: 'claudian-sp-item-name' });
  nameEl.setText(options.name);

  if (options.description) {
    const descEl = infoEl.createDiv({ cls: 'claudian-sp-item-desc' });
    descEl.setText(options.description);
  }

  const actionsEl = itemEl.createDiv({ cls: 'claudian-sp-item-actions' });
  for (const action of options.actions) {
    createSettingsActionButton(actionsEl, action);
  }

  return { headerRow };
}

interface ModalButtonRowOptions {
  cls: string;
  saveText: string;
  saveCls?: string;
  onCancel: () => void;
  onSave: () => void;
}

/** Cancel/save footer shared by the settings modals. */
export function renderModalButtonRow(
  contentEl: HTMLElement,
  options: ModalButtonRowOptions,
): void {
  const buttonContainer = contentEl.createDiv({ cls: options.cls });

  const cancelBtn = buttonContainer.createEl('button', {
    text: 'Cancel',
    cls: 'claudian-cancel-btn',
  });
  cancelBtn.addEventListener('click', options.onCancel);

  const saveBtn = buttonContainer.createEl('button', {
    text: options.saveText,
    cls: options.saveCls ?? 'claudian-save-btn',
  });
  saveBtn.addEventListener('click', options.onSave);
}
