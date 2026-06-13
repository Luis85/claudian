import type { App, ToggleComponent } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { t } from '../../../i18n/i18n';
import type { TranslationKey, ValidationError } from '../../../i18n/types';
import { renderModalButtonRow, renderSettingsListItem, type SettingsActionButtonOptions } from '../../../shared/components/settingsListUI';
import { extractFirstParagraph, parseSlashCommandContent, validateCommandName } from '../../../utils/slashCommand';
import {
  buildCommandEntry,
  isSkillEntry,
  shouldOpenAdvanced,
  type SlashCommandFormState,
  type SlashCommandType,
} from './slashCommandEntryBuilder';

export class SlashCommandModal extends Modal {
  private entries: ProviderCommandEntry[];
  private existingEntry: ProviderCommandEntry | null;
  private onSave: (entry: ProviderCommandEntry) => Promise<void>;

  constructor(
    app: App,
    entries: ProviderCommandEntry[],
    existingEntry: ProviderCommandEntry | null,
    onSave: (entry: ProviderCommandEntry) => Promise<void>,
  ) {
    super(app);
    this.entries = entries;
    this.existingEntry = existingEntry;
    this.onSave = onSave;
  }

  private typeLabel(selectedType: SlashCommandType): string {
    return selectedType === 'skill' ? 'Skill' : 'Slash Command';
  }

  private applyTitle(selectedType: SlashCommandType): void {
    const label = this.typeLabel(selectedType);
    this.setTitle(this.existingEntry ? `Edit ${label}` : `Add ${label}`);
  }

  private buildPrimaryFields(contentEl: HTMLElement, state: SlashCommandFormState): void {
    const skillOnly: { setting: Setting | null; toggle: ToggleComponent | null } = {
      setting: null,
      toggle: null,
    };
    const updateSkillOnlyFields = () => {
      if (!skillOnly.setting || !skillOnly.toggle) return;
      const isSkillType = state.selectedType === 'skill';
      skillOnly.setting.settingEl.toggleClass('claudian-hidden', !isSkillType);
      if (!isSkillType) {
        state.disableUserInvocation = false;
        skillOnly.toggle.setValue(false);
      }
    };

    new Setting(contentEl)
      .setName('Type')
      .setDesc('Command or skill')
      .addDropdown(dropdown => {
        dropdown
          .addOption('command', 'Command')
          .addOption('skill', 'Skill')
          .setValue(state.selectedType)
          .onChange(value => {
            state.selectedType = value as SlashCommandType;
            this.applyTitle(state.selectedType);
            updateSkillOnlyFields();
          });
        if (this.existingEntry) {
          dropdown.setDisabled(true);
        }
      });

    new Setting(contentEl)
      .setName('Command name')
      .setDesc('The name used after / (e.g., "review" for /review)')
      .addText(text => {
        state.nameInput = text.inputEl;
        text.setValue(this.existingEntry?.name || '').setPlaceholder('Review-code');
      });

    new Setting(contentEl)
      .setName('Description')
      .setDesc('Optional description shown in dropdown')
      .addText(text => {
        state.descInput = text.inputEl;
        text.setValue(this.existingEntry?.description || '');
      });

    this.buildAdvancedFields(contentEl, state, skillOnly);
    updateSkillOnlyFields();
  }

  private buildAdvancedFields(
    contentEl: HTMLElement,
    state: SlashCommandFormState,
    skillOnly: { setting: Setting | null; toggle: ToggleComponent | null },
  ): void {
    const details = contentEl.createEl('details', { cls: 'claudian-sp-advanced-section' });
    details.createEl('summary', { text: 'Advanced options', cls: 'claudian-sp-advanced-summary' });
    if (shouldOpenAdvanced(this.existingEntry)) {
      details.open = true;
    }

    new Setting(details)
      .setName('Argument hint')
      .setDesc('Placeholder text for arguments (e.g., "[file] [focus]")')
      .addText(text => {
        state.hintInput = text.inputEl;
        text.setValue(this.existingEntry?.argumentHint || '');
      });

    new Setting(details)
      .setName('Model override')
      .setDesc('Optional model to use for this command')
      .addText(text => {
        state.modelInput = text.inputEl;
        text.setValue(this.existingEntry?.model || '').setPlaceholder('Claude-sonnet-4-5');
      });

    new Setting(details)
      .setName('Allowed tools')
      .setDesc('Comma-separated list of tools to allow (empty = all)')
      .addText(text => {
        state.toolsInput = text.inputEl;
        text.setValue(this.existingEntry?.allowedTools?.join(', ') || '');
      });

    new Setting(details)
      .setName('Disable model invocation')
      .setDesc('Prevent the model from invoking this command itself')
      .addToggle(toggle => {
        toggle.setValue(state.disableModelToggle)
          .onChange(value => { state.disableModelToggle = value; });
      });

    skillOnly.setting = new Setting(details)
      .setName('Disable user invocation')
      .setDesc('Prevent the user from invoking this skill directly')
      .addToggle(toggle => {
        skillOnly.toggle = toggle;
        toggle.setValue(state.disableUserInvocation)
          .onChange(value => { state.disableUserInvocation = value; });
      });

    this.buildContextFields(details, state);
  }

