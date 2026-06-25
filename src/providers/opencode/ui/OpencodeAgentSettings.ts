import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { renderModalButtonRow } from '../../../shared/components/settingsListUI';
import {
  renderVaultAgentListItem,
  renderVaultListPanel,
} from '../../../shared/settings/vaultAgentListPanel';
import type { OpencodeAgentStorage } from '../storage/OpencodeAgentStorage';
import type { OpencodeAgentDefinition } from '../types/agent';
import {
  parseOptionalJson,
  parseOptionalJsonObject,
  parseOptionalJsonObjectOfBooleans,
  parseOptionalNumber,
  parseOptionalPositiveInteger,
} from './opencodeAgentFormParsers';
import {
  findOpencodeAgentNameConflict,
  validateOpencodeAgentName,
} from './opencodeAgentValidation';

export {
  findOpencodeAgentNameConflict,
  validateOpencodeAgentName,
} from './opencodeAgentValidation';

interface OpencodeAgentFormRefs {
  nameInput: HTMLInputElement;
  descriptionInput: HTMLInputElement;
  modelInput: HTMLInputElement;
  variantInput: HTMLInputElement;
  temperatureInput: HTMLInputElement;
  topPInput: HTMLInputElement;
  colorInput: HTMLInputElement;
  stepsInput: HTMLInputElement;
  toolsInput: HTMLTextAreaElement;
  permissionInput: HTMLTextAreaElement;
  optionsInput: HTMLTextAreaElement;
  promptArea: HTMLTextAreaElement;
  getHidden: () => boolean;
  getDisable: () => boolean;
}

function hasOpencodeAdvancedFields(existing: OpencodeAgentDefinition | null): boolean {
  if (!existing) {
    return false;
  }

  return Boolean(
    existing.model
    || existing.variant
    || existing.temperature !== undefined
    || existing.topP !== undefined
    || existing.color
    || existing.steps !== undefined
    || existing.hidden
    || existing.disable
    || existing.tools
    || existing.permission !== undefined
    || existing.options,
  );
}

class OpencodeAgentModal extends Modal {
  private existing: OpencodeAgentDefinition | null;
  private allAgents: OpencodeAgentDefinition[];
  private onSave: (agent: OpencodeAgentDefinition) => Promise<void>;

  constructor(
    app: App,
    existing: OpencodeAgentDefinition | null,
    allAgents: OpencodeAgentDefinition[],
    onSave: (agent: OpencodeAgentDefinition) => Promise<void>,
  ) {
    super(app);
    this.existing = existing;
    this.allAgents = allAgents;
    this.onSave = onSave;
  }

  onOpen() {
    this.setTitle(this.existing ? 'Edit OpenCode Subagent' : 'Add OpenCode Subagent');
    this.modalEl.addClass('specorator-sp-modal');

    const { contentEl } = this;
    const refs = this.buildForm(contentEl);

    renderModalButtonRow(contentEl, {
      cls: 'specorator-sp-modal-buttons',
      saveText: 'Save',
      onCancel: () => this.close(),
      onSave: () => {
        void this.collectAndSave(refs);
      },
    });
  }

  private buildForm(contentEl: HTMLElement): OpencodeAgentFormRefs {
    const basic = this.buildBasicFields(contentEl);
    const advanced = this.buildAdvancedFields(contentEl);
    const promptArea = this.buildPromptField(contentEl);
    return { ...basic, ...advanced, promptArea };
  }

  private buildBasicFields(contentEl: HTMLElement): {
    nameInput: HTMLInputElement;
    descriptionInput: HTMLInputElement;
  } {
    let nameInput!: HTMLInputElement;
    let descriptionInput!: HTMLInputElement;

    new Setting(contentEl)
      .setName('Name')
      .setDesc('OpenCode agent name. Use slash-separated segments for nested agents.')
      .addText((text) => {
        nameInput = text.inputEl;
        text.setValue(this.existing?.name ?? '')
          .setPlaceholder('Review');
      });

    new Setting(contentEl)
      .setName('Description')
      .setDesc('When OpenCode should use this subagent')
      .addText((text) => {
        descriptionInput = text.inputEl;
        text.setValue(this.existing?.description ?? '')
          .setPlaceholder('Reviews code for correctness and maintainability');
      });

    return { nameInput, descriptionInput };
  }

