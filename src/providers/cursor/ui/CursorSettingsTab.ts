import * as fs from 'fs';
import { Notice, Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath, getVaultPath } from '../../../utils/path';
import { buildCursorAgentEnvironment } from '../runtime/cursorAgentEnv';
import { getCachedCursorModelIds, refreshCursorModelCatalog } from '../runtime/cursorModelCatalog';
import { buildCursorFamilies, getCursorModelVariants } from '../runtime/cursorModelFamily';
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
      .setName('Enable Cursor agent provider')
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

    const validationEl = container.createDiv({ cls: 'claudian-cli-path-validation claudian-hidden' });

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
        validationEl.removeClass('claudian-hidden');
        if (inputEl) {
          inputEl.addClass('claudian-input-error');
        }
        return false;
      }

      validationEl.addClass('claudian-hidden');
      if (inputEl) {
        inputEl.removeClass('claudian-input-error');
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
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- 'agent' is the literal Cursor CLI binary name, not prose.
        .setPlaceholder('agent')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value, text.inputEl);
        });
      text.inputEl.addClass('claudian-settings-cli-path-input');

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

    // All discovered + currently-enabled raw ids (auto excluded). Source for the
    // family grouping shown in the list.
    const getAllRawIds = (): string[] => {
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

    const getAllFamilies = () =>
      buildCursorFamilies(getAllRawIds()).filter((family) =>
        matchesCursorModelQuery(family.familyId, searchQuery)
        || matchesCursorModelQuery(family.label, searchQuery));

    const enabledSet = (): Set<string> => new Set(getCursorEnabledModels(settingsBag));

    // The raw ids that make up a family (bare id + its variant ids), restricted
    // to what is actually discovered/enabled.
    const familyMemberRawIds = (familyId: string): string[] => {
      const all = getAllRawIds();
      const variantValues = getCursorModelVariants(familyId, all).map((v) => v.value);
      return all.filter((id) =>
        id === familyId
        || variantValues.some((mode) => mode !== 'standard' && id === `${familyId}-${mode}`));
    };

    // A family is enabled when any of its member raw ids is enabled.
    const isFamilyEnabled = (familyId: string): boolean => {
      const enabled = enabledSet();
      return familyMemberRawIds(familyId).some((id) => enabled.has(id));
    };

    const persistEnabledModels = async (ids: string[]): Promise<void> => {
      setCursorEnabledModels(settingsBag, ids);
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
    };

    const renderCount = (): void => {
      const families = buildCursorFamilies(getAllRawIds());
      const selected = families.filter((family) => isFamilyEnabled(family.familyId)).length;
      countEl.setText(`${selected} of ${families.length} families selected`);
    };

    const renderList = (): void => {
      listEl.empty();
      const families = getAllFamilies();

      if (families.length === 0) {
        const emptyEl = listEl.createDiv({ cls: 'claudian-cursor-model-picker-empty' });
        if (buildCursorFamilies(getAllRawIds()).length === 0) {
          emptyEl.setText('No models discovered yet. Set the Cursor CLI path above, then refresh the model list.');
        } else {
          emptyEl.setText('No models match your filter.');
        }
        return;
      }

      for (const family of families) {
        const rowEl = listEl.createEl('label', { cls: 'claudian-cursor-model-picker-row' });
        rowEl.title = family.familyId;

        const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
        checkboxEl.checked = isFamilyEnabled(family.familyId);
        checkboxEl.addEventListener('change', () => {
          const current = getCursorEnabledModels(settingsBag).filter((entry) => entry !== 'auto');
          const members = new Set(familyMemberRawIds(family.familyId));
          const next = checkboxEl.checked
            ? [...new Set([...current, ...members])]
            : current.filter((entry) => !members.has(entry));
          void (async () => {
            await persistEnabledModels(next);
            renderCount();
          })();
        });

        const textEl = rowEl.createDiv({ cls: 'claudian-cursor-model-picker-row-text' });
        textEl.createDiv({
          cls: 'claudian-cursor-model-picker-row-name',
          text: family.label,
        });
        const modeHint = family.variants.length > 1
          ? `${family.vendor} · ${family.variants.length} modes`
          : family.vendor;
        textEl.createDiv({
          cls: 'claudian-cursor-model-picker-row-id',
          text: modeHint,
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
      const current = getCursorEnabledModels(settingsBag).filter((id) => id !== 'auto');
      const next = new Set(current);
      for (const family of getAllFamilies()) {
        for (const id of familyMemberRawIds(family.familyId)) {
          next.add(id);
        }
      }
      void (async () => {
        await persistEnabledModels([...next]);
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
          if (ids.length === 0) {
            new Notice('Cursor returned no models. If you are not signed in, run `cursor-agent login`.', 6000);
          } else {
            new Notice(`Discovered ${ids.length} Cursor model${ids.length === 1 ? '' : 's'}.`);
          }
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
