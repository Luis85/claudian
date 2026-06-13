import { type App, Modal, Notice, Setting } from 'obsidian';

import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { t } from '../../../i18n/i18n';
import { renderSettingsListItem, type SettingsActionButtonOptions } from '../../../shared/components/settingsListUI';
import { validateCommandName } from '../../../utils/slashCommand';
import {
  CODEX_SKILL_ROOT_OPTIONS,
  type CodexSkillRootId,
  createCodexSkillPersistenceKey,
  parseCodexSkillPersistenceKey,
} from '../storage/CodexSkillStorage';
import { renderCodexModalFooter } from './codexSettingsModal';
import { CodexVaultListSettings } from './codexVaultListSettings';

export class CodexSkillModal extends Modal {
  private existing: ProviderCommandEntry | null;
  private onSave: (entry: ProviderCommandEntry) => Promise<void>;

  private _nameInput!: HTMLInputElement;
  private _descInput!: HTMLInputElement;
  private _contentArea!: HTMLTextAreaElement;
  private _selectedRootId: CodexSkillRootId;
  private _triggerSave!: () => Promise<void>;

  constructor(
    app: App,
    existing: ProviderCommandEntry | null,
    onSave: (entry: ProviderCommandEntry) => Promise<void>
  ) {
    super(app);
    this.existing = existing;
    this.onSave = onSave;
    this._selectedRootId = parseCodexSkillPersistenceKey(existing?.persistenceKey)?.rootId ?? 'vault-codex';
  }

  /** Exposed for unit tests only. */
  getTestInputs() {
    return {
      nameInput: this._nameInput,
      descInput: this._descInput,
      contentArea: this._contentArea,
      setDirectory: (rootId: CodexSkillRootId) => { this._selectedRootId = rootId; },
      triggerSave: this._triggerSave,
    };
  }

  onOpen() {
    this.setTitle(this.existing ? 'Edit Codex Skill' : 'Add Codex Skill');
    this.modalEl.addClass('claudian-sp-modal');

    const { contentEl } = this;

    new Setting(contentEl)
      .setName('Directory')
      .setDesc('Where to store the skill')
      .addDropdown(dropdown => {
        for (const opt of CODEX_SKILL_ROOT_OPTIONS) {
          dropdown.addOption(opt.id, opt.label);
        }
        dropdown.setValue(this._selectedRootId);
        dropdown.onChange(value => { this._selectedRootId = value as CodexSkillRootId; });
      });

    new Setting(contentEl)
      .setName('Skill name')
      .setDesc('The name used after $ (e.g., "analyze" for $analyze)')
      .addText(text => {
        this._nameInput = text.inputEl;
        text.setValue(this.existing?.name || '')
          .setPlaceholder('Analyze-code');
      });

    new Setting(contentEl)
      .setName('Description')
      .setDesc('Optional description shown in dropdown')
      .addText(text => {
        this._descInput = text.inputEl;
        text.setValue(this.existing?.description || '');
      });

    new Setting(contentEl)
      .setName('Instructions')
      .setDesc('The skill instructions (SKILL.md content)');

    const contentArea = contentEl.createEl('textarea', {
      cls: 'claudian-sp-content-area',
      attr: { rows: '10', placeholder: 'Analyze the code for...' },
    });
    contentArea.value = this.existing?.content || '';
    this._contentArea = contentArea;

    const doSave = async () => {
      const name = this._nameInput.value.trim();
      const nameError = validateCommandName(name);
      if (nameError) {
        new Notice(t(nameError.key, nameError.params));
        return;
      }

      const content = this._contentArea.value;
      if (!content.trim()) {
        new Notice(t('provider.codex.skill.instructionsRequired'));
        return;
      }

      const entry: ProviderCommandEntry = {
        id: this.existing?.id || `codex-skill-${name}`,
        providerId: 'codex',
        kind: 'skill',
        name,
        description: this._descInput.value.trim() || undefined,
        content,
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '$',
        insertPrefix: '$',
        persistenceKey: createCodexSkillPersistenceKey({
          rootId: this._selectedRootId,
          ...(this.existing?.name ? { currentName: this.existing.name } : {}),
        }),
      };

      try {
        await this.onSave(entry);
      } catch {
        new Notice(t('provider.codex.skill.saveFailed'));
        return;
      }
      this.close();
    };
    this._triggerSave = doSave;

    renderCodexModalFooter(contentEl, {
      onCancel: () => this.close(),
      onSave: doSave,
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class CodexSkillSettings extends CodexVaultListSettings<ProviderCommandEntry> {
  private catalog: ProviderCommandCatalog;
  private app?: App;

  constructor(containerEl: HTMLElement, catalog: ProviderCommandCatalog, app?: App) {
    super(containerEl);
    this.catalog = catalog;
    this.app = app;
    void this.render();
  }

  async deleteEntry(entry: ProviderCommandEntry): Promise<void> {
    await this.catalog.deleteVaultEntry(entry);
    await this.render();
  }

  async refresh(): Promise<void> {
    await this.catalog.refresh();
    await this.render();
  }

  protected getLabel(): string {
    return 'Codex Skills';
  }

  protected getEmptyText(): string {
    return 'No Codex skills in vault. Click + to create one.';
  }

  protected loadItems(): Promise<ProviderCommandEntry[]> {
    return this.catalog.listVaultEntries();
  }

  protected onRefresh(): void {
    void this.refresh();
  }

  protected renderItem(listEl: HTMLElement, entry: ProviderCommandEntry): void {
    const actions: SettingsActionButtonOptions[] = [];

    if (entry.isEditable) {
      actions.push({ icon: 'pencil', ariaLabel: 'Edit', onClick: () => this.openModal(entry) });
    }

    if (entry.isDeletable) {
      actions.push({
        icon: 'trash-2',
        ariaLabel: 'Delete',
        danger: true,
        onClick: () => {
          void (async (): Promise<void> => {
          try {
            await this.deleteEntry(entry);
            new Notice(t('provider.codex.skill.deleted', { name: entry.name }));
          } catch {
            new Notice(t('provider.codex.skill.deleteFailed'));
          }
          })();
        },
      });
    }

    const { headerRow } = renderSettingsListItem(listEl, {
      name: `$${entry.name}`,
      description: entry.description,
      actions,
    });

    headerRow.createSpan({ text: 'skill', cls: 'claudian-slash-item-badge' });
  }

  protected openModal(existing: ProviderCommandEntry | null): void {
    if (!this.app) return;

    const modal = new CodexSkillModal(
      this.app,
      existing,
      async (entry) => {
        await this.catalog.saveVaultEntry(entry);
        await this.render();
        new Notice(t(
          existing ? 'provider.codex.skill.updated' : 'provider.codex.skill.created',
          { name: entry.name },
        ));
      }
    );
    modal.open();
  }
}
