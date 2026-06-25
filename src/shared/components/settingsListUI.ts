import type { App } from 'obsidian';
import { Notice, setIcon } from 'obsidian';

import { confirmDelete } from '../modals/ConfirmModal';

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
      ? 'specorator-settings-action-btn specorator-settings-delete-btn'
      : 'specorator-settings-action-btn',
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
  const itemEl = listEl.createDiv({ cls: 'specorator-sp-item' });
  const infoEl = itemEl.createDiv({ cls: 'specorator-sp-info' });

  const headerRow = infoEl.createDiv({ cls: 'specorator-sp-item-header' });
  const nameEl = headerRow.createSpan({ cls: 'specorator-sp-item-name' });
  nameEl.setText(options.name);

  if (options.description) {
    const descEl = infoEl.createDiv({ cls: 'specorator-sp-item-desc' });
    descEl.setText(options.description);
  }

  const actionsEl = itemEl.createDiv({ cls: 'specorator-sp-item-actions' });
  for (const action of options.actions) {
    createSettingsActionButton(actionsEl, action);
  }

  return { headerRow };
}

interface SettingsListHeaderOptions {
  /** Text label shown to the left of the action buttons. */
  label: string;
  /** Optional refresh button — omitted when the caller has no refresh action. */
  onRefresh?: () => void;
  onAdd: () => void;
}

/**
 * Standard settings list section header: a label span on the left and a
 * compact button row on the right. Renders a refresh button when `onRefresh`
 * is supplied, always renders an add (+) button.
 */
export function renderSettingsListHeader(
  containerEl: HTMLElement,
  options: SettingsListHeaderOptions,
): void {
  const headerEl = containerEl.createDiv({ cls: 'specorator-sp-header' });
  headerEl.createSpan({ text: options.label, cls: 'specorator-sp-label' });

  const actionsEl = headerEl.createDiv({ cls: 'specorator-sp-header-actions' });

  if (options.onRefresh) {
    const refreshBtn = actionsEl.createEl('button', {
      cls: 'specorator-settings-action-btn',
      attr: { 'aria-label': 'Refresh' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', options.onRefresh);
  }

  const addBtn = actionsEl.createEl('button', {
    cls: 'specorator-settings-action-btn',
    attr: { 'aria-label': 'Add' },
  });
  setIcon(addBtn, 'plus');
  addBtn.addEventListener('click', options.onAdd);
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
    cls: 'specorator-cancel-btn',
  });
  cancelBtn.addEventListener('click', options.onCancel);

  const saveBtn = buttonContainer.createEl('button', {
    text: options.saveText,
    cls: options.saveCls ?? 'specorator-save-btn',
  });
  saveBtn.addEventListener('click', options.onSave);
}

interface ConfirmDeleteListItemOptions {
  app: App;
  message: string;
  doDelete: () => Promise<void>;
  afterDelete: () => Promise<void> | void;
  successNotice: string;
  failureNotice: string;
}

/** Confirm-then-delete flow shared by provider agent/skill settings lists. */
export async function confirmDeleteListItem(options: ConfirmDeleteListItemOptions): Promise<void> {
  const confirmed = await confirmDelete(options.app, options.message);
  if (!confirmed) return;
  try {
    await options.doDelete();
    await options.afterDelete();
    new Notice(options.successNotice);
  } catch {
    new Notice(options.failureNotice);
  }
}

interface RenderSettingsListBodyOptions<T> {
  containerEl: HTMLElement;
  items: T[];
  /**
   * When non-null, renders an empty-state hint before the list container.
   * When null, skips the empty hint regardless of items.length.
   */
  emptyText: string | null;
  renderItem: (listEl: HTMLElement, item: T) => void;
  /**
   * When true and items is empty, returns without creating the list container
   * (Codex-style early-return). When false (default) the list container is
   * always created so built-in items can still be rendered (Cursor-style).
   */
  returnEarlyIfEmpty?: boolean;
}

/** Empty-state hint + list container + per-item loop shared by provider settings. */
export function renderSettingsListBody<T>(options: RenderSettingsListBodyOptions<T>): void {
  if (options.emptyText !== null) {
    const emptyEl = options.containerEl.createDiv({ cls: 'specorator-sp-empty-state' });
    emptyEl.setText(options.emptyText);
  }
  if (options.returnEarlyIfEmpty && options.items.length === 0) return;
  const listEl = options.containerEl.createDiv({ cls: 'specorator-sp-list' });
  for (const item of options.items) {
    options.renderItem(listEl, item);
  }
}