  private buildContextFields(details: HTMLElement, state: SlashCommandFormState): void {
    new Setting(details)
      .setName('Context')
      .setDesc('Run in a subagent (fork)')
      .addToggle(toggle => {
        toggle.setValue(state.contextValue === 'fork')
          .onChange(value => {
            state.contextValue = value ? 'fork' : '';
            agentSetting.settingEl.toggleClass('claudian-hidden', !value);
          });
      });

    const agentSetting = new Setting(details)
      .setName('Agent')
      .setDesc('Subagent type when context is fork')
      .addText(text => {
        state.agentInput = text.inputEl;
        text.setValue(this.existingEntry?.agent || '').setPlaceholder('Code-reviewer');
      });
    agentSetting.settingEl.toggleClass('claudian-hidden', state.contextValue !== 'fork');
  }

  private buildPromptField(contentEl: HTMLElement, state: SlashCommandFormState): void {
    new Setting(contentEl)
      .setName('Prompt template')
      .setDesc('Use $ARGUMENTS, $1, $2, @file, !`bash`');

    state.contentArea = contentEl.createEl('textarea', {
      cls: 'claudian-sp-content-area',
      attr: { rows: '10', placeholder: 'Review this code for:\n$ARGUMENTS\n\n@$1' },
    });
    state.contentArea.value = this.existingEntry
      ? parseSlashCommandContent(this.existingEntry.content).promptContent
      : '';
  }

  /** Validate form input; returns a translation key + params on failure, null when valid. */
  private validateForm(state: SlashCommandFormState): ValidationError | null {
    const name = state.nameInput.value.trim();
    const nameError = validateCommandName(name);
    if (nameError) return nameError;

    if (!state.contentArea.value.trim()) {
      return { key: 'settings.slashCommands.promptRequired' as TranslationKey };
    }

    const duplicate = this.entries.find(
      entry => entry.name.toLowerCase() === name.toLowerCase()
        && entry.id !== this.existingEntry?.id,
    );
    if (duplicate) {
      return { key: 'settings.slashCommands.commandDuplicate' as TranslationKey, params: { name } };
    }
    return null;
  }

  private async submit(state: SlashCommandFormState): Promise<void> {
    const error = this.validateForm(state);
    if (error) {
      new Notice(t(error.key, error.params));
      return;
    }

    const entry = buildCommandEntry(state, this.existingEntry);
    try {
      await this.onSave(entry);
    } catch {
      new Notice(t(
        state.selectedType === 'skill'
          ? 'settings.slashCommands.skillSaveFailed'
          : 'settings.slashCommands.commandSaveFailed',
      ));
      return;
    }
    this.close();
  }

