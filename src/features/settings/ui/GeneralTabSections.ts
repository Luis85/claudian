import { Notice, Setting } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type SpecoratorPlugin from '../../../main';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { buildNavMappingText, parseNavMappings } from '../keyboardNavigation';
import { renderCustomContextLimits } from './CustomContextLimits';

/**
 * Per-field mounts for the General settings tab whose change handlers carry
 * side effects beyond a settings write (view refreshes, runtime restarts,
 * structured parsing). Extracted from `SpecoratorSettings.renderGeneralTab` so
 * the legacy renderer and the settings-registry field definitions mount the
 * SAME code — parity by shared implementation, not by reimplementation.
 */

async function restartServiceForPromptChange(plugin: SpecoratorPlugin): Promise<void> {
  const view = plugin.getView();
  const tabManager = view?.getTabManager();
  if (!tabManager) return;

  try {
    await tabManager.broadcastToAllTabs(
      async (service) => { await service.ensureReady({ force: true }); }
    );
  } catch {
    // Changes will apply on the next conversation if the restart fails.
  }
}

/**
 * Enable toggle for one provider. Routes through the provider's settings
 * reconciler (which owns config seeding on enable) and refreshes the open
 * chat views, exactly like the legacy Providers section.
 */
export function renderProviderEnableSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
  providerId: ProviderId,
  refresh: () => void,
): void {
  const reconciler = ProviderRegistry.getSettingsReconciler(providerId);
  if (!reconciler?.setEnabled) {
    return;
  }

  const settingsBag = asSettingsBag(plugin.settings);
  const displayName = ProviderRegistry.getProviderDisplayName(providerId);

  new Setting(container)
    .setName(`Enable ${displayName}`)
    .setDesc(`Show ${displayName} as a chat provider and reveal its settings tab.`)
    .addToggle((toggle) =>
      toggle
        .setValue(ProviderRegistry.isEnabled(providerId, settingsBag))
        .onChange(async (value) => {
          reconciler.setEnabled?.(settingsBag, value);
          await plugin.saveSettings();
          for (const view of plugin.getAllViews()) {
            view.refreshModelSelector();
            void view.refreshProviderAvailability();
          }
          refresh();
        })
    );
}

export function renderTabBarPositionSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t('settings.tabBarPosition.name'))
    .setDesc(t('settings.tabBarPosition.desc'))
    .addDropdown((dropdown) => {
      dropdown
        .addOption('input', t('settings.tabBarPosition.input'))
        .addOption('header', t('settings.tabBarPosition.header'))
        .setValue(plugin.settings.tabBarPosition ?? 'input')
        .onChange(async (value) => {
          plugin.settings.tabBarPosition = value as 'input' | 'header';
          await plugin.saveSettings();

          for (const view of plugin.getAllViews()) {
            view.updateLayoutForPosition();
          }
        });
    });
}

export function renderMaxChatTabsSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
): void {
  const maxChatTabsSetting = new Setting(container)
    .setName(t('settings.maxChatTabs.name'))
    .setDesc(t('settings.maxChatTabs.desc'));

  const maxChatTabsWarningEl = container.createDiv({
    cls: 'specorator-max-tabs-warning specorator-setting-validation specorator-setting-validation-warning specorator-hidden',
  });
  maxChatTabsWarningEl.setText(t('settings.maxChatTabs.warning'));

  const updateMaxChatTabsWarning = (value: number): void => {
    maxChatTabsWarningEl.toggleClass('specorator-hidden', value <= 5);
  };

  maxChatTabsSetting.addSlider((slider) => {
    slider
      .setLimits(3, 10, 1)
      .setValue(plugin.settings.maxChatTabs ?? 3)
      .setDynamicTooltip()
      .onChange(async (value) => {
        plugin.settings.maxChatTabs = value;
        await plugin.saveSettings();
        updateMaxChatTabsWarning(value);
        for (const view of plugin.getAllViews()) {
          view.refreshTabControls();
        }
      });
    updateMaxChatTabsWarning(plugin.settings.maxChatTabs ?? 3);
  });
}

export function renderShowAgentEditedFilesSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t('settings.showAgentEditedFiles.name'))
    .setDesc(t('settings.showAgentEditedFiles.desc'))
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.showAgentEditedFiles ?? true)
        .onChange(async (value) => {
          plugin.settings.showAgentEditedFiles = value;
          await plugin.saveSettings();
          // Apply immediately to open chats so disabling hides the strip (and
          // re-enabling restores it) in the current session, not just on the
          // next conversation switch/reload.
          for (const view of plugin.getAllViews()) {
            view.applyEditedFilesSetting();
          }
        })
    );
}

