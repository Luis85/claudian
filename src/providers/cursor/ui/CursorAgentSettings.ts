import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import {
  confirmDeleteListItem,
  renderModalButtonRow,
  renderSettingsListBody,
  renderSettingsListHeader,
  renderSettingsListItem,
} from '../../../shared/components/settingsListUI';
import { type CursorAgentStorage, loadCursorAgentsWithBuiltins } from '../storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '../types/agent';

const INVALID_NAME_PATTERN = /[<>:"/\\|?* ]/;

export function validateCursorAgentName(name: string): string | null {
  if (!name) return t('provider.cursor.subagent.nameRequired');
  if (name !== name.trim()) return t('provider.cursor.subagent.nameWhitespace');
  if (name === '.' || name === '..') return t('provider.cursor.subagent.nameDotSegment');
  if (INVALID_NAME_PATTERN.test(name)) {
    return t('provider.cursor.subagent.nameReservedChars');
  }
  return null;
}

function isEditable(agent: CursorAgentDefinition): boolean {
  return agent.source === 'vault' || agent.source === 'global';
}

function sourceBadge(agent: CursorAgentDefinition): string {
  if (agent.source === 'claude-compat') return 'claude compat';
  if (agent.source === 'codex-compat') return 'codex compat';
  return agent.source;
}

export class CursorAgentSettings {
  private agents: CursorAgentDefinition[] = [];
  private renderNonce = 0;

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly storage: CursorAgentStorage,
    private readonly app?: App,
    private readonly onChanged?: () => Promise<void> | void,
  ) {
    void this.render();
  }

  async render(): Promise<void> {
    const nonce = ++this.renderNonce;

    let loaded: CursorAgentDefinition[];
    try {
      loaded = await loadCursorAgentsWithBuiltins(this.storage);
    } catch {
      loaded = [];
    }

    // A newer render started after our async load; let it win.
    if (nonce !== this.renderNonce) return;

    this.agents = loaded;
    this.containerEl.empty();

    renderSettingsListHeader(this.containerEl, {
      label: 'Cursor subagents',
      // Refresh re-reads disk, so also refresh the @mention cache — otherwise the
      // composer menu stays stale until the next in-app save/delete.
      onRefresh: () => {
        void (async (): Promise<void> => {
          await this.render();
          await this.onChanged?.();
        })();
      },
      onAdd: () => this.openModal(null),
    });

    renderSettingsListBody({
      containerEl: this.containerEl,
      items: this.agents,
      emptyText: this.agents.some(isEditable)
        ? null
        : 'No vault or global Cursor subagents yet. Click + to create one. Built-in and compat (.claude/.codex) agents below are read-only.',
      renderItem: (listEl, agent) => { this.renderItem(listEl, agent); },
    });
  }

  private renderItem(listEl: HTMLElement, agent: CursorAgentDefinition): void {
    const actions = isEditable(agent)
      ? [
          { icon: 'pencil', ariaLabel: 'Edit', onClick: () => this.openModal(agent) },
          {
            icon: 'trash-2',
            ariaLabel: 'Delete',
            danger: true,
            onClick: () => { void this.deleteAgent(agent); },
          },
        ]
      : [];

    const { headerRow } = renderSettingsListItem(listEl, {
      name: agent.name,
      description: agent.description,
      actions,
    });

    headerRow.createSpan({ text: sourceBadge(agent), cls: 'claudian-slash-item-badge' });
    if (agent.model) {
      headerRow.createSpan({ text: agent.model, cls: 'claudian-slash-item-badge' });
    }
    if (agent.isBackground) {
      headerRow.createSpan({ text: 'background', cls: 'claudian-slash-item-badge' });
    }
  }

  private async deleteAgent(agent: CursorAgentDefinition): Promise<void> {
    if (!this.app) return;
    await confirmDeleteListItem({
      app: this.app,
      message: `Delete subagent "${agent.name}"?`,
      doDelete: () => this.storage.delete(agent),
      afterDelete: async () => {
        await this.render();
        await this.onChanged?.();
      },
      successNotice: t('provider.cursor.subagent.deleted', { name: agent.name }),
      failureNotice: t('provider.cursor.subagent.deleteFailed'),
    });
  }

  private openModal(existing: CursorAgentDefinition | null): void {
    if (!this.app) return;
    new CursorAgentModal(this.app, existing, this.agents, async (agent) => {
      try {
        // The visible list de-duplicates same-name agents across sources, so a
        // source move/rename can land on a hidden twin; reject before it clobbers.
        if (await this.storage.wouldOverwriteDifferentAgent(agent, existing)) {
          new Notice(t('provider.cursor.subagent.duplicate', { name: agent.name }));
          return false;
        }
        await this.storage.save(agent, existing);
        await this.render();
        await this.onChanged?.();
        new Notice(t('provider.cursor.subagent.saved', { name: agent.name }));
        return true;
      } catch {
        new Notice(t('provider.cursor.subagent.saveFailed'));
        return false;
      }
    }).open();
  }
}

interface CursorAgentModalState {
  name: string;
  description: string;
  model: string;
  isBackground: boolean;
  saveToGlobal: boolean;
  prompt: string;
}

