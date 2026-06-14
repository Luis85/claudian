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
    this.rowEl.addClass('claudian-hidden');
  }

  destroy(): void {
    this.rowEl.empty();
  }

  render(entries: readonly EditedFileEntry[]): void {
    this.rowEl.empty();

    if (entries.length === 0) {
      this.rowEl.removeClass('claudian-visible-flex');
      this.rowEl.addClass('claudian-hidden');
      return;
    }

    this.rowEl.addClass('claudian-visible-flex');
    this.rowEl.removeClass('claudian-hidden');

    const labelEl = this.rowEl.createSpan({ cls: 'claudian-edited-files-label' });
    labelEl.setText(t('chat.editedFiles.label'));

    for (const entry of entries) {
      this.renderChip(entry);
    }
  }

  private renderChip(entry: EditedFileEntry): void {
    const chipEl = this.rowEl.createDiv({
      cls: `claudian-edited-file-chip claudian-edited-file-chip--${entry.changeKind}`,
    });

    const iconEl = chipEl.createSpan({ cls: 'claudian-edited-file-chip-icon' });
    setIcon(iconEl, entry.changeKind === 'created' ? 'file-plus' : 'file-pen');

    const nameEl = chipEl.createSpan({ cls: 'claudian-edited-file-chip-name' });
    nameEl.setText(basename(entry.path));
    nameEl.setAttribute('title', entry.path);

    chipEl.setAttribute('aria-label', entry.path);
    chipEl.addEventListener('click', () => {
      this.callbacks.onOpenFile(entry.path);
    });
  }
}
