import { Setting } from 'obsidian';

import { widgetContextFromTabRenderer } from '../../../core/providers/settingsWidgets';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { maybeGetCursorWorkspaceServices } from '../app/cursorWorkspaceAccess';
import {
  cursorSettingsWidgets,
  mountCursorCliPathSetting,
  mountCursorEnvironmentSection,
  mountCursorSubagentsSection,
} from './cursorSettingsWidgets';
import { mountCursorVisibleModelsPicker } from './visibleModelsPicker';

/**
 * Legacy imperative Cursor settings tab. Every widget is shared with the
 * settings-registry custom fields through `cursorSettingsWidgets`
 * (settings-registry port, Decision 2); this renderer only owns section
 * headings and ordering.
 */
export const cursorSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const widgetContext = widgetContextFromTabRenderer(context, () => {
      container.empty();
      cursorSettingsTabRenderer.render(container, context);
    });

    new Setting(container).setName('Models').setHeading();
    mountCursorVisibleModelsPicker(container, widgetContext);
    mountCursorCliPathSetting(container, widgetContext);

    if (maybeGetCursorWorkspaceServices()?.agentStorage) {
      new Setting(container).setName('Subagents').setHeading();
      mountCursorSubagentsSection(container, widgetContext);
    }

    mountCursorEnvironmentSection(container, widgetContext, t('settings.environment'));
  },
  widgets: cursorSettingsWidgets,
};
