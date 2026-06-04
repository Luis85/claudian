import { type App, Modal, Setting } from 'obsidian';

/**
 * Opens a small modal with a single text input and returns the trimmed value on
 * confirm, or `null` when the user dismisses without submitting.
 */
export function promptReason(app: App, title: string, placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    new PromptModal(app, title, resolve, placeholder).open();
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

    new Setting(this.contentEl)
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText('Rework')
          .setCta()
          .onClick(() => {
            this.resolved = true;
            this.resolve(this.value.trim() || null);
            this.close();
          }),
      );
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}