function initialModalState(existing: CursorAgentDefinition | null): CursorAgentModalState {
  if (!existing) {
    return { name: '', description: '', model: '', isBackground: false, saveToGlobal: false, prompt: '' };
  }
  return {
    name: existing.name,
    description: existing.description,
    model: existing.model ?? '',
    isBackground: existing.isBackground ?? false,
    saveToGlobal: existing.source === 'global',
    prompt: existing.prompt ?? '',
  };
}

/** Returns a user-facing error string, or null when the draft is valid. */
export function validateCursorAgentDraft(
  name: string,
  description: string,
  allAgents: CursorAgentDefinition[],
  existing: CursorAgentDefinition | null,
): string | null {
  const nameError = validateCursorAgentName(name);
  if (nameError) return nameError;
  // Only an editable same-name agent is a real conflict. Read-only compat
  // (.claude/.codex) and built-in agents are shadowed — not overwritten — by a
  // vault/global save, which is the storage layer's intended precedence.
  const conflict = allAgents.some(
    (agent) =>
      agent.name.toLowerCase() === name.toLowerCase()
      && agent.persistenceKey !== existing?.persistenceKey
      && isEditable(agent),
  );
  if (conflict) return t('provider.cursor.subagent.duplicate', { name });
  if (!description.trim()) return t('provider.cursor.subagent.descriptionRequired');
  return null;
}

export function buildCursorAgentDraft(
  state: CursorAgentModalState,
  existing: CursorAgentDefinition | null,
): CursorAgentDefinition {
  const source = state.saveToGlobal ? ('global' as const) : ('vault' as const);
  return {
    name: state.name.trim(),
    description: state.description.trim(),
    prompt: state.prompt,
    source,
    ...(state.model ? { model: state.model } : {}),
    ...(state.isBackground ? { isBackground: true } : {}),
    // The modal does not expose these, so carry them from the parsed definition
    // to keep an edit-and-save round-trip from stripping them.
    ...(existing?.readonly ? { readonly: true } : {}),
    ...(existing?.extraFrontmatter ? { extraFrontmatter: existing.extraFrontmatter } : {}),
    ...(existing?.persistenceKey && existing.source === source
      ? { persistenceKey: existing.persistenceKey }
      : {}),
  };
}

class CursorAgentModal extends Modal {
  private name: string;
  private description: string;
  private model: string;
  private isBackground: boolean;
  private saveToGlobal: boolean;
  private prompt: string;

  constructor(
    app: App,
    private readonly existing: CursorAgentDefinition | null,
    private readonly allAgents: CursorAgentDefinition[],
    private readonly onSubmit: (agent: CursorAgentDefinition) => Promise<boolean>,
  ) {
    super(app);
    const state = initialModalState(existing);
    this.name = state.name;
    this.description = state.description;
    this.model = state.model;
    this.isBackground = state.isBackground;
    this.saveToGlobal = state.saveToGlobal;
    this.prompt = state.prompt;
  }

  onOpen(): void {
    this.titleEl.setText(this.existing ? 'Edit Cursor subagent' : 'New Cursor subagent');
    this.modalEl.addClass('claudian-sp-modal');
    const { contentEl } = this;

    new Setting(contentEl)
      .setName('Name')
      .setDesc('Used as the file name under the agents folder and as the @mention ID.')
      .addText((text) => text
        .setValue(this.name)
        .onChange((value) => { this.name = value; }));

    new Setting(contentEl)
      .setName('Description')
      .setDesc('Tells Cursor when to delegate to this subagent.')
      .addText((text) => text
        .setValue(this.description)
        .onChange((value) => { this.description = value; }));

    new Setting(contentEl)
      .setName('Model')
      .setDesc('Optional Cursor model ID (for example composer-2). Empty inherits the chat model.')
      .addText((text) => text
        .setValue(this.model)
        .onChange((value) => { this.model = value.trim(); }));

    new Setting(contentEl)
      .setName('Background agent')
      .setDesc('Sets is_background: true so Cursor runs it without blocking the turn.')
      .addToggle((toggle) => toggle
        .setValue(this.isBackground)
        .onChange((value) => { this.isBackground = value; }));

    new Setting(contentEl)
      .setName('Save globally')
      .setDesc('Store under ~/.cursor/agents/ instead of the vault.')
      .addToggle((toggle) => toggle
        .setValue(this.saveToGlobal)
        .onChange((value) => { this.saveToGlobal = value; }));

    new Setting(contentEl)
      .setName('Prompt')
      .setDesc('System prompt body of the agent definition.');
    const promptEl = contentEl.createEl('textarea', { cls: 'claudian-sp-content-area' });
    promptEl.rows = 8;
    promptEl.value = this.prompt;
    promptEl.addEventListener('input', () => { this.prompt = promptEl.value; });

    renderModalButtonRow(contentEl, {
      cls: 'claudian-sp-modal-buttons',
      saveText: this.existing ? 'Save' : 'Create',
      onCancel: () => this.close(),
      onSave: () => {
        void (async (): Promise<void> => {
          const state: CursorAgentModalState = {
            name: this.name,
            description: this.description,
            model: this.model,
            isBackground: this.isBackground,
            saveToGlobal: this.saveToGlobal,
            prompt: this.prompt,
          };
          const validationError = validateCursorAgentDraft(
            state.name.trim(),
            state.description,
            this.allAgents,
            this.existing,
          );
          if (validationError) {
            new Notice(validationError);
            return;
          }
          const ok = await this.onSubmit(buildCursorAgentDraft(state, this.existing));
          if (ok) this.close();
        })();
      },
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
