import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { LoopNoteStore } from '../loops/LoopNoteStore';
import type { LoopDefinition } from '../loops/loopTypes';
import { LoopEditorModal } from './LoopEditorModal';

const NONE_ICON = 'circle-slash';
const DEFAULT_LOOP_ICON = 'repeat';

export interface LoopPickResult {
  cancelled: boolean;
  /** Chosen loop slug, or '' to explicitly detach ("No loop"). Undefined when cancelled. */
  loopId?: string;
}

export class LoopPickerModal extends Modal {
  private chosen = false;
  private listEl: HTMLElement | null = null;
  private readonly store = new LoopNoteStore();

  constructor(
    app: App,
    private readonly plugin: ClaudianPlugin,
    private readonly current: string | undefined,
    private readonly resolve: (result: LoopPickResult) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('tasks.loopPicker.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-loops-modal');

    const body = this.contentEl.createDiv({ cls: 'claudian-loops-body' });
    body.createEl('p', { text: t('tasks.loopPicker.lead') });
    this.listEl = body.createDiv({ cls: 'claudian-loops-list' });

    const footer = this.contentEl.createDiv({ cls: 'claudian-loops-footer' });
    footer
      .createEl('button', { cls: 'mod-cta', text: t('tasks.loopPicker.newLoop') })
      .addEventListener('click', () => this.openEditor(null));

    void this.refreshList();
  }

  onClose(): void {
    this.contentEl.empty();
    this.listEl = null;
    // Defer the cancel fallback so a synchronous choice in the same tick wins.
    window.setTimeout(() => {
      if (!this.chosen) this.resolve({ cancelled: true });
    }, 0);
  }

  private folder(): string {
    return this.plugin.settings.agentBoardLoopFolder || 'Agent Board/loops';
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl) return;
    this.listEl.empty();
    const { loops } = await this.store.list(this.plugin.app.vault, this.folder());
    this.renderNoneRow();
    for (const loop of loops) this.renderLoopRow(loop);
  }

  private renderNoneRow(): void {
    if (!this.listEl) return;
    const row = this.listEl.createDiv({ cls: 'claudian-loops-row claudian-loops-row--none' });
    const main = row.createDiv({ cls: 'claudian-loops-main' });

    const iconEl = main.createSpan({ cls: 'claudian-loops-icon' });
    setIcon(iconEl, NONE_ICON);

    const textCol = main.createDiv({ cls: 'claudian-loops-text' });
    textCol.createEl('strong', { text: t('tasks.loopPicker.noneTitle') });
    textCol.createDiv({ cls: 'claudian-loops-desc', text: t('tasks.loopPicker.noneDesc') });

    if (!this.current) row.addClass('is-active');
    main.addEventListener('click', () => this.choose({ cancelled: false, loopId: '' }));
  }

  private renderLoopRow(loop: LoopDefinition): void {
    if (!this.listEl) return;

    const row = this.listEl.createDiv({ cls: 'claudian-loops-row' });
    if (loop.id === this.current) row.addClass('is-active');

    const main = row.createDiv({ cls: 'claudian-loops-main' });

    const iconEl = main.createSpan({ cls: 'claudian-loops-icon' });
    setIcon(iconEl, loop.icon || DEFAULT_LOOP_ICON);

    const textCol = main.createDiv({ cls: 'claudian-loops-text' });
    textCol.createEl('strong', { text: loop.name });
    if (loop.description) {
      textCol.createDiv({ cls: 'claudian-loops-desc', text: loop.description });
    }
    if (loop.useWhen) {
      textCol.createDiv({
        cls: 'claudian-loops-usewhen',
        text: `${t('tasks.loopPicker.useWhenLabel')} ${loop.useWhen}`,
      });
    }

    main.addEventListener('click', () => this.choose({ cancelled: false, loopId: loop.id }));

    const actions = row.createDiv({ cls: 'claudian-loops-actions' });
    actions.createEl('button', { text: t('tasks.loopPicker.edit') }).addEventListener('click', (event) => {
      event.stopPropagation();
      this.openEditor(loop);
    });
    actions.createEl('button', { text: t('tasks.loopPicker.delete') }).addEventListener('click', (event) => {
      event.stopPropagation();
      void this.deleteLoop(loop);
    });
  }

  private choose(result: LoopPickResult): void {
    if (this.chosen) return;
    this.chosen = true;
    this.resolve(result);
    this.close();
  }

  private openEditor(existing: LoopDefinition | null): void {
    new LoopEditorModal(this.app, existing, async (payload) => {
      await this.store.save(this.plugin.app.vault, this.folder(), payload, payload.originalPath);
      await this.refreshList();
    }).open();
  }

  private async deleteLoop(loop: LoopDefinition): Promise<void> {
    try {
      await this.store.delete(this.plugin.app, loop.path);
      await this.refreshList();
    } catch (error) {
      new Notice(t('tasks.loop.deleteFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

export async function chooseLoop(plugin: ClaudianPlugin, current: string | undefined): Promise<LoopPickResult> {
  return new Promise<LoopPickResult>((resolve) => {
    new LoopPickerModal(plugin.app, plugin, current, resolve).open();
  });
}
