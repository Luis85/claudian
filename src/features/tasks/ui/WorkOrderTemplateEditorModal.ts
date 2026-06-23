import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type SpecoratorPlugin from '../../../main';
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

/** Mutable editor form state. Optional template fields use '' to mean "unset". */
interface TemplateEditorForm {
  name: string;
  description: string;
  icon: string;
  provider: string;
  model: string;
  priority: '' | TaskPriority;
  loop: string;
  agent: string;
  body: string;
}

export class WorkOrderTemplateEditorModal extends Modal {
  private iconPicker: LucideIconPicker | null = null;
  private modelDropdownContainer: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly plugin: SpecoratorPlugin,
    private readonly existing: WorkOrderTemplate | null,
    private readonly onSave: (payload: WorkOrderTemplateEditorPayload) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const isEdit = Boolean(this.existing);
    this.setTitle(isEdit ? t('tasks.templateEditor.titleEdit') : t('tasks.templateEditor.titleNew'));
    this.modalEl.addClass('specorator-sp-modal', 'specorator-wo-template-editor-modal');

    const form = this.initialForm();

    addNameAndDescriptionRows(this.contentEl, {
      name: {
        name: t('tasks.templateEditor.nameName'),
        desc: t('tasks.templateEditor.nameDesc'),
        value: form.name,
        onChange: (v) => { form.name = v; },
        disabled: isEdit,
      },
      description: {
        name: t('tasks.templateEditor.descriptionName'),
        desc: t('tasks.templateEditor.descriptionDesc'),
        value: form.description,
        onChange: (v) => { form.description = v; },
      },
    });

    this.iconPicker = addIconPickerRow(this.contentEl, {
      name: t('tasks.templateEditor.iconName'),
      desc: t('tasks.templateEditor.iconDesc'),
      value: form.icon,
      onChange: (v) => { form.icon = v; },
    });

    const settings = asSettingsBag(this.plugin.settings);
    const providerOptions = providerOptionList(settings);
    const setModel = (value: string): void => { form.model = value; };

    new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.providerName'))
      .setDesc(t('tasks.templateEditor.providerDesc'))
      .addDropdown((dd) => {
        for (const opt of providerOptions) {
          dd.addOption(opt.value, opt.label);
        }
        dd.setValue(form.provider);
        dd.onChange((v) => {
          form.provider = v;
          form.model = '';
          this.renderModelDropdown(form.provider, form.model, settings, setModel);
        });
      });

    const modelSetting = new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.modelName'))
      .setDesc(t('tasks.templateEditor.modelDesc'));
    this.modelDropdownContainer = modelSetting.controlEl;
    this.renderModelDropdown(form.provider, form.model, settings, setModel);

    new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.priorityName'))
      .setDesc(t('tasks.templateEditor.priorityDesc'))
      .addDropdown((dd) => {
        for (const opt of PRIORITY_OPTIONS) {
          dd.addOption(opt.value, opt.label ?? t('tasks.templateEditor.useDefault'));
        }
        dd.setValue(form.priority);
        dd.onChange((v) => { form.priority = v as '' | TaskPriority; });
      });

    // Loop + agent selectors: rendered synchronously then populated async so
    // modal open is not blocked on vault I/O. Each value is seeded from
    // `existing`, so a save that never touches the dropdown preserves it; the
    // empty option ("No loop" / "Use default") leaves that field unset. The
    // agent's empty option means the work order keeps no agent (Standard persona).
    this.addAsyncSelect({
      name: t('tasks.templateEditor.loopName'),
      desc: t('tasks.templateEditor.loopDesc'),
      emptyLabel: t('tasks.templateEditor.loopNone'),
      current: form.loop,
      onChange: (value) => { form.loop = value; },
      populate: (select, current) => this.populateLoopOptions(select, current),
    });
    this.addAsyncSelect({
      name: t('tasks.templateEditor.agentName'),
      desc: t('tasks.templateEditor.agentDesc'),
      emptyLabel: t('tasks.templateEditor.useDefault'),
      current: form.agent,
      onChange: (value) => { form.agent = value; },
      populate: (select, current) => this.populateAgentOptions(select, current),
    });

    const bodySetting = new Setting(this.contentEl)
      .setName(t('tasks.templateEditor.bodyName'))
      .setDesc(t('tasks.templateEditor.bodyDesc'))
      .addTextArea((area) => {
        area.setValue(form.body).onChange((v) => { form.body = v; });
        area.inputEl.rows = 12;
        area.inputEl.addClass('specorator-wo-template-body-input');
      });
    bodySetting.settingEl.addClass('specorator-wo-template-body-setting');

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText(t('tasks.templateEditor.save'))
          .setCta()
          .onClick(() => {
            void this.handleSave(form);
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

  /** Seed the editable form from the existing template (or blank defaults for a new one). */
  private initialForm(): TemplateEditorForm {
    const existing = this.existing;
    return {
      name: existing?.name ?? '',
      description: existing?.description ?? '',
      icon: existing?.icon ?? '',
      provider: existing?.provider ?? '',
      model: existing?.model ?? '',
      priority: existing?.priority ?? '',
      loop: existing?.loop ?? '',
      agent: existing?.agent ?? '',
      body: existing?.body ?? defaultBody(),
    };
  }

  private async handleSave(form: TemplateEditorForm): Promise<void> {
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
      agent: form.agent.trim() || undefined,
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

  /** (Re)render the model dropdown for the selected provider into its container. */
  private renderModelDropdown(
    providerId: string,
    currentModel: string,
    settings: Record<string, unknown>,
    onChange: (value: string) => void,
  ): void {
    if (!this.modelDropdownContainer) return;
    this.modelDropdownContainer.empty();
    const select = this.modelDropdownContainer.createEl('select', { cls: 'dropdown' });
    for (const opt of modelOptionList(providerId, settings)) {
      const optionEl = select.createEl('option', { text: opt.label });
      optionEl.value = opt.value;
      if (opt.value === currentModel) optionEl.selected = true;
    }
    select.addEventListener('change', () => onChange(select.value));
  }

  /**
   * Render a `<select>` setting that is populated asynchronously. Mirrors the
   * provider/priority dropdowns but for fields whose options come from vault I/O
   * (loops) or the roster (agents); kept generic so `onOpen` stays flat.
   */
  private addAsyncSelect(opts: {
    name: string;
    desc: string;
    emptyLabel: string;
    current: string;
    onChange: (value: string) => void;
    populate: (select: HTMLSelectElement, current: string) => Promise<void>;
  }): void {
    const setting = new Setting(this.contentEl).setName(opts.name).setDesc(opts.desc);
    const select = setting.controlEl.createEl('select', { cls: 'dropdown' });
    const emptyOpt = select.createEl('option', { text: opts.emptyLabel });
    emptyOpt.value = '';
    select.addEventListener('change', () => opts.onChange(select.value));
    void opts.populate(select, opts.current);
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

  private async populateAgentOptions(select: HTMLSelectElement, current: string): Promise<void> {
    const agents = (await this.plugin.agentRosterStore?.list()) ?? [];
    for (const agent of agents) {
      const opt = select.createEl('option', { text: agent.name });
      opt.value = agent.id;
      if (agent.id === current) opt.selected = true;
    }
    // Preserve an unknown stored id (e.g. an agent deleted after assignment) so a
    // save without touching the dropdown does not silently drop it.
    if (current && !agents.some((agent) => agent.id === current)) {
      const opt = select.createEl('option', { text: current });
      opt.value = current;
      opt.selected = true;
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
