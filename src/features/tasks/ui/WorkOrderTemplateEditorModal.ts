import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import type { LucideIconPicker } from '../../../shared/components/LucideIconPicker';
import { addIconPickerRow, addNameAndDescriptionRows } from '../../../shared/settings/nameDescriptionRows';
import { LoopNoteStore } from '../loops/LoopNoteStore';
import type { TaskPriority } from '../model/taskTypes';
import type { SaveTemplateInput } from '../templates/TemplateNoteStore';
import type { WorkOrderTemplate } from '../templates/templateTypes';

// `null` label means "Use default", resolved through i18n at render time so the
// option text follows the active locale (a module-level `t()` would freeze it).
const PRIORITY_OPTIONS: Array<{ value: '' | TaskPriority; label: string | null }> = [
  { value: '', label: null },
  { value: '0 - urgent', label: '0 - urgent' },
  { value: '1 - high', label: '1 - high' },
  { value: '2 - normal', label: '2 - normal' },
  { value: '3 - low', label: '3 - low' },
];

export interface WorkOrderTemplateEditorPayload extends SaveTemplateInput {
  originalPath?: string;
}

export class WorkOrderTemplateEditorModal extends Modal {
  private iconPicker: LucideIconPicker | null = null;
  private modelDropdownContainer: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly plugin: ClaudianPlugin,
    private readonly existing: WorkOrderTemplate | null,
    private readonly onSave: (payload: WorkOrderTemplateEditorPayload) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const isEdit = Boolean(this.existing);
    this.setTitle(isEdit ? t('tasks.templateEditor.titleEdit') : t('tasks.templateEditor.titleNew'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-wo-template-editor-modal');

    let name = this.existing?.name ?? '';
    let description = this.existing?.description ?? '';
    let icon = this.existing?.icon ?? '';
    let provider = this.existing?.provider ?? '';
    let model = this.existing?.model ?? '';
    let priority: '' | TaskPriority = this.existing?.priority ?? '';
    let loop = this.existing?.loop ?? '';
    let body = this.existing?.body ?? defaultBody();

    addNameAndDescriptionRows(this.contentEl, {
      name: {
        name: t('tasks.templateEditor.nameName'),
        desc: t('tasks.templateEditor.nameDesc'),
        value: name,
        onChange: (v) => { name = v; },
        disabled: isEdit,
      },
      description: {
        name: t('tasks.templateEditor.descriptionName'),
        desc: t('tasks.templateEditor.descriptionDesc'),
        value: description,
        onChange: (v) => { description = v; },
      },
    });

    this.iconPicker = addIconPickerRow(this.contentEl, {
      name: t('tasks.templateEditor.iconName'),
      desc: t('tasks.templateEditor.iconDesc'),
      value: icon,
      onChange: (v) => { icon = v; },
    });

    const settings = asSettingsBag(this.plugin.settings);
    const providerOptions = providerOptionList(settings);

    new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.providerName'))
      .setDesc(t('tasks.templateEditor.providerDesc'))
      .addDropdown((dd) => {
        for (const opt of providerOptions) {
          dd.addOption(opt.value, opt.label);
        }
        dd.setValue(provider);
        dd.onChange((v) => {
          provider = v;
          model = '';
          renderModelDropdown(provider, model);
        });
      });

    const modelSetting = new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.modelName'))
      .setDesc(t('tasks.templateEditor.modelDesc'));
    this.modelDropdownContainer = modelSetting.controlEl;

    const renderModelDropdown = (currentProvider: string, currentModel: string): void => {
      if (!this.modelDropdownContainer) return;
      this.modelDropdownContainer.empty();
      const options = modelOptionList(currentProvider, settings);
      const select = this.modelDropdownContainer.createEl('select', { cls: 'dropdown' });
      for (const opt of options) {
        const optionEl = select.createEl('option', { text: opt.label });
        optionEl.value = opt.value;
        if (opt.value === currentModel) {
          optionEl.selected = true;
        }
      }
      select.addEventListener('change', () => {
        model = select.value;
      });
    };
    renderModelDropdown(provider, model);

    new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.priorityName'))
      .setDesc(t('tasks.templateEditor.priorityDesc'))
      .addDropdown((dd) => {
        for (const opt of PRIORITY_OPTIONS) {
          dd.addOption(opt.value, opt.label ?? t('tasks.templateEditor.useDefault'));
        }
        dd.setValue(priority);
        dd.onChange((v) => { priority = v as '' | TaskPriority; });
      });

    // Loop selector: rendered synchronously then populated async to avoid
    // blocking modal open on vault I/O. The `loop` local is seeded from
    // `existing` so a save without touching the dropdown preserves the value.
    const loopSetting = new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.loopName'))
      .setDesc(t('tasks.templateEditor.loopDesc'));
    const loopSelect = loopSetting.controlEl.createEl('select', { cls: 'dropdown' });
    const noneOpt = loopSelect.createEl('option', { text: t('tasks.templateEditor.loopNone') });
    noneOpt.value = '';
    loopSelect.addEventListener('change', () => { loop = loopSelect.value; });
    void this.populateLoopOptions(loopSelect, loop);

    const bodySetting = new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.bodyName'))
      .setDesc(t('tasks.templateEditor.bodyDesc'))
      .addTextArea((area) => {
        area.setValue(body).onChange((v) => { body = v; });
        area.inputEl.rows = 12;
        area.inputEl.addClass('claudian-wo-template-body-input');
      });
    bodySetting.settingEl.addClass('claudian-wo-template-body-setting');

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText(t('tasks.templateEditor.save'))
          .setCta()
          .onClick(() => {
            void this.handleSave({ name, description, icon, provider, model, priority, loop, body });
          });
      })
      .addButton((btn) => {
        btn.setButtonText(t('tasks.templateEditor.cancel')).onClick(() => this.close());
      });
  }

  onClose(): void {
    this.iconPicker?.destroy();
    this.iconPicker = null;
    this.modelDropdownContainer = null;
    this.contentEl.empty();
  }

  private async handleSave(form: {
    name: string;
    description: string;
    icon: string;
    provider: string;
    model: string;
    priority: '' | TaskPriority;
    loop: string;
    body: string;
  }): Promise<void> {
    const trimmedName = form.name.trim();
    const trimmedBody = form.body.trim();
    if (!trimmedName) {
      new Notice(t('tasks.template.nameRequired'));
      return;
    }
    if (!trimmedBody) {
      new Notice(t('tasks.template.bodyRequired'));
      return;
    }

    const payload: WorkOrderTemplateEditorPayload = {
      name: trimmedName,
      description: form.description.trim() || undefined,
      icon: form.icon.trim() || undefined,
      provider: form.provider.trim() || undefined,
      model: form.model.trim() || undefined,
      priority: form.priority || undefined,
      loop: form.loop.trim() || undefined,
      body: trimmedBody,
      originalPath: this.existing?.path,
    };

    try {
      await this.onSave(payload);
      this.close();
    } catch (error) {
      new Notice(t('tasks.template.saveFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async populateLoopOptions(select: HTMLSelectElement, current: string): Promise<void> {
    const folder = this.plugin.settings.agentBoardLoopFolder || 'Agent Board/loops';
    const { loops } = await new LoopNoteStore().list(this.plugin.app.vault, folder);
    for (const loop of loops) {
      const opt = select.createEl('option', { text: loop.name });
      opt.value = loop.id;
      if (loop.id === current) opt.selected = true;
    }
  }
}

function providerOptionList(settings: Record<string, unknown>): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: '', label: t('tasks.templateEditor.useDefault') }];
  for (const id of ProviderRegistry.getRegisteredProviderIds()) {
    if (ProviderRegistry.isEnabled(id as ProviderId, settings)) {
      options.push({ value: id, label: id });
    }
  }
  return options;
}

function modelOptionList(
  providerId: string,
  settings: Record<string, unknown>,
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: '', label: t('tasks.templateEditor.useDefault') }];
  if (!providerId) {
    return options;
  }
  const registered = ProviderRegistry.getRegisteredProviderIds() as readonly string[];
  if (!registered.includes(providerId)) {
    return options;
  }
  try {
    const config = ProviderRegistry.getChatUIConfig(providerId as ProviderId);
    for (const opt of config.getModelOptions(settings)) {
      options.push({ value: opt.value, label: opt.label });
    }
  } catch {
    // Provider may not expose model options synchronously; fall back to default-only.
  }
  return options;
}

function defaultBody(): string {
  return [
    '# {{title}}',
    '',
    '## Objective',
    '',
    '_Describe what the agent should accomplish._',
    '',
    '## Acceptance Criteria',
    '',
    '- [ ] _Define what "done" means._',
    '',
    '## Context',
    '',
    '{{source}}',
    '',
    '## Constraints',
    '',
    '- Do not modify unrelated files.',
    '',
  ].join('\n');
}
