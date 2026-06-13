import type { App } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import {
  getEnvironmentScopeUpdates,
  resolveEnvironmentSnippetScope,
} from '../../core/providers/providerEnvironment';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { reconcileSnippetEdit, resolveSnippetEnvText } from '../../core/providers/secretEnvVars';
import { SECRET_VALUE_PLACEHOLDER } from '../../core/security/secretIds';
import type { EnvironmentScope, EnvSnippet } from '../../core/types';
import { VIEW_TYPE_CLAUDIAN } from '../../core/types';
import type { ChatViewHandle, PluginContext } from '../../core/types/PluginContext';
import { t } from '../../i18n/i18n';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import { createSettingsActionButton } from '../components/settingsListUI';
import { confirmDelete } from '../modals/ConfirmModal';
import { mergeSnippetContextLimits, mergeSnippetModelAliases } from './envSnippetApply';

/**
 * Structural predicate for loaded chat-view leaves, duck-typed against the
 * method this module actually calls. Mirrors `isClaudianView` in
 * `features/chat` without importing it — `shared/` must stay free of
 * `features/` dependencies, and core's `ChatViewHandle` already models the
 * surface we need.
 */
function isChatViewHandle(value: unknown): value is ChatViewHandle {
  return !!value
    && typeof value === 'object'
    && typeof (value as { refreshModelSelector?: unknown }).refreshModelSelector === 'function';
}

export class EnvSnippetModal extends Modal {
  plugin: PluginContext;
  snippet: EnvSnippet | null;
  snippetScope: EnvironmentScope;
  onSave: (snippet: EnvSnippet) => void;

  constructor(
    app: App,
    plugin: PluginContext,
    snippet: EnvSnippet | null,
    scope: EnvironmentScope,
    onSave: (snippet: EnvSnippet) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.snippet = snippet;
    this.snippetScope = scope;
    this.onSave = onSave;
  }

  /**
   * SEC-A: render the snippet's stored (sanitized) env text plus a masked
   * placeholder row per migrated secret, so the user can see and remove a secret
   * without its value ever being shown. Reconciled on save (see reconcileSnippetEdit).
   */
  private buildEditableSnippetEnv(snippet: EnvSnippet): string {
    const refs = (this.plugin.settings.secretEnvVars ?? []).filter(
      (ref) => ref.scope === `snippet:${snippet.id}`,
    );
    const base = snippet.envVars.replace(/\s+$/, '');
    const sentinels = refs.map((ref) => `${ref.name}=${SECRET_VALUE_PLACEHOLDER}`);
    return [base, ...sentinels].filter((line) => line.length > 0).join('\n');
  }

