import { Modal } from 'obsidian';

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
    this.modalEl.addClass('claudian-library-modal');
    this.titleEl.setText(this.title());
    await this.rerender();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  protected async rerender(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-library-modal-content');
    await this.renderBody(root);
  }
}