  private buildAdvancedFields(contentEl: HTMLElement): Omit<
    OpencodeAgentFormRefs,
    'nameInput' | 'descriptionInput' | 'promptArea'
  > {
    let modelInput!: HTMLInputElement;
    let variantInput!: HTMLInputElement;
    let temperatureInput!: HTMLInputElement;
    let topPInput!: HTMLInputElement;
    let colorInput!: HTMLInputElement;
    let stepsInput!: HTMLInputElement;
    let hiddenValue = this.existing?.hidden ?? false;
    let disableValue = this.existing?.disable ?? false;
    let toolsInput!: HTMLTextAreaElement;
    let permissionInput!: HTMLTextAreaElement;
    let optionsInput!: HTMLTextAreaElement;

    const details = contentEl.createEl('details', { cls: 'specorator-sp-advanced-section' });
    details.createEl('summary', {
      text: 'Advanced options',
      cls: 'specorator-sp-advanced-summary',
    });
    if (hasOpencodeAdvancedFields(this.existing)) {
      details.open = true;
    }

    new Setting(details)
      .setName('Model')
      .setDesc('Model override in provider/model format')
      .addText((text) => {
        modelInput = text.inputEl;
        text.setValue(this.existing?.model ?? '')
          .setPlaceholder('Anthropic/Claude-sonnet-4-20250514');
      });

    new Setting(details)
      .setName('Variant')
      .setDesc('Model variant override')
      .addText((text) => {
        variantInput = text.inputEl;
        text.setValue(this.existing?.variant ?? '')
          .setPlaceholder('High');
      });

    new Setting(details)
      .setName('Temperature')
      .setDesc('Optional sampling temperature')
      .addText((text) => {
        temperatureInput = text.inputEl;
        text.setValue(this.existing?.temperature !== undefined ? String(this.existing.temperature) : '')
          .setPlaceholder('0.1');
      });

    new Setting(details)
      .setName('Top p')
      .setDesc('Optional nucleus sampling value')
      .addText((text) => {
        topPInput = text.inputEl;
        text.setValue(this.existing?.topP !== undefined ? String(this.existing.topP) : '')
          .setPlaceholder('0.9');
      });

    new Setting(details)
      .setName('Color')
      .setDesc('Hex color or theme token')
      .addText((text) => {
        colorInput = text.inputEl;
        text.setValue(this.existing?.color ?? '')
          .setPlaceholder('#Ff5733');
      });

    new Setting(details)
      .setName('Steps')
      .setDesc('Maximum agentic iterations before forcing text-only output')
      .addText((text) => {
        stepsInput = text.inputEl;
        text.setValue(this.existing?.steps !== undefined ? String(this.existing.steps) : '')
          .setPlaceholder('10');
      });

    new Setting(details)
      .setName('Hide from @mention')
      .setDesc('Hide this subagent from the @ autocomplete menu')
      .addToggle((toggle) => {
        toggle.setValue(hiddenValue).onChange((value) => {
          hiddenValue = value;
        });
      });

    new Setting(details)
      .setName('Disable agent')
      .setDesc('Disable the agent without deleting the file')
      .addToggle((toggle) => {
        toggle.setValue(disableValue).onChange((value) => {
          disableValue = value;
        });
      });

    new Setting(details)
      .setName('Enabled tools (JSON)')
      .setDesc('Optional deprecated tools map, e.g. {"write":false,"edit":false}')
      .addTextArea((text) => {
        toolsInput = text.inputEl;
        text.setValue(this.existing?.tools ? JSON.stringify(this.existing.tools, null, 2) : '')
          .setPlaceholder('{\n  "write": false,\n  "edit": false\n}');
      });

    new Setting(details)
      .setName('Permission (JSON)')
      .setDesc('Optional permission config, e.g. {"edit":"deny","bash":"allow"}')
      .addTextArea((text) => {
        permissionInput = text.inputEl;
        text.setValue(this.existing?.permission !== undefined ? JSON.stringify(this.existing.permission, null, 2) : '')
          .setPlaceholder('{\n  "edit": "deny"\n}');
      });

    new Setting(details)
      .setName('Options (JSON)')
      .setDesc('Optional custom agent options')
      .addTextArea((text) => {
        optionsInput = text.inputEl;
        text.setValue(this.existing?.options ? JSON.stringify(this.existing.options, null, 2) : '')
          .setPlaceholder('{\n  "focus": "security"\n}');
      });

    return {
      modelInput,
      variantInput,
      temperatureInput,
      topPInput,
      colorInput,
      stepsInput,
      toolsInput,
      permissionInput,
      optionsInput,
      getHidden: () => hiddenValue,
      getDisable: () => disableValue,
    };
  }

