import { Modal } from 'obsidian';

import { renderModalFooter } from '../../utils/libraryView';
import { withErrorNotice } from '../uiAction';

export interface LibrarySaveFooterOptions {
  saveLabel: string;
  closeLabel: string;
  /** Notice shown when the save throws. */
  failedMessage: string;
  onSave: () => Promise<void>;
  onError: (error: unknown) => void;
}

/**
 * Shared base for the Tool/Skill library editor modals: owns the modal-class
 * styling, the title, and the empty-then-render lifecycle so subclasses only
 * supply a title and a body renderer. `rerender()` lets a subclass refresh in
 * place after a save.
 */
export abstract class LibraryEditorModal extends Modal {
  protected abstract title(): string;
  protected abstract renderBody(root: HTMLElement): Promise<void>;

  async onOpen(): Promise<void> {
    this.modalEl.addClass('specorator-library-modal');
    this.titleEl.setText(this.title());
    await this.rerender();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  protected async rerender(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('specorator-library-modal-content');
    await this.renderBody(root);
  }

  /**
   * Renders the Save/Close footer with the save wrapped so a failure surfaces a
   * Notice and is logged rather than rejecting an unhandled promise — the
   * pattern both editor modals share.
   */
  protected renderSaveFooter(root: HTMLElement, opts: LibrarySaveFooterOptions): void {
    renderModalFooter(root, {
      saveLabel: opts.saveLabel,
      onSave: () => void withErrorNotice(opts.onSave, opts.failedMessage, opts.onError),
      closeLabel: opts.closeLabel,
      onClose: () => this.close(),
    });
  }
}
