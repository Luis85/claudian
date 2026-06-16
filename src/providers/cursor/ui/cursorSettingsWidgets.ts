import { Setting } from 'obsidian';

import type {
  ProviderSettingsWidgetContext,
  ProviderSettingsWidgetMount,
} from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types';
import {
  addCliPathTextControl,
  broadcastCliPathRuntimeCleanup,
  validateCliPathAsFile,
  withHostCliPath,
} from '../../../shared/settings/cliPathSetting';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { getHostnameKey } from '../../../utils/env';
import { maybeGetCursorWorkspaceServices } from '../app/cursorWorkspaceAccess';
import { getCursorProviderSettings, updateCursorProviderSettings } from '../settings';
import { CursorAgentSettings } from './CursorAgentSettings';
import { mountCursorVisibleModelsPicker } from './visibleModelsPicker';

/**
 * Cursor settings widgets, extracted from `CursorSettingsTab` so the legacy
 * provider tab renderer and the settings-registry custom fields mount the
 * SAME implementation (settings-registry port, Decision 2). Section headings
 * stay with the caller: the legacy tab renders its own `setHeading()` rows,
 * the registry renders section headers from registered sections.
 */

export const mountCursorCliPathSetting: ProviderSettingsWidgetMount = (host, context) => {
  const settingsBag = asSettingsBag(context.plugin.settings);
  const hostnameKey = getHostnameKey();
  let cliPathsByHost = { ...getCursorProviderSettings(settingsBag).cliPathsByHost };

  const setting = new Setting(host)
    .setName(`Cursor Agent CLI path (${hostnameKey})`)
    .setDesc('Path to the `agent` binary, or leave empty to search PATH.');

  addCliPathTextControl({
    setting,
    validationHost: host,
    // 'agent' is the literal Cursor CLI binary name, not prose.
    placeholder: 'agent',
    currentValue: cliPathsByHost[hostnameKey] || '',
    validate: validateCliPathAsFile,
    persist: async (trimmed) => {
      cliPathsByHost = withHostCliPath(cliPathsByHost, hostnameKey, trimmed);
      updateCursorProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      await broadcastCliPathRuntimeCleanup(context.plugin);
    },
  });
};

export const mountCursorSubagentsSection: ProviderSettingsWidgetMount = (host, context) => {
  const cursorWorkspace = maybeGetCursorWorkspaceServices();
  if (!cursorWorkspace?.agentStorage) {
    return;
  }

  const subagentsDesc = host.createDiv({ cls: 'claudian-sp-settings-desc' });
  subagentsDesc.createEl('p', {
    cls: 'setting-item-description',
    text: 'Manage Cursor subagents in .cursor/agents/ (vault) and ~/.cursor/agents/ (global). Claude vault agents from .claude/agents/ and the built-in Explore, Bash, and Browser agents are listed read-only. Entries appear in the @mention menu.',
  });

  const subagentsContainer = host.createDiv({ cls: 'claudian-slash-commands-container' });
  new CursorAgentSettings(
    subagentsContainer,
    cursorWorkspace.agentStorage,
    context.plugin.app,
    async () => {
      await cursorWorkspace.refreshAgentMentions?.();
    },
  );
};

export function mountCursorEnvironmentSection(
  host: HTMLElement,
  context: ProviderSettingsWidgetContext,
  heading?: string,
): void {
  renderEnvironmentSettingsSection({
    container: host,
    plugin: context.plugin,
    scope: 'provider:cursor',
    heading,
    name: 'Cursor Agent environment',
    desc: 'Variables such as CURSOR_API_KEY. Chats are stored under ~/.cursor/chats/<workspace-hash>/<session-id>/.',
    placeholder: 'CURSOR_API_KEY=your-key',
    renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'cursor'),
  });
}

/** Registry-mountable widget table exposed via `cursorSettingsTabRenderer.widgets`. */
export const cursorSettingsWidgets: Readonly<Record<string, ProviderSettingsWidgetMount>> = {
  cliPathsByHost: mountCursorCliPathSetting,
  visibleModels: mountCursorVisibleModelsPicker,
  subagents: mountCursorSubagentsSection,
  environment: (host, context) => mountCursorEnvironmentSection(host, context),
};
