import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { LucideIconPicker } from '../../../shared/components/LucideIconPicker';
import type { TaskPriority } from '../model/taskTypes';
import type { SaveTemplateInput } from '../templates/TemplateNoteStore';
import type { WorkOrderTemplate } from '../templates/templateTypes';

const PRIORITY_OPTIONS: Array<{ value: '' | TaskPriority; label: string }> = [
  { value: '', label: 'Use default' },
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
    this.setTitle(isEdit ? 'Edit work-order template' : 'New work-order template');
    this.modalEl.addClass('claudian-sp-modal', 'claudian-wo-template-editor-modal');

    let name = this.existing?.name ?? '';
    let description = this.existing?.description ?? '';
    let icon = this.existing?.icon ?? '';
    let provider = this.existing?.provider ?? '';
    let model = this.existing?.model ?? '';
    let priority: '' | TaskPriority = this.existing?.priority ?? '';
    let body = this.existing?.body ?? defaultBody();

    new Setting(this.contentEl)
      .setName('Name')
      .setDesc('Shown in the picker. Becomes the template filename for new templates.')
      .addText((text) => {
        text.setValue(name).onChange((v) => { name = v; });
        if (isEdit) {
          text.setDisabled(true);
        }
      });

    new Setting(this.contentEl)
      .setName('Description')
      .setDesc('Optional one-line summary shown under the name in the picker.')
      .addText((text) => {
        text.setValue(description).onChange((v) => { description = v; });
      });

    const iconSetting = new Setting(this.contentEl)
      .setName('Icon')
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Lucide" is the icon library brand name.
      .setDesc('Optional Lucide icon for the picker row.');
    iconSetting.settingEl.addClass('claudian-icon-picker-setting');
    this.iconPicker = new LucideIconPicker(iconSetting.controlEl, {
      value: icon,
      onChange: (v) => { icon = v; },
    });

    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const providerOptions = providerOptionList(settings);

    new Setting(this.contentEl)
      .setName('Provider')
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
      .setDesc('Optional. Falls back to the Agent Board default provider when unset.')
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
      .setName('Model')
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
      .setDesc('Optional. Falls back to the Agent Board default model when unset.');
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
      .setName('Priority')
      .setDesc('Optional. Falls back to normal when unset.')
      .addDropdown((dd) => {
        for (const opt of PRIORITY_OPTIONS) {
          dd.addOption(opt.value, opt.label);
        }
        dd.setValue(priority);
        dd.onChange((v) => { priority = v as '' | TaskPriority; });
      });

    const bodySetting = new Setting(this.contentEl)
      .setName('Body')
      .setDesc('Template body. Placeholders: {{title}}, {{date}}, {{source}}.')
      .addTextArea((area) => {
        area.setValue(body).onChange((v) => { body = v; });
        area.inputEl.rows = 12;
        area.inputEl.addClass('claudian-wo-template-body-input');
      });
    bodySetting.settingEl.addClass('claudian-wo-template-body-setting');

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText('Save')
          .setCta()
          .onClick(() => {
            void this.handleSave({ name, description, icon, provider, model, priority, body });
          });
      })
      .addButton((btn) => {
        btn.setButtonText('Cancel').onClick(() => this.close());
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
    body: string;
  }): Promise<void> {
    const trimmedName = form.name.trim();
    const trimmedBody = form.body.trim();
    if (!trimmedName) {
      new Notice('Template name is required.');
      return;
    }
    if (!trimmedBody) {
      new Notice('Template body is required.');
      return;
    }

    const payload: WorkOrderTemplateEditorPayload = {
      name: trimmedName,
      description: form.description.trim() || undefined,
      icon: form.icon.trim() || undefined,
      provider: form.provider.trim() || undefined,
      model: form.model.trim() || undefined,
      priority: form.priority || undefined,
      body: trimmedBody,
      originalPath: this.existing?.path,
    };

    try {
      await this.onSave(payload);
      this.close();
    } catch (error) {
      new Notice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function providerOptionList(settings: Record<string, unknown>): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: '', label: 'Use default' }];
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
  const options: Array<{ value: string; label: string }> = [{ value: '', label: 'Use default' }];
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
