import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { EditedFileEntry } from '../utils/editedFiles';

export interface EditedFilesViewCallbacks {
  /** Opens the clicked file (resolution + error handling owned by the caller). */
  onOpenFile: (path: string) => void;
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

/**
 * Renders the "files changed by the agent" strip above the composer: a small
 * leading label plus one clickable chip per created/edited file. Self-manages
 * its own row visibility (hidden when empty) so it stays independent of the
 * user-input context row beneath it.
 */
export class EditedFilesView {
  private rowEl: HTMLElement;
  private callbacks: EditedFilesViewCallbacks;

  constructor(rowEl: HTMLElement, callbacks: EditedFilesViewCallbacks) {
    this.rowEl = rowEl;
    this.callbacks = callbacks;
    this.rowEl.addClass('specorator-hidden');
  }

  destroy(): void {
    this.rowEl.empty();
  }

  render(entries: readonly EditedFileEntry[]): void {
    this.rowEl.empty();

    if (entries.length === 0) {
      this.rowEl.removeClass('specorator-visible-flex');
      this.rowEl.addClass('specorator-hidden');
      return;
    }

    this.rowEl.addClass('specorator-visible-flex');
    this.rowEl.removeClass('specorator-hidden');

    const labelEl = this.rowEl.createSpan({ cls: 'specorator-edited-files-label' });
    labelEl.setText(t('chat.editedFiles.label'));

    for (const entry of entries) {
      this.renderChip(entry);
    }
  }

  private renderChip(entry: EditedFileEntry): void {
    const chipEl = this.rowEl.createDiv({
      cls: `specorator-edited-file-chip specorator-edited-file-chip--${entry.changeKind}`,
    });

    const iconEl = chipEl.createSpan({ cls: 'specorator-edited-file-chip-icon' });
    setIcon(iconEl, entry.changeKind === 'created' ? 'file-plus' : 'file-pen');

    const nameEl = chipEl.createSpan({ cls: 'specorator-edited-file-chip-name' });
    nameEl.setText(basename(entry.path));
    nameEl.setAttribute('title', entry.path);

    chipEl.setAttribute('aria-label', entry.path);
    chipEl.addEventListener('click', () => {
      this.callbacks.onOpenFile(entry.path);
    });
  }
}