  onOpen() {
    const { contentEl } = this;
    this.setTitle(this.snippet ? t('settings.envSnippets.modal.titleEdit') : t('settings.envSnippets.modal.titleSave'));

    this.modalEl.addClass('claudian-env-snippet-modal');

    let nameEl: HTMLInputElement;
    let descEl: HTMLInputElement;
    let envVarsEl: HTMLTextAreaElement;
    const contextLimitInputs: Map<string, HTMLInputElement> = new Map();
    const modelAliasInputs: Map<string, HTMLInputElement> = new Map();
    let contextLimitsContainer: HTMLElement | null = null;

    // !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        saveSnippet();
      } else if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        this.close();
      }
    };

    const saveSnippet = () => {
      const name = nameEl.value.trim();
      if (!name) {
        new Notice(t('settings.envSnippets.nameRequired'));
        return;
      }

      const contextLimits: Record<string, number> = {};
      for (const [modelId, input] of contextLimitInputs) {
        const value = input.value.trim();
        if (value) {
          const parsed = parseContextLimit(value);
          if (parsed !== null) {
            contextLimits[modelId] = parsed;
          }
        }
      }

      const modelAliases: Record<string, string> = {};
      for (const [modelId, input] of modelAliasInputs) {
        const value = input.value.trim();
        if (value) {
          modelAliases[modelId] = value;
        }
      }

      const snippet: EnvSnippet = {
        id: this.snippet?.id || `snippet-${Date.now()}`,
        name,
        description: descEl.value.trim(),
        envVars: envVarsEl.value,
        scope: resolveEnvironmentSnippetScope(
          envVarsEl.value,
          this.snippet?.scope ?? this.snippetScope,
        ),
        contextLimits: Object.keys(contextLimits).length > 0 ? contextLimits : undefined,
        modelAliases: modelAliasInputs.size > 0 ? modelAliases : undefined,
      };

      this.onSave(snippet);
      this.close();
    };

    const renderContextLimitFields = () => {
      if (!contextLimitsContainer) return;
      contextLimitsContainer.empty();
      contextLimitInputs.clear();
      modelAliasInputs.clear();

      const envVars = parseEnvironmentVariables(envVarsEl.value);
      const uniqueModelIds = ProviderRegistry.getCustomModelIds(envVars);

      if (uniqueModelIds.size === 0) {
        contextLimitsContainer.addClass('claudian-hidden');
        return;
      }

      contextLimitsContainer.removeClass('claudian-hidden');

      const existingLimits = this.snippet?.contextLimits ?? this.plugin.settings.customContextLimits ?? {};
      const existingAliases = this.snippet?.modelAliases ?? this.plugin.settings.customModelAliases ?? {};

      contextLimitsContainer.createEl('div', {
        text: t('settings.customModelOverrides.name'),
        cls: 'setting-item-name',
      });
      contextLimitsContainer.createEl('div', {
        text: t('settings.customModelOverrides.desc'),
        cls: 'setting-item-description',
      });

      for (const modelId of uniqueModelIds) {
        const row = contextLimitsContainer.createDiv({ cls: 'claudian-snippet-limit-row' });
        row.createSpan({ text: modelId, cls: 'claudian-snippet-limit-model' });
        row.createSpan({ cls: 'claudian-snippet-limit-spacer' });

        const aliasInput = row.createEl('input', {
          type: 'text',
          placeholder: t('settings.customModelAliases.placeholder'),
          cls: 'claudian-snippet-alias-input',
        });
        aliasInput.value = existingAliases[modelId] ?? '';
        aliasInput.setAttribute('aria-label', `Alias for ${modelId}`);
        aliasInput.title = 'Custom label shown in the model selector. Leave empty to use the default.';
        modelAliasInputs.set(modelId, aliasInput);

        const input = row.createEl('input', {
          type: 'text',
          placeholder: '200k',
          cls: 'claudian-snippet-limit-input',
        });
        input.value = existingLimits[modelId] ? formatContextLimit(existingLimits[modelId]) : '';
        input.setAttribute('aria-label', `Context window for ${modelId}`);
        contextLimitInputs.set(modelId, input);
      }
    };

    new Setting(contentEl)
      .setName(t('settings.envSnippets.modal.name'))
      .setDesc(t('settings.envSnippets.modal.namePlaceholder'))
      .addText((text) => {
        nameEl = text.inputEl;
        text.setValue(this.snippet?.name || '');
                text.inputEl.addEventListener('keydown', handleKeyDown);
      });

    new Setting(contentEl)
      .setName(t('settings.envSnippets.modal.description'))
      .setDesc(t('settings.envSnippets.modal.descPlaceholder'))
      .addText((text) => {
        descEl = text.inputEl;
        text.setValue(this.snippet?.description || '');
                text.inputEl.addEventListener('keydown', handleKeyDown);
      });

    const envVarsSetting = new Setting(contentEl)
      .setName(t('settings.envSnippets.modal.envVars'))
      .setDesc(t('settings.envSnippets.modal.envVarsPlaceholder'))
      .addTextArea((text) => {
        envVarsEl = text.inputEl;
        const envVarsToShow = this.snippet
          ? this.buildEditableSnippetEnv(this.snippet)
          : this.plugin.getEnvironmentVariablesForScope(this.snippetScope);
        text.setValue(envVarsToShow);
        text.inputEl.rows = 8;
        text.inputEl.addEventListener('blur', () => renderContextLimitFields());
      });
    envVarsSetting.settingEl.addClass('claudian-env-snippet-setting');
    envVarsSetting.controlEl.addClass('claudian-env-snippet-control');

    contextLimitsContainer = contentEl.createDiv({ cls: 'claudian-snippet-context-limits' });
    renderContextLimitFields();

    const buttonContainer = contentEl.createDiv({ cls: 'claudian-snippet-buttons' });

    const cancelBtn = buttonContainer.createEl('button', {
      text: t('settings.envSnippets.modal.cancel'),
      cls: 'claudian-cancel-btn'
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: this.snippet ? t('settings.envSnippets.modal.update') : t('settings.envSnippets.modal.save'),
      cls: 'claudian-save-btn'
    });
    saveBtn.addEventListener('click', () => saveSnippet());

    // Focus name input after modal is rendered (timeout for Windows compatibility)
    window.setTimeout(() => nameEl?.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class EnvSnippetManager {
  private containerEl: HTMLElement;
  private plugin: PluginContext;
  private scope: EnvironmentScope;
  private onContextLimitsChange?: () => void;

  constructor(
    containerEl: HTMLElement,
    plugin: PluginContext,
    scope: EnvironmentScope,
    onContextLimitsChange?: () => void,
  ) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.scope = scope;
    this.onContextLimitsChange = onContextLimitsChange;
    this.render();
  }

  private render() {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-snippet-header' });
    headerEl.createSpan({ text: t('settings.envSnippets.name'), cls: 'claudian-snippet-label' });

    const saveBtn = headerEl.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': t('settings.envSnippets.addBtn') },
    });
    setIcon(saveBtn, 'plus');
    saveBtn.addEventListener('click', () => {
      void this.saveCurrentEnv();
    });

    const snippets = this.plugin.settings.envSnippets.filter((snippet) => this.shouldDisplaySnippet(snippet));

    if (snippets.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-snippet-empty' });
      emptyEl.setText(t('settings.envSnippets.noSnippets'));
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'claudian-snippet-list' });

    for (const snippet of snippets) {
      const itemEl = listEl.createDiv({ cls: 'claudian-snippet-item' });

      const infoEl = itemEl.createDiv({ cls: 'claudian-snippet-info' });

      const nameEl = infoEl.createDiv({ cls: 'claudian-snippet-name' });
      nameEl.setText(snippet.name);

      if (snippet.description) {
        const descEl = infoEl.createDiv({ cls: 'claudian-snippet-description' });
        descEl.setText(snippet.description);
      }

      const actionsEl = itemEl.createDiv({ cls: 'claudian-snippet-actions' });

      createSettingsActionButton(actionsEl, {
        icon: 'clipboard-paste',
        ariaLabel: 'Insert',
        onClick: () => {
          void (async (): Promise<void> => {
          try {
            await this.insertSnippet(snippet);
          } catch {
            new Notice(t('settings.envSnippets.insertFailed'));
          }
          })();
        },
      });

      createSettingsActionButton(actionsEl, {
        icon: 'pencil',
        ariaLabel: 'Edit',
        onClick: () => {
          this.editSnippet(snippet);
        },
      });

      createSettingsActionButton(actionsEl, {
        icon: 'trash-2',
        ariaLabel: 'Delete',
        danger: true,
        onClick: () => {
          void (async (): Promise<void> => {
          try {
            if (await confirmDelete(this.plugin.app, `Delete environment snippet "${snippet.name}"?`)) {
              await this.deleteSnippet(snippet);
            }
          } catch {
            new Notice(t('settings.envSnippets.deleteFailed'));
          }
          })();
        },
      });
    }
  }

  private async saveCurrentEnv() {
    const modal = new EnvSnippetModal(
      this.plugin.app,
      this.plugin,
      null,
      this.scope,
      (snippet) => {
        void (async (): Promise<void> => {
          this.plugin.settings.envSnippets.push(snippet);
          // SEC-A: move secret-shaped lines into SecretStorage (under this
          // snippet's scope) so they never persist in plaintext.
          this.reconcileSnippetSecrets(snippet);
          await this.plugin.saveSettings();
          this.render();
          new Notice(t('settings.envSnippets.saved', { name: snippet.name }));
        })();
      }
    );
    modal.open();
  }

  private async insertSnippet(snippet: EnvSnippet) {
    // SEC-A: re-inject this snippet's migrated secret values (held inert under
    // `snippet:<id>` refs) so insertion activates them in the target scope. A
    // secret missing on this device is reported and skipped (re-entry prompt).
    const snippetRefs = (this.plugin.settings.secretEnvVars ?? []).filter(
      (ref) => ref.scope === `snippet:${snippet.id}`,
    );
    const { envText, missing } = resolveSnippetEnvText(
      snippet.envVars,
      snippetRefs,
      (id) => this.plugin.secretStore.get(id),
    );
    if (missing.length > 0) {
      new Notice(t('env.secretMissing', { name: missing.map((ref) => ref.name).join(', ') }));
    }

    const snippetContent = envText.trim();
    // SEC-A: when the snippet resolves to empty — e.g. it consists only of migrated
    // secret refs that are absent on this device — do NOT apply. getEnvironmentScopeUpdates
    // would return a fallback-scope update with empty text, and applying it would WIPE
    // the target scope's env instead of doing nothing. The missing-secret warning above
    // prompts re-entry; env limits/aliases below still apply.
    if (snippetContent) {
      await this.applySnippetEnvUpdates(snippetContent, snippet.scope ?? this.scope);
    }

    // Legacy snippets without contextLimits don't modify limits
    if (snippet.contextLimits) {
      this.plugin.settings.customContextLimits = mergeSnippetContextLimits(
        this.plugin.settings.customContextLimits,
        snippet.contextLimits,
      );
    }

    // Legacy snippets without modelAliases don't modify aliases. Snippets saved
    // with alias fields clear aliases for their own model IDs when left empty.
    if (snippet.modelAliases) {
      const modelIds = ProviderRegistry.getCustomModelIds(parseEnvironmentVariables(snippet.envVars));
      this.plugin.settings.customModelAliases = mergeSnippetModelAliases(
        this.plugin.settings.customModelAliases,
        modelIds,
        snippet.modelAliases,
      );
    }
    await this.plugin.saveSettings();

    this.onContextLimitsChange?.();
    await this.refreshChatModelSelector();
  }

  // Applies a snippet's resolved env text to its owning scope(s).
  private async applySnippetEnvUpdates(
    snippetContent: string,
    fallbackScope: EnvironmentScope,
  ): Promise<void> {
    const updates = getEnvironmentScopeUpdates(snippetContent, fallbackScope);
    if (updates.length === 1) {
      const [update] = updates;
      this.syncTextareaValue(update.scope, update.envText);
      await this.plugin.applyEnvironmentVariables(update.scope, update.envText);
    } else if (updates.length > 1) {
      for (const update of updates) {
        this.syncTextareaValue(update.scope, update.envText);
      }
      await this.plugin.applyEnvironmentVariablesBatch(updates);
    }
  }

  private async refreshChatModelSelector(): Promise<void> {
    // Use the safe predicate + loadIfDeferred() instead of an unchecked cast:
    // workspace.getLeavesOfType can hand back deferred leaves whose .view is a
    // stub until activation, and the cast would silently no-op (or worse,
    // crash on method call) in that window.
    const leaf = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)[0];
    if (leaf) {
      await leaf.loadIfDeferred();
      if (isChatViewHandle(leaf.view)) {
        leaf.view.refreshModelSelector();
      }
    }
  }

  private editSnippet(snippet: EnvSnippet) {
    const modal = new EnvSnippetModal(
      this.plugin.app,
      this.plugin,
      snippet,
      this.scope,
      (updatedSnippet) => {
        void (async (): Promise<void> => {
          const index = this.plugin.settings.envSnippets.findIndex(s => s.id === snippet.id);
          if (index !== -1) {
            this.plugin.settings.envSnippets[index] = updatedSnippet;
            // SEC-A: reconcile placeholders/removals, migrate new secrets, and
            // prune refs the user dropped from the editor.
            this.reconcileSnippetSecrets(updatedSnippet);
            await this.plugin.saveSettings();
            this.render();
            new Notice(t('settings.envSnippets.updated', { name: updatedSnippet.name }));
          }
        })();
      }
    );
    modal.open();
  }

  /**
   * SEC-A: reconcile a saved/edited snippet's secrets. The editor shows a masked
   * placeholder row per existing secret; here we strip those rows, prune refs the
   * user removed (so a deleted credential isn't re-injected on insert), clear the
   * orphaned values, then migrate any real secret values typed in.
   */
  private reconcileSnippetSecrets(snippet: EnvSnippet): void {
    const scope: EnvironmentScope = `snippet:${snippet.id}`;
    const snippetRefs = (this.plugin.settings.secretEnvVars ?? []).filter((ref) => ref.scope === scope);
    const { envVars, keptRefNames } = reconcileSnippetEdit(snippet.envVars, snippetRefs);
    snippet.envVars = envVars;

    const dropped = snippetRefs.filter((ref) => !keptRefNames.has(ref.name));
    if (dropped.length > 0) {
      const next = (this.plugin.settings.secretEnvVars ?? []).filter((ref) => !dropped.includes(ref));
      this.plugin.settings.secretEnvVars = next;
      const stillUsed = new Set(next.map((ref) => ref.secretId));
      for (const ref of dropped) {
        if (!stillUsed.has(ref.secretId)) this.plugin.secretStore.clear(ref.secretId);
      }
    }

    this.plugin.migrateEnvSecretsNow();
  }

  private async deleteSnippet(snippet: EnvSnippet) {
    this.plugin.settings.envSnippets = this.plugin.settings.envSnippets.filter(s => s.id !== snippet.id);
    // SEC-A: drop the deleted snippet's secret refs + clear unreferenced values.
    this.plugin.pruneSnippetSecrets(snippet.id);
    await this.plugin.saveSettings();
    this.render();
    new Notice(t('settings.envSnippets.deleted', { name: snippet.name }));
  }

  public refresh() {
    this.render();
  }

  private shouldDisplaySnippet(snippet: EnvSnippet): boolean {
    if (this.scope === 'shared') {
      return !snippet.scope || snippet.scope === 'shared';
    }

    return snippet.scope === this.scope;
  }

  private syncTextareaValue(scope: EnvironmentScope, value: string): void {
    const selector = `.claudian-settings-env-textarea[data-env-scope="${scope}"]`;
    const envTextarea = (this.containerEl.ownerDocument ?? window.document).querySelector<HTMLTextAreaElement>(selector);
    if (envTextarea) {
      envTextarea.value = value;
    }
  }
}
