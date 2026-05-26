import * as fs from 'fs';
import { Notice, Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath, getVaultPath } from '../../../utils/path';
import { formatCursorModelLabel } from '../modelLabels';
import { buildCursorAgentEnvironment } from '../runtime/cursorAgentEnv';
import { getCachedCursorModelIds, refreshCursorModelCatalog } from '../runtime/cursorModelCatalog';
import {
  getCursorEnabledModels,
  getCursorProviderSettings,
  setCursorEnabledModels,
  updateCursorProviderSettings,
} from '../settings';
import { matchesCursorModelQuery } from './cursorModelFilter';

export const cursorSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const cursorSettings = getCursorProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Enable Cursor Agent provider')
      .setDesc(
        'When enabled, Cursor Agent appears as a provider. Requires the Cursor CLI (`agent`) and authentication (for example CURSOR_API_KEY). Headless mode uses --trust; review permission mode and sandbox settings carefully.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(cursorSettings.enabled)
          .onChange(async (value) => {
            updateCursorProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const cliPathSetting = new Setting(container)
      .setName(`Cursor Agent CLI path (${hostnameKey})`)
      .setDesc('Path to the `agent` binary, or leave empty to search PATH.');

    const validationEl = container.createDiv({ cls: 'claudian-cli-path-validation' });
    validationEl.style.color = 'var(--text-error)';
    validationEl.style.fontSize = '0.85em';
    validationEl.style.marginTop = '-0.5em';
    validationEl.style.marginBottom = '0.5em';
    validationEl.style.display = 'none';

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;

      const expandedPath = expandHomePath(trimmed);

      if (!fs.existsSync(expandedPath)) {
        return t('settings.cliPath.validation.notExist' as TranslationKey);
      }
      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return t('settings.cliPath.validation.isDirectory' as TranslationKey);
      }
      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.style.display = 'block';
        if (inputEl) {
          inputEl.style.borderColor = 'var(--text-error)';
        }
        return false;
      }

      validationEl.style.display = 'none';
      if (inputEl) {
        inputEl.style.borderColor = '';
      }
      return true;
    };

    const cliPathsByHost = { ...cursorSettings.cliPathsByHost };

    const persistCliPath = async (value: string, inputEl?: HTMLInputElement): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, inputEl);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateCursorProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      const view = context.plugin.getView();
      await view?.getTabManager()?.broadcastToAllTabs(
        (service) => Promise.resolve(service.cleanup()),
      );
      return true;
    };

    const currentValue = cursorSettings.cliPathsByHost[hostnameKey] || '';

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder('agent')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value, text.inputEl);
        });
      text.inputEl.addClass('claudian-settings-cli-path-input');
      text.inputEl.style.width = '100%';

      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container).setName('Models').setHeading();

    new Setting(container)
      .setName('Visible models')
      .setDesc('Choose which Cursor models appear in the picker. `auto` is always available.');

    let searchQuery = '';

    const pickerEl = container.createDiv({ cls: 'claudian-cursor-model-picker' });
    const controlsEl = pickerEl.createDiv({ cls: 'claudian-cursor-model-picker-controls' });

    const searchInput = controlsEl.createEl('input', {
      cls: 'claudian-cursor-model-picker-search',
      type: 'search',
    });
    searchInput.placeholder = 'Filter models…';

    const selectAllBtn = controlsEl.createEl('button', {
      cls: 'claudian-cursor-model-picker-action',
      text: 'Select all',
    });
    const selectNoneBtn = controlsEl.createEl('button', {
      cls: 'claudian-cursor-model-picker-action',
      text: 'Select none',
    });
    const countEl = controlsEl.createSpan({ cls: 'claudian-cursor-model-picker-count' });

    const listEl = pickerEl.createDiv({ cls: 'claudian-cursor-model-picker-list' });

    // Union of discovered ids and currently-enabled ids (so a stale enabled id
    // can still be unchecked). `auto` is implicit and never listed here.
    const getAllModelIds = (): string[] => {
      const discovered = getCachedCursorModelIds().filter((id) => id !== 'auto');
      const enabled = getCursorEnabledModels(settingsBag).filter((id) => id !== 'auto');
      const seen = new Set<string>();
      const result: string[] = [];
      for (const id of [...discovered, ...enabled]) {
        if (!seen.has(id)) {
          seen.add(id);
          result.push(id);
        }
      }
      return result;
    };

    const getVisibleModelIds = (): string[] =>
      getAllModelIds().filter((id) => matchesCursorModelQuery(id, searchQuery));

    const persistEnabledModels = async (ids: string[]): Promise<void> => {
      setCursorEnabledModels(settingsBag, ids);
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
    };

    const renderCount = (): void => {
      const total = getAllModelIds().length;
      const selected = getCursorEnabledModels(settingsBag).filter((id) => id !== 'auto').length;
      countEl.setText(`${selected} of ${total} selected`);
    };

    const renderList = (): void => {
      listEl.empty();
      const enabled = new Set(getCursorEnabledModels(settingsBag));
      const visible = getVisibleModelIds();

      if (visible.length === 0) {
        const emptyEl = listEl.createDiv({ cls: 'claudian-cursor-model-picker-empty' });
        const allIds = getAllModelIds();
        if (allIds.length === 0) {
          emptyEl.setText('No models discovered yet. Set the Cursor CLI path above, then refresh the model list.');
        } else {
          emptyEl.setText('No models match your filter.');
        }
        return;
      }

      for (const id of visible) {
        const rowEl = listEl.createEl('label', { cls: 'claudian-cursor-model-picker-row' });
        rowEl.title = id;

        const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
        checkboxEl.checked = enabled.has(id);
        checkboxEl.addEventListener('change', () => {
          const current = getCursorEnabledModels(settingsBag).filter((entry) => entry !== 'auto');
          const next = checkboxEl.checked
            ? [...current, id]
            : current.filter((entry) => entry !== id);
          void (async () => {
            await persistEnabledModels(next);
            renderCount();
          })();
        });

        const textEl = rowEl.createDiv({ cls: 'claudian-cursor-model-picker-row-text' });
        textEl.createDiv({
          cls: 'claudian-cursor-model-picker-row-name',
          text: formatCursorModelLabel(id),
        });
        textEl.createDiv({
          cls: 'claudian-cursor-model-picker-row-id',
          text: id,
        });
      }
    };

    const renderAll = (): void => {
      renderCount();
      renderList();
    };

    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      renderList();
    });

    selectAllBtn.addEventListener('click', () => {
      // Operate on the currently-visible (filtered) set, unioned with existing.
      const current = getCursorEnabledModels(settingsBag).filter((id) => id !== 'auto');
      const next = [...current];
      const seen = new Set(next);
      for (const id of getVisibleModelIds()) {
        if (!seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }
      void (async () => {
        await persistEnabledModels(next);
        renderAll();
      })();
    });

    selectNoneBtn.addEventListener('click', () => {
      void (async () => {
        await persistEnabledModels([]);
        renderAll();
      })();
    });

    const discoverModels = async (announce: boolean): Promise<void> => {
      const cliPath = context.plugin.getResolvedProviderCliPath('cursor');
      if (!cliPath) {
        if (announce) {
          new Notice('Cursor CLI not found. Configure the CLI path first.');
        }
        return;
      }
      const env = buildCursorAgentEnvironment(context.plugin);
      const cwd = getVaultPath(context.plugin.app) ?? process.cwd();
      try {
        const ids = await refreshCursorModelCatalog(cliPath, env, cwd);
        if (announce) {
          new Notice(`Discovered ${ids.length} Cursor model${ids.length === 1 ? '' : 's'}.`);
        }
        renderAll();
      } catch {
        if (announce) {
          new Notice('Failed to refresh Cursor models.');
        }
      }
    };

    new Setting(container)
      .setName('Refresh models')
      .setDesc('Discover the models exposed by the Cursor CLI (`agent --list-models`).')
      .addButton((button) =>
        button
          .setButtonText('Refresh models')
          .onClick(async () => {
            button.setDisabled(true);
            await discoverModels(true);
            button.setDisabled(false);
          })
      );

    renderAll();

    // Best-effort warm discovery so the list is populated by the time it opens.
    void discoverModels(false);

    new Setting(container).setName(t('settings.safety')).setHeading();

    const safety = container.createDiv({ cls: 'setting-item-description' });
    safety.createEl('p', {
      text: 'Claudian maps toolbar permission mode to Cursor CLI flags: YOLO uses --force and sandbox disabled; Plan uses plan mode with sandbox enabled; Normal uses sandbox enabled without --force. All runs use --trust so the agent can complete non-interactively.',
    });

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:cursor',
      heading: t('settings.environment'),
      name: 'Cursor Agent environment',
      desc: 'Variables such as CURSOR_API_KEY. Chats are stored under ~/.cursor/chats/<workspace-hash>/<session-id>/.',
      placeholder: 'CURSOR_API_KEY=your-key',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'cursor'),
    });
  },
};