  private buildPromptField(contentEl: HTMLElement): HTMLTextAreaElement {
    new Setting(contentEl)
      .setName('Prompt')
      .setDesc('Markdown body used as the agent prompt');

    const promptArea = contentEl.createEl('textarea', {
      cls: 'specorator-sp-content-area',
      attr: {
        rows: '10',
        placeholder: 'Review code changes carefully and call out correctness, regressions, and missing coverage.',
      },
    });
    promptArea.value = this.existing?.prompt ?? '';
    return promptArea;
  }

  private async collectAndSave(refs: OpencodeAgentFormRefs): Promise<void> {
    const agent = this.collectAgent(refs);
    if (!agent) {
      return;
    }

    try {
      await this.onSave(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(t('provider.opencode.subagent.saveFailed', { message }));
      return;
    }
    this.close();
  }

  private collectAgent(refs: OpencodeAgentFormRefs): OpencodeAgentDefinition | null {
    const name = refs.nameInput.value.trim();
    const nameError = validateOpencodeAgentName(name);
    if (nameError) {
      new Notice(t(nameError.key, nameError.params));
      return null;
    }

    const description = refs.descriptionInput.value.trim();
    if (!description) {
      new Notice(t('provider.opencode.subagent.descriptionRequired'));
      return null;
    }

    const prompt = refs.promptArea.value;
    if (!prompt.trim()) {
      new Notice(t('provider.opencode.subagent.promptRequired'));
      return null;
    }

    const duplicate = findOpencodeAgentNameConflict(
      this.allAgents,
      name,
      this.existing?.persistenceKey,
    );
    if (duplicate) {
      new Notice(t('provider.opencode.subagent.duplicate', { name }));
      return null;
    }

    const numeric = this.collectNumericFields(refs);
    if (!numeric) {
      return null;
    }

    const json = this.collectJsonFields(refs);
    if (!json) {
      return null;
    }

    return {
      name,
      description,
      prompt,
      mode: 'subagent',
      hidden: refs.getHidden() || undefined,
      disable: refs.getDisable() || undefined,
      model: refs.modelInput.value.trim() || undefined,
      variant: refs.variantInput.value.trim() || undefined,
      temperature: numeric.temperature,
      topP: numeric.topP,
      color: refs.colorInput.value.trim() || undefined,
      steps: numeric.steps,
      tools: json.tools,
      permission: json.permission,
      options: json.options,
      persistenceKey: this.existing?.persistenceKey,
      extraFrontmatter: this.existing?.extraFrontmatter,
    };
  }

  private collectNumericFields(refs: OpencodeAgentFormRefs): {
    temperature?: number;
    topP?: number;
    steps?: number;
  } | null {
    const temperature = parseOptionalNumber(refs.temperatureInput.value, 'Temperature');
    if (temperature.error) {
      new Notice(temperature.error);
      return null;
    }

    const topP = parseOptionalNumber(refs.topPInput.value, 'Top P');
    if (topP.error) {
      new Notice(topP.error);
      return null;
    }

    const steps = parseOptionalPositiveInteger(refs.stepsInput.value, 'Steps');
    if (steps.error) {
      new Notice(steps.error);
      return null;
    }

    return { temperature: temperature.value, topP: topP.value, steps: steps.value };
  }

  private collectJsonFields(refs: OpencodeAgentFormRefs): {
    tools?: Record<string, boolean>;
    permission?: unknown;
    options?: Record<string, unknown>;
  } | null {
    const tools = parseOptionalJsonObjectOfBooleans(refs.toolsInput.value, 'Enabled Tools');
    if (tools.error) {
      new Notice(tools.error);
      return null;
    }

    const permission = parseOptionalJson(refs.permissionInput.value, 'Permission');
    if (permission.error) {
      new Notice(permission.error);
      return null;
    }

    const options = parseOptionalJsonObject(refs.optionsInput.value, 'Options');
    if (options.error) {
      new Notice(options.error);
      return null;
    }

    return { tools: tools.value, permission: permission.value, options: options.value };
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class OpencodeAgentSettings {
  private containerEl: HTMLElement;
  private storage: OpencodeAgentStorage;
  private agents: OpencodeAgentDefinition[] = [];
  private app?: App;
  private onChanged?: () => Promise<void> | void;

  constructor(
    containerEl: HTMLElement,
    storage: OpencodeAgentStorage,
    app?: App,
    onChanged?: () => Promise<void> | void,
  ) {
    this.containerEl = containerEl;
    this.storage = storage;
    this.app = app;
    this.onChanged = onChanged;
    void this.render();
  }

  async render(): Promise<void> {
    this.containerEl.empty();

    try {
      this.agents = await this.storage.loadAll();
    } catch {
      this.agents = [];
    }

    const visibleAgents = this.agents.filter((agent) => agent.mode === 'subagent');

    renderVaultListPanel(this.containerEl, {
      label: 'OpenCode Subagents',
      emptyText: 'No OpenCode subagents in vault. Click + to create one.',
      items: visibleAgents,
      onRefresh: () => { void this.render(); },
      onAdd: () => this.openModal(null),
      renderItem: (listEl, agent) => this.renderItem(listEl, agent),
    });
  }

  private renderItem(listEl: HTMLElement, agent: OpencodeAgentDefinition): void {
    const { headerRow } = renderVaultAgentListItem(listEl, this.app, {
      name: agent.name,
      description: agent.description,
      onEdit: () => this.openModal(agent),
      deleteConfirmMessage: `Delete subagent "${agent.name}"?`,
      onDelete: async () => {
        await this.storage.delete(agent);
        await this.render();
        await this.onChanged?.();
        new Notice(t('provider.opencode.subagent.deleted', { name: agent.name }));
      },
      onDeleteFailed: () => {
        new Notice(t('provider.opencode.subagent.deleteFailed'));
      },
    });

    headerRow.createSpan({
      text: 'subagent',
      cls: 'specorator-slash-item-badge',
    });

    if (agent.model) {
      headerRow.createSpan({ text: agent.model, cls: 'specorator-slash-item-badge' });
    }
  }

  private openModal(existing: OpencodeAgentDefinition | null): void {
    if (!this.app) return;

    const modal = new OpencodeAgentModal(
      this.app,
      existing,
      this.agents,
      async (agent) => {
        await this.storage.save(agent, existing);
        await this.render();
        await this.onChanged?.();
        new Notice(
          existing
            ? t('provider.opencode.subagent.updated', { name: agent.name })
            : t('provider.opencode.subagent.created', { name: agent.name }),
        );
      },
    );
    modal.open();
  }
}