  onOpen() {
    const existingIsSkill = this.existingEntry ? isSkillEntry(this.existingEntry) : false;
    const state = {
      selectedType: existingIsSkill ? 'skill' : 'command',
      disableModelToggle: this.existingEntry?.disableModelInvocation ?? false,
      disableUserInvocation: this.existingEntry?.userInvocable === false,
      contextValue: this.existingEntry?.context ?? '',
    } as SlashCommandFormState;

    this.applyTitle(state.selectedType);
    this.modalEl.addClass('claudian-sp-modal');

    const { contentEl } = this;
    this.buildPrimaryFields(contentEl, state);
    this.buildPromptField(contentEl, state);

    renderModalButtonRow(contentEl, {
      cls: 'claudian-sp-modal-buttons',
      saveText: 'Save',
      onCancel: () => this.close(),
      onSave: () => { void this.submit(state); },
    });

    contentEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class SlashCommandSettings {
  private app: App;
  private containerEl: HTMLElement;
  private catalog: ProviderCommandCatalog | null;
  private commands: ProviderCommandEntry[] = [];

  constructor(
    containerEl: HTMLElement,
    app: App,
    catalog: ProviderCommandCatalog | null,
  ) {
    this.app = app;
    this.containerEl = containerEl;
    this.catalog = catalog;
    void this.loadAndRender();
  }

  private async loadAndRender(): Promise<void> {
    if (!this.catalog) {
      this.renderUnavailable();
      return;
    }

    this.commands = await this.catalog.listVaultEntries();
    this.render();
  }

  private renderUnavailable(): void {
    this.containerEl.empty();
    const emptyEl = this.containerEl.createDiv({ cls: 'claudian-sp-empty-state' });
    emptyEl.setText('Claude command catalog is unavailable.');
  }

  private render(): void {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-sp-header' });
    headerEl.createSpan({ text: t('settings.slashCommands.name'), cls: 'claudian-sp-label' });

    const actionsEl = headerEl.createDiv({ cls: 'claudian-sp-header-actions' });

    const addBtn = actionsEl.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': 'Add' },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => this.openCommandModal(null));

    if (this.commands.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-sp-empty-state' });
      emptyEl.setText('No commands or skills configured. Click + to create one.');
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'claudian-sp-list' });

    for (const cmd of this.commands) {
      this.renderCommandItem(listEl, cmd);
    }
  }

  private renderCommandItem(listEl: HTMLElement, cmd: ProviderCommandEntry): void {
    const actions: SettingsActionButtonOptions[] = [];

    if (cmd.isEditable) {
      actions.push({ icon: 'pencil', ariaLabel: 'Edit', onClick: () => this.openCommandModal(cmd) });
    }

    if (!isSkillEntry(cmd) && cmd.isEditable) {
      actions.push({
        icon: 'package',
        ariaLabel: 'Convert to skill',
        onClick: () => {
          void (async (): Promise<void> => {
          try {
            await this.transformToSkill(cmd);
          } catch {
            new Notice(t('settings.slashCommands.convertFailed'));
          }
          })();
        },
      });
    }

    if (cmd.isDeletable) {
      actions.push({
        icon: 'trash-2',
        ariaLabel: 'Delete',
        danger: true,
        onClick: () => {
          void (async (): Promise<void> => {
          try {
            await this.deleteCommand(cmd);
          } catch {
            new Notice(t(
              isSkillEntry(cmd)
                ? 'settings.slashCommands.skillDeleteFailed'
                : 'settings.slashCommands.commandDeleteFailed',
            ));
          }
          })();
        },
      });
    }

    const { headerRow } = renderSettingsListItem(listEl, {
      name: `/${cmd.name}`,
      description: cmd.description,
      actions,
    });

    if (isSkillEntry(cmd)) {
      headerRow.createSpan({ text: 'skill', cls: 'claudian-slash-item-badge' });
    }

    if (cmd.argumentHint) {
      const hintEl = headerRow.createSpan({ cls: 'claudian-slash-item-hint' });
      hintEl.setText(cmd.argumentHint);
    }
  }

  private openCommandModal(existingCmd: ProviderCommandEntry | null): void {
    const modal = new SlashCommandModal(
      this.app,
      this.commands,
      existingCmd,
      async (cmd) => {
        await this.saveCommand(cmd, existingCmd);
      },
    );
    modal.open();
  }

  private async saveCommand(cmd: ProviderCommandEntry, existing: ProviderCommandEntry | null): Promise<void> {
    if (!this.catalog) {
      return;
    }

    await this.catalog.saveVaultEntry(cmd);

    if (existing && existing.name !== cmd.name) {
      await this.catalog.deleteVaultEntry(existing);
    }

    await this.reloadCommands();

    this.render();
    const isSkill = isSkillEntry(cmd);
    const key = isSkill
      ? (existing ? 'settings.slashCommands.skillUpdated' : 'settings.slashCommands.skillCreated')
      : (existing ? 'settings.slashCommands.commandUpdated' : 'settings.slashCommands.commandCreated');
    new Notice(t(key, { name: cmd.name }));
  }

  private async deleteCommand(cmd: ProviderCommandEntry): Promise<void> {
    if (!this.catalog) {
      return;
    }

    await this.catalog.deleteVaultEntry(cmd);

    await this.reloadCommands();

    this.render();
    new Notice(t(
      isSkillEntry(cmd)
        ? 'settings.slashCommands.skillDeleted'
        : 'settings.slashCommands.commandDeleted',
      { name: cmd.name },
    ));
  }

  private async transformToSkill(cmd: ProviderCommandEntry): Promise<void> {
    if (!this.catalog) {
      return;
    }

    const skillName = cmd.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64);

    const existingSkill = this.commands.find(
      entry => isSkillEntry(entry) && entry.name === skillName,
    );
    if (existingSkill) {
      new Notice(t('settings.slashCommands.skillDuplicate', { name: skillName }));
      return;
    }

    const skill: ProviderCommandEntry = {
      ...cmd,
      id: `skill-${skillName}`,
      kind: 'skill',
      name: skillName,
      description: cmd.description || extractFirstParagraph(cmd.content),
      source: 'user',
      scope: 'vault',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/',
      insertPrefix: '/',
    };

    await this.catalog.saveVaultEntry(skill);
    await this.catalog.deleteVaultEntry(cmd);

    await this.reloadCommands();
    this.render();
    new Notice(t('settings.slashCommands.converted', { name: cmd.name }));
  }

  private async reloadCommands(): Promise<void> {
    if (!this.catalog) {
      this.commands = [];
      return;
    }

    this.commands = await this.catalog.listVaultEntries();
  }

  public refresh(): void {
    void this.loadAndRender();
  }
}
