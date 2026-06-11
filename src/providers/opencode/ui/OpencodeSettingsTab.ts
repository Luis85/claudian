import { Setting } from 'obsidian';

import { widgetContextFromTabRenderer } from '../../../core/providers/settingsWidgets';
import type {
  ProviderSettingsTabRenderer,
  ProviderSettingsTabRendererContext,
} from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import { maybeGetOpencodeWorkspaceServices } from '../app/opencodeWorkspaceAccess';
import { getOpencodeProviderSettings, updateOpencodeProviderSettings } from '../settings';
import { mountOpencodeModelAliasesEditor } from './modelAliasesEditor';
import {
  mountOpencodeCliPathSetting,
  mountOpencodeEnvironmentSection,
  mountOpencodeHiddenCommandsSection,
  mountOpencodeSubagentsSection,
  opencodeSettingsWidgets,
} from './opencodeSettingsWidgets';
import { mountOpencodeVisibleModelsPicker } from './visibleModelsPicker';

/**
 * Legacy imperative OpenCode settings tab. Every widget is shared with the
 * settings-registry custom fields through `opencodeSettingsWidgets`
 * (settings-registry port, Decision 2); this renderer only owns section
 * headings, the enable toggle, and ordering.
 */

function renderEnableToggle(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
): void {
  const settingsBag = asSettingsBag(context.plugin.settings);
  new Setting(container)
    .setName('Enable OpenCode')
    .setDesc('Launch `opencode acp` as a provider.')
    .addToggle((toggle) =>
      toggle
        .setValue(getOpencodeProviderSettings(settingsBag).enabled)
        .onChange(async (value) => {
          updateOpencodeProviderSettings(settingsBag, { enabled: value });
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        })
    );
}

export const opencodeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const widgetContext = widgetContextFromTabRenderer(context, () => {
      container.empty();
      opencodeSettingsTabRenderer.render(container, context);
    });

    new Setting(container).setName('Setup').setHeading();
    renderEnableToggle(container, context);
    mountOpencodeCliPathSetting(container, widgetContext);

    new Setting(container).setName('Models').setHeading();
    mountOpencodeVisibleModelsPicker(container, widgetContext);
    mountOpencodeModelAliasesEditor(container, widgetContext);

    new Setting(container).setName('Commands and skills').setHeading();
    mountOpencodeHiddenCommandsSection(container, widgetContext);

    if (maybeGetOpencodeWorkspaceServices()?.agentStorage) {
      new Setting(container).setName('Subagents').setHeading();
      mountOpencodeSubagentsSection(container, widgetContext);
    }

    mountOpencodeEnvironmentSection(container, widgetContext, 'Environment');
  },
  widgets: opencodeSettingsWidgets,
};
