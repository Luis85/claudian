import { renderModalButtonRow } from '../../../shared/components/settingsListUI';

/**
 * Shared cancel/save footer for the Codex vault settings modals (skill,
 * subagent). Both modals wire an identical footer: a save trigger that the
 * modal also exposes for tests, plus the standard button row that cancels by
 * closing and saves by invoking the trigger.
 */
export function renderCodexModalFooter(
  contentEl: HTMLElement,
  options: { onSave: () => void | Promise<void>; onCancel: () => void },
): void {
  renderModalButtonRow(contentEl, {
    cls: 'specorator-sp-modal-buttons',
    saveText: 'Save',
    onCancel: options.onCancel,
    onSave: () => {
      void options.onSave();
    },
  });
}
