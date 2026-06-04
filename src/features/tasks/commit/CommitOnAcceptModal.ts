import { type App, Modal } from 'obsidian';

import { t } from '../../../i18n/i18n';

export interface CommitOnAcceptModalOptions {
  taskTitle: string;
  dirtyCount: number;
}

export interface CommitOnAcceptModalResult {
  confirmed: boolean;
  dontAskAgain: boolean;
}

export class CommitOnAcceptModal extends Modal {
  private resolver: ((result: CommitOnAcceptModalResult) => void) | null = null;
  private resultPromise: Promise<CommitOnAcceptModalResult>;
  private settled = false;
  private dontAskAgain = false;

  constructor(app: App, private readonly options: CommitOnAcceptModalOptions) {
    super(app);
    this.resultPromise = new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Returns a promise resolved when the user picks a button or the modal closes. */
  result(): Promise<CommitOnAcceptModalResult> {
    return this.resultPromise;
  }

  onOpen(): void {
    this.modalEl.addClass('claudian-commit-on-accept-modal');
    this.titleEl.setText(t('tasks.commitOnAccept.title'));

    const filesLabel = this.options.dirtyCount === 1
      ? t('tasks.commitOnAccept.bodyOne', { title: this.options.taskTitle })
      : t('tasks.commitOnAccept.bodyMany', { title: this.options.taskTitle, count: this.options.dirtyCount });
    this.contentEl.createEl('p', { text: filesLabel });

    const checkboxWrap = this.contentEl.createEl('label', {
      cls: 'claudian-commit-on-accept-dont-ask',
    });
    const checkbox = checkboxWrap.createEl('input', {
      type: 'checkbox',
      attr: { 'data-claudian-commit-on-accept': 'dont-ask' },
    });
    checkboxWrap.createSpan({ text: ` ${t('tasks.commitOnAccept.dontAsk')}` });
    checkbox.addEventListener('change', () => {
      this.dontAskAgain = checkbox.checked;
    });

    const buttons = this.contentEl.createDiv({ cls: 'claudian-commit-on-accept-buttons' });

    const skipBtn = buttons.createEl('button', {
      text: t('tasks.commitOnAccept.skip'),
      attr: { type: 'button', 'data-claudian-commit-on-accept': 'skip' },
    });
    skipBtn.addEventListener('click', () => this.resolve({ confirmed: false, dontAskAgain: this.dontAskAgain }));

    const confirmBtn = buttons.createEl('button', {
      text: t('tasks.commitOnAccept.commitAndPush'),
      cls: 'mod-cta',
      attr: { type: 'button', 'data-claudian-commit-on-accept': 'confirm' },
    });
    confirmBtn.addEventListener('click', () => this.resolve({ confirmed: true, dontAskAgain: this.dontAskAgain }));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.resolve({ confirmed: false, dontAskAgain: false });
    }
  }

  private resolve(result: CommitOnAcceptModalResult): void {
    if (this.settled) return;
    this.settled = true;
    this.resolver?.(result);
    if (this.containerEl?.isConnected) {
      this.close();
    }
  }
}
