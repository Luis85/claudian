import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type SpecoratorPlugin from '../../../main';
import { TemplateNoteStore } from '../templates/TemplateNoteStore';
import type { WorkOrderTemplate } from '../templates/templateTypes';
import { WorkOrderTemplateEditorModal } from './WorkOrderTemplateEditorModal';

const BLANK_ICON = 'file-plus';
const DEFAULT_TEMPLATE_ICON = 'file-text';

export interface TemplatePickResult {
  cancelled: boolean;
  template?: WorkOrderTemplate;
}

export class WorkOrderTemplatePickerModal extends Modal {
  private chosen = false;
  private listEl: HTMLElement | null = null;
  private introEl: HTMLElement | null = null;
  private templates: WorkOrderTemplate[] = [];
  private readonly store = new TemplateNoteStore();

  constructor(
    app: App,
    private readonly plugin: SpecoratorPlugin,
    private readonly resolve: (result: TemplatePickResult) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('tasks.templatePicker.title'));
    this.modalEl.addClass('specorator-sp-modal', 'specorator-wo-templates-modal');

    const body = this.contentEl.createDiv({ cls: 'specorator-wo-templates-body' });
    this.introEl = body.createDiv({ cls: 'specorator-wo-templates-intro' });
    this.listEl = body.createDiv({ cls: 'specorator-wo-templates-list' });

    const footer = this.contentEl.createDiv({ cls: 'specorator-wo-templates-footer' });
    footer.createEl('button', {
      cls: 'mod-cta',
      text: t('tasks.templatePicker.newTemplate'),
    }).addEventListener('click', () => {
      this.openEditor(null);
    });

    void this.refreshList();
  }

  onClose(): void {
    this.contentEl.empty();
    // Defer the cancel fallback so a synchronous choice in the same tick wins.
    window.setTimeout(() => {
      if (!this.chosen) {
        this.resolve({ cancelled: true });
      }
    }, 0);
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl || !this.introEl) {
      return;
    }
    this.listEl.empty();
    const folder = this.plugin.settings.agentBoardTemplateFolder || 'Agent Board/templates';
    const { templates } = await this.store.list(this.plugin.app.vault, folder);
    this.templates = templates;
    this.renderIntro();
    this.renderBlankRow();
    for (const template of templates) {
      this.renderTemplateRow(template);
    }
  }

  private renderIntro(): void {
    if (!this.introEl) return;
    this.introEl.empty();
    if (this.templates.length === 0) {
      this.introEl.createEl('p', {
        cls: 'specorator-wo-templates-intro-lead',
        text: t('tasks.templatePicker.emptyState'),
      });
      return;
    }
    this.introEl.createEl('p', { text: t('tasks.templatePicker.lead') });
  }

  private renderBlankRow(): void {
    if (!this.listEl) return;
    const row = this.listEl.createDiv({ cls: 'specorator-wo-templates-row specorator-wo-templates-row--blank' });
    const main = row.createDiv({ cls: 'specorator-wo-templates-main' });

    const iconEl = main.createSpan({ cls: 'specorator-wo-templates-icon' });
    setIcon(iconEl, BLANK_ICON);

    const textCol = main.createDiv({ cls: 'specorator-wo-templates-text' });
    textCol.createEl('strong', { text: t('tasks.templatePicker.blankTitle') });
    textCol.createDiv({
      cls: 'specorator-wo-templates-desc',
      text: t('tasks.templatePicker.blankDesc'),
    });

    main.addEventListener('click', () => {
      this.choose({ cancelled: false });
    });
  }

  private renderTemplateRow(template: WorkOrderTemplate): void {
    if (!this.listEl) return;

    const row = this.listEl.createDiv({ cls: 'specorator-wo-templates-row' });
    const main = row.createDiv({ cls: 'specorator-wo-templates-main' });

    const iconEl = main.createSpan({ cls: 'specorator-wo-templates-icon' });
    setIcon(iconEl, template.icon || DEFAULT_TEMPLATE_ICON);

    const textCol = main.createDiv({ cls: 'specorator-wo-templates-text' });
    textCol.createEl('strong', { text: template.name });
    if (template.description) {
      textCol.createDiv({ cls: 'specorator-wo-templates-desc', text: template.description });
    }

    main.addEventListener('click', () => {
      this.choose({ cancelled: false, template });
    });

    const actions = row.createDiv({ cls: 'specorator-wo-templates-actions' });
    actions.createEl('button', { text: t('tasks.templatePicker.edit') }).addEventListener('click', (event) => {
      event.stopPropagation();
      this.openEditor(template);
    });
    actions.createEl('button', { text: t('tasks.templatePicker.delete') }).addEventListener('click', (event) => {
      event.stopPropagation();
      void this.deleteTemplate(template);
    });
  }

  private choose(result: TemplatePickResult): void {
    if (this.chosen) return;
    this.chosen = true;
    this.resolve(result);
    this.close();
  }

  private openEditor(existing: WorkOrderTemplate | null): void {
    new WorkOrderTemplateEditorModal(this.app, this.plugin, existing, async (payload) => {
      const folder = this.plugin.settings.agentBoardTemplateFolder || 'Agent Board/templates';
      await this.store.save(this.plugin.app.vault, folder, payload, payload.originalPath);
      await this.refreshList();
    }).open();
  }

  private async deleteTemplate(template: WorkOrderTemplate): Promise<void> {
    try {
      await this.store.delete(this.plugin.app, template.path);
      await this.refreshList();
    } catch (error) {
      new Notice(t('tasks.template.deleteFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

export async function chooseWorkOrderTemplate(plugin: SpecoratorPlugin): Promise<TemplatePickResult> {
  return new Promise<TemplatePickResult>((resolve) => {
    new WorkOrderTemplatePickerModal(plugin.app, plugin, resolve).open();
  });
}