export function renderUserNameSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t('settings.userName.name'))
    .setDesc(t('settings.userName.desc'))
    .addText((text) => {
      text
        .setPlaceholder(t('settings.userName.name'))
        .setValue(plugin.settings.userName)
        .onChange(async (value) => {
          plugin.settings.userName = value;
          await plugin.saveSettings();
        });
      text.inputEl.addEventListener('blur', () => {
        void restartServiceForPromptChange(plugin);
      });
    });
}

export function renderSystemPromptSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t('settings.systemPrompt.name'))
    .setDesc(t('settings.systemPrompt.desc'))
    .addTextArea((text) => {
      text
        .setPlaceholder(t('settings.systemPrompt.name'))
        .setValue(plugin.settings.systemPrompt)
        .onChange(async (value) => {
          plugin.settings.systemPrompt = value;
          await plugin.saveSettings();
        });
      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
      text.inputEl.addEventListener('blur', () => {
        void restartServiceForPromptChange(plugin);
      });
    });
}

export function renderExcludedTagsSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t('settings.excludedTags.name'))
    .setDesc(t('settings.excludedTags.desc'))
    .addTextArea((text) => {
      text
        .setPlaceholder('System\nprivate\ndraft')
        .setValue(plugin.settings.excludedTags.join('\n'))
        .onChange(async (value) => {
          plugin.settings.excludedTags = value
            .split(/\r?\n/)
            .map((entry) => entry.trim().replace(/^#/, ''))
            .filter((entry) => entry.length > 0);
          await plugin.saveSettings();
        });
      text.inputEl.rows = 4;
      text.inputEl.cols = 30;
    });
}

export function renderMediaFolderSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t('settings.mediaFolder.name'))
    .setDesc(t('settings.mediaFolder.desc'))
    .addText((text) => {
      text
        .setPlaceholder('Attachments')
        .setValue(plugin.settings.mediaFolder)
        .onChange(async (value) => {
          plugin.settings.mediaFolder = value.trim();
          await plugin.saveSettings();
        });
      text.inputEl.addClass('specorator-settings-media-input');
      text.inputEl.addEventListener('blur', () => {
        void restartServiceForPromptChange(plugin);
      });
    });
}

export function renderNavMappingsSetting(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
): void {
  new Setting(container)
    .setName(t('settings.navMappings.name'))
    .setDesc(t('settings.navMappings.desc'))
    .addTextArea((text) => {
      let pendingValue = buildNavMappingText(plugin.settings.keyboardNavigation);
      let saveTimeout: number | null = null;

      const commitValue = async (showError: boolean): Promise<void> => {
        if (saveTimeout !== null) {
          window.clearTimeout(saveTimeout);
          saveTimeout = null;
        }

        const result = parseNavMappings(pendingValue);
        if (!result.settings) {
          if (showError) {
            new Notice(t('common.errorWithDetail', { error: result.error ?? '' }));
            pendingValue = buildNavMappingText(plugin.settings.keyboardNavigation);
            text.setValue(pendingValue);
          }
          return;
        }

        plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
        plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
        plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
        await plugin.saveSettings();
        pendingValue = buildNavMappingText(plugin.settings.keyboardNavigation);
        text.setValue(pendingValue);
      };

      const scheduleSave = (): void => {
        if (saveTimeout !== null) {
          window.clearTimeout(saveTimeout);
        }
        saveTimeout = window.setTimeout(() => {
          void commitValue(false);
        }, 500);
      };

      text
        .setPlaceholder('Map w scrollup\nmap s scrolldown\nmap i focusinput')
        .setValue(pendingValue)
        .onChange((value) => {
          pendingValue = value;
          scheduleSave();
        });

      text.inputEl.rows = 3;
      text.inputEl.addEventListener('blur', () => {
        void commitValue(true);
      });
    });
}

/**
 * Shared (provider-neutral) environment section: env textarea, keychain
 * secret vars, custom-model overrides, and the env snippet manager. The
 * legacy tab passes a heading; the registry renderer omits it because the
 * section walker already renders the heading row.
 */
export function renderSharedEnvironmentSection(
  plugin: SpecoratorPlugin,
  container: HTMLElement,
  heading?: string,
): void {
  renderEnvironmentSettingsSection({
    container,
    plugin,
    scope: 'shared',
    heading,
    name: 'Shared environment',
    desc: 'Provider-neutral runtime variables shared across all providers. Use this for PATH, proxy, cert, and temp variables.',
    placeholder: 'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem',
    renderCustomContextLimits: (target) => renderCustomContextLimits(plugin, target),
  });
}
