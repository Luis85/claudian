import type { App } from 'obsidian';
import { Notice, Platform, PluginSettingTab, Setting } from 'obsidian';

import { SETTINGS_FIELD_HIGHLIGHT_MS } from '../../core/constants';
import {
  getHiddenProviderCommands,
  normalizeHiddenCommandList,
} from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from '../../core/providers/types';
import { asSettingsBag, type ChatViewPlacement, type ClaudianSettings } from '../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, setLocale, t } from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import type ClaudianPlugin from '../../main';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import {
  getHotkeysForCommand,
  type ObsidianHotkey,
  openHotkeySettingsWithFilter,
} from '../../utils/obsidianPrivateApi';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';
// setEnabled is provided by the registered ProviderSettingsReconciler.
import {
  getSettingsRegistry,
  registerAllSettings,
  renderTab,
  type SettingsCtx,
  useRegistryRenderer,
} from './registry';
import { SearchBar } from './search/SearchBar';
import { SearchResultsView } from './search/SearchResultsView';
import { searchFields } from './search/searchUtils';
import { renderAgentBoardSettingsSection } from './ui/AgentBoardSettingsSection';
import { renderEnvironmentSettingsSection } from './ui/EnvironmentSettingsSection';
import { renderLoggingSettingsSection } from './ui/LoggingSettingsSection';
import { renderOrchestratorSettingsTab } from './ui/OrchestratorSettingsTab';
import { renderQuickActionsSettingsTab } from './ui/QuickActionsSettingsTab';

type SettingsTabId = string;

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

function formatBoundHotkeys(app: App, commandId: string): string | null {
  const hotkeys = getHotkeysForCommand(app, commandId);
  return hotkeys ? hotkeys.map(formatHotkey).join(', ') : null;
}

function addHotkeySettingRow(
  containerEl: HTMLElement,
  app: App,
  commandId: string,
  translationPrefix: string,
): void {
  const hotkey = formatBoundHotkeys(app, commandId);
  const item = containerEl.createDiv({ cls: 'claudian-hotkey-item' });
  item.createSpan({
    cls: 'claudian-hotkey-name',
    text: t(`${translationPrefix}.name` as TranslationKey),
  });
  if (hotkey) {
    item.createSpan({ cls: 'claudian-hotkey-badge', text: hotkey });
  }
  item.addEventListener('click', () => {
    openHotkeySettingsWithFilter(app, 'Claudian');
  });
}

export class ClaudianSettingTab extends PluginSettingTab {
  plugin: ClaudianPlugin;
  private activeTab: SettingsTabId = 'general';
  private registryInitialized = false;
  private searchBar: SearchBar | null = null;
  private searchResultsView: SearchResultsView | null = null;
  private highlightTimeouts: Map<HTMLElement, number> = new Map();
  // Field-level disposers (event-bus unsubscribes, observers, …) returned by
  // `renderTab`. `display()` empties `containerEl` and creates fresh tab
  // content divs each call, so disposers cannot be keyed by host element. We
  // hold them on the tab instance and drain them at the top of every
  // `display()` before the previous DOM is destroyed. Skipping this caused an
  // exponential listener leak in the event bus and froze the settings UI on
  // the Agent Board lane editor after a few rapid clicks.
  private tabDisposers: Array<() => void> = [];
  // Re-entrancy guard. A widget disposer that synchronously triggers another
  // `display()` (e.g. an unsubscribe callback that calls `ctx.refresh()`)
  // would otherwise interleave drains and renders; the nested render's
  // disposers would land in the outer call's `tabDisposers` array and
  // listeners on the orphaned hosts would stay live until the next display.
  // We drop the re-entrant call instead — the outer render is about to
  // replace the DOM anyway.
  private displaying = false;

  constructor(app: App, plugin: ClaudianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  hide(): void {
    this.drainTabDisposers();
  }

  private drainTabDisposers(): void {
    const pending = this.tabDisposers;
    this.tabDisposers = [];
    for (const dispose of pending) {
      try {
        dispose();
      } catch {
        // Disposers must be defensive — swallow so one bad widget cannot stop
        // the rest from cleaning up.
      }
    }
  }

  display(): void {
    if (this.displaying) {
      // Re-entrant call. Outer render is in flight and will produce the next
      // canonical DOM; dropping this call avoids interleaved drains.
      return;
    }
    this.displaying = true;
    try {
      this.drainTabDisposers();
      this.renderTabs();
    } finally {
      this.displaying = false;
    }
  }

  private renderTabs(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('claudian-settings');

    setLocale(this.plugin.settings.locale as Locale);

    const providerTabs = ProviderRegistry.getEnabledProviderIds(
      asSettingsBag(this.plugin.settings),
    );
    const tabIds: SettingsTabId[] = [
      'general',
      'agentBoard',
      'orchestrator',
      'diagnostics',
      ...providerTabs,
    ];
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = 'general';
    }

    // Lazy-init the registry only if any visible tab requires it. The shell
    // keeps the legacy imperative path when every tab opts out (the default
    // until D4 flips `general`). The guard prevents `registerAllSettings`
    // (which throws on duplicate registration) from running twice.
    if (!this.registryInitialized && tabIds.some(useRegistryRenderer)) {
      registerAllSettings();
      this.registryInitialized = true;
    }

    const ctx: SettingsCtx = {
      // Cast: `ClaudianPlugin.settings` carries provider-typed extensions
      // beyond the core `ClaudianSettings` shape. Registry fields only read
      // through `readPath`/`writePath`, so the wider object is safe.
      settings: this.plugin.settings as unknown as ClaudianSettings,
      saveSettings: () => this.plugin.saveSettings(),
      refresh: () => this.display(),
      plugin: this.plugin,
    };

    // Mount search bar at top
    const searchBarHost = containerEl.createDiv({
      cls: 'claudian-settings-search-bar',
    });

    if (this.searchBar) {
      this.searchBar.dispose();
    }
    this.searchBar = new SearchBar(searchBarHost, (query) => {
      this.handleSearchQuery(query, containerEl, tabIds, ctx);
    });
    this.searchBar.render();

    const tabBar = containerEl.createDiv({ cls: 'claudian-settings-tabs' });
    containerEl.createDiv({
      cls: 'claudian-settings-search-results claudian-hidden',
    });
    const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();
    const tabContents = new Map<SettingsTabId, HTMLDivElement>();

    for (const id of tabIds) {
      let label: string;
      if (id === 'general') {
        label = t('settings.tabs.general' as TranslationKey);
      } else if (id === 'agentBoard') {
        label = 'Agent Board';
      } else if (id === 'orchestrator') {
        label = t('settings.tabs.orchestrator' as TranslationKey);
      } else if (id === 'diagnostics') {
        label = 'Diagnostics';
      } else {
        label = ProviderRegistry.getProviderDisplayName(id);
      }
      const button = tabBar.createEl('button', {
        cls: `claudian-settings-tab${id === this.activeTab ? ' claudian-settings-tab--active' : ''}`,
        attr: { 'data-tab-id': id },
        text: label,
      });
      button.addEventListener('click', () => {
        this.activeTab = id;
        for (const tabId of tabIds) {
          tabButtons.get(tabId)?.toggleClass('claudian-settings-tab--active', tabId === id);
          tabContents.get(tabId)?.toggleClass('claudian-settings-tab-content--active', tabId === id);
        }
      });
      tabButtons.set(id, button);
    }

    for (const id of tabIds) {
      const content = containerEl.createDiv({
        cls: `claudian-settings-tab-content${id === this.activeTab ? ' claudian-settings-tab-content--active' : ''}`,
      });
      tabContents.set(id, content);
    }

    if (useRegistryRenderer('general')) {
      this.tabDisposers.push(
        renderTab(tabContents.get('general')!, 'general', ctx, getSettingsRegistry()),
      );
    } else {
      this.renderGeneralTab(tabContents.get('general')!);
    }

    const agentBoardContent = tabContents.get('agentBoard');
    if (agentBoardContent) {
      if (useRegistryRenderer('agentBoard')) {
        this.tabDisposers.push(
          renderTab(agentBoardContent, 'agentBoard', ctx, getSettingsRegistry()),
        );
      } else {
        renderAgentBoardSettingsSection(agentBoardContent, this.plugin);
      }
    }

    const orchestratorContent = tabContents.get('orchestrator');
    if (orchestratorContent) {
      if (useRegistryRenderer('orchestrator')) {
        this.tabDisposers.push(
          renderTab(orchestratorContent, 'orchestrator', ctx, getSettingsRegistry()),
        );
      } else {
        renderOrchestratorSettingsTab(orchestratorContent, this.plugin);
      }
    }

    const diagnosticsContent = tabContents.get('diagnostics');
    if (diagnosticsContent && useRegistryRenderer('diagnostics')) {
      // Diagnostics has no legacy tab renderer — its imperative collaborators
      // still surface inside the General tab's Diagnostics section. Until the
      // flag flips, the dedicated tab simply renders nothing.
      this.tabDisposers.push(
        renderTab(diagnosticsContent, 'diagnostics', ctx, getSettingsRegistry()),
      );
    }

    for (const providerId of providerTabs) {
      const content = tabContents.get(providerId);
      if (!content) {
        continue;
      }

      if (useRegistryRenderer(providerId)) {
        this.tabDisposers.push(renderTab(content, providerId, ctx, getSettingsRegistry()));
        continue;
      }

      ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId)?.render(content, {
        plugin: this.plugin,
        renderHiddenProviderCommandSetting: (
          target,
          targetProviderId,
          copy,
        ) => this.renderHiddenProviderCommandSetting(target, targetProviderId, copy),
        refreshModelSelectors: () => {
          for (const view of this.plugin.getAllViews()) {
            view.refreshModelSelector();
          }
        },
        renderCustomContextLimits: (target, providerId) => this.renderCustomContextLimits(target, providerId),
      });
    }
  }

  private renderGeneralTab(container: HTMLElement): void {
    // --- Providers --- (top of settings: enabling a provider is the first step)
    this.renderProvidersSection(container);

    new Setting(container)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dropdown) => {
        const locales = getAvailableLocales();
        for (const locale of locales) {
          dropdown.addOption(locale, getLocaleDisplayName(locale));
        }
        dropdown
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            const locale = value as Locale;
            if (!setLocale(locale)) {
              dropdown.setValue(this.plugin.settings.locale);
              return;
            }
            this.plugin.settings.locale = locale;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // --- Quick actions ---

    renderQuickActionsSettingsTab(container, this.plugin);

    // --- Display ---

    new Setting(container).setName(t('settings.display')).setHeading();

    new Setting(container)
      .setName(t('settings.tabBarPosition.name'))
      .setDesc(t('settings.tabBarPosition.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('input', t('settings.tabBarPosition.input'))
          .addOption('header', t('settings.tabBarPosition.header'))
          .setValue(this.plugin.settings.tabBarPosition ?? 'input')
          .onChange(async (value) => {
            this.plugin.settings.tabBarPosition = value as 'input' | 'header';
            await this.plugin.saveSettings();

            for (const view of this.plugin.getAllViews()) {
              view.updateLayoutForPosition();
            }
          });
      });

    const maxTabsSetting = new Setting(container)
      .setName(t('settings.maxTabs.name'))
      .setDesc(t('settings.maxTabs.desc'));

    const maxTabsWarningEl = container.createDiv({
      cls: 'claudian-max-tabs-warning claudian-setting-validation claudian-setting-validation-warning claudian-hidden',
    });
    maxTabsWarningEl.setText(t('settings.maxTabs.warning'));

    const updateMaxTabsWarning = (value: number): void => {
      maxTabsWarningEl.toggleClass('claudian-hidden', value <= 5);
    };

    maxTabsSetting.addSlider((slider) => {
      slider
        .setLimits(3, 10, 1)
        .setValue(this.plugin.settings.maxTabs ?? 3)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxTabs = value;
          await this.plugin.saveSettings();
          updateMaxTabsWarning(value);
          for (const view of this.plugin.getAllViews()) {
            view.refreshTabControls();
          }
        });
      updateMaxTabsWarning(this.plugin.settings.maxTabs ?? 3);
    });

    new Setting(container)
      .setName(t('settings.chatViewPlacement.name'))
      .setDesc(t('settings.chatViewPlacement.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('right-sidebar', t('settings.chatViewPlacement.rightSidebar'))
          .addOption('left-sidebar', t('settings.chatViewPlacement.leftSidebar'))
          .addOption('main-tab', t('settings.chatViewPlacement.mainTab'))
          .setValue(this.plugin.settings.chatViewPlacement)
          .onChange(async (value) => {
            this.plugin.settings.chatViewPlacement = value as ChatViewPlacement;
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName(t('settings.enableAutoScroll.name'))
      .setDesc(t('settings.enableAutoScroll.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoScroll = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t('settings.deferMathRenderingDuringStreaming.name'))
      .setDesc(t('settings.deferMathRenderingDuringStreaming.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deferMathRenderingDuringStreaming ?? true)
          .onChange(async (value) => {
            this.plugin.settings.deferMathRenderingDuringStreaming = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Conversations ---

    new Setting(container).setName(t('settings.conversations')).setHeading();

    new Setting(container)
      .setName(t('settings.autoTitle.name'))
      .setDesc(t('settings.autoTitle.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.enableAutoTitleGeneration) {
      new Setting(container)
        .setName(t('settings.titleModel.name'))
        .setDesc(t('settings.titleModel.desc'))
        .addDropdown((dropdown) => {
          dropdown.addOption('', t('settings.titleModel.auto'));

          const settingsBag = asSettingsBag(this.plugin.settings);
          const seenValues = new Set<string>();
          for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
            const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
            for (const model of uiConfig.getModelOptions(settingsBag)) {
              if (!seenValues.has(model.value)) {
                seenValues.add(model.value);
                dropdown.addOption(model.value, model.label);
              }
            }
          }

          dropdown
            .setValue(this.plugin.settings.titleGenerationModel || '')
            .onChange(async (value) => {
              this.plugin.settings.titleGenerationModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // --- Content ---

    new Setting(container).setName(t('settings.content')).setHeading();

    new Setting(container)
      .setName(t('settings.userName.name'))
      .setDesc(t('settings.userName.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.userName.name'))
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(container)
      .setName(t('settings.systemPrompt.name'))
      .setDesc(t('settings.systemPrompt.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder(t('settings.systemPrompt.name'))
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(container)
      .setName(t('settings.excludedTags.name'))
      .setDesc(t('settings.excludedTags.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('System\nprivate\ndraft')
          .setValue(this.plugin.settings.excludedTags.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(/\r?\n/)
              .map((entry) => entry.trim().replace(/^#/, ''))
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(container)
      .setName(t('settings.mediaFolder.name'))
      .setDesc(t('settings.mediaFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('Attachments')
          .setValue(this.plugin.settings.mediaFolder)
          .onChange(async (value) => {
            this.plugin.settings.mediaFolder = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('claudian-settings-media-input');
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    // --- Input ---

    new Setting(container).setName(t('settings.input')).setHeading();

    new Setting(container)
      .setName(t('settings.requireCommandOrControlEnterToSend.name'))
      .setDesc(t('settings.requireCommandOrControlEnterToSend.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.requireCommandOrControlEnterToSend ?? false)
          .onChange(async (value) => {
            this.plugin.settings.requireCommandOrControlEnterToSend = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName(t('settings.navMappings.name'))
      .setDesc(t('settings.navMappings.desc'))
      .addTextArea((text) => {
        let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        let saveTimeout: number | null = null;

        const commitValue = async (showError: boolean): Promise<void> => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
          }

          const result = parseNavMappings(pendingValue);
          if (!result.settings) {
            if (showError) {
              new Notice(`${t('common.error')}: ${result.error}`);
              pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
              text.setValue(pendingValue);
            }
            return;
          }

          this.plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
          this.plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
          this.plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
          await this.plugin.saveSettings();
          pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
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

    // --- Hotkeys ---

    new Setting(container).setName(t('settings.hotkeys')).setHeading();

    const hotkeyGrid = container.createDiv({ cls: 'claudian-hotkey-grid' });
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:inline-edit', 'settings.inlineEditHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:open-view', 'settings.openChatHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:new-session', 'settings.newSessionHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:new-tab', 'settings.newTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:close-current-tab', 'settings.closeTabHotkey');

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      plugin: this.plugin,
      scope: 'shared',
      heading: t('settings.environment'),
      name: 'Shared environment',
      desc: 'Provider-neutral runtime variables shared across all providers. Use this for PATH, proxy, cert, and temp variables.',
      placeholder: 'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem',
      renderCustomContextLimits: (target) => this.renderCustomContextLimits(target),
    });

    // --- Diagnostics ---

    renderLoggingSettingsSection(container, this.plugin);
  }

  /**
   * Renders the "Providers" section with one enable toggle per registered
   * provider. Toggling persists the provider's `enabled` flag, refreshes the
   * model selectors across views, and re-renders the settings tab so the
   * enabled provider tab list updates.
   */
  private renderProvidersSection(container: HTMLElement): void {
    new Setting(container).setName('Providers').setHeading();

    const settingsBag = asSettingsBag(this.plugin.settings);

    for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
      const displayName = ProviderRegistry.getProviderDisplayName(providerId);
      const reconciler = ProviderRegistry.getSettingsReconciler(providerId);
      if (!reconciler.setEnabled) {
        continue;
      }

      new Setting(container)
        .setName(`Enable ${displayName}`)
        .setDesc(`Show ${displayName} as a chat provider and reveal its settings tab.`)
        .addToggle((toggle) =>
          toggle
            .setValue(ProviderRegistry.isEnabled(providerId, settingsBag))
            .onChange(async (value) => {
              reconciler.setEnabled!(settingsBag, value);
              await this.plugin.saveSettings();
              for (const view of this.plugin.getAllViews()) {
                view.refreshModelSelector();
                void view.refreshProviderAvailability();
              }
              this.display();
            })
        );
    }
  }

  private renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string },
  ): void {
    new Setting(container)
      .setName(copy.name)
      .setDesc(copy.desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(copy.placeholder)
          .setValue(getHiddenProviderCommands(this.plugin.settings, providerId).join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.hiddenProviderCommands = {
              ...this.plugin.settings.hiddenProviderCommands,
              [providerId]: normalizeHiddenCommandList(value.split(/\r?\n/)),
            };
            await this.plugin.saveSettings();
            this.plugin.getView()?.updateHiddenProviderCommands();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void {
    container.empty();

    const uniqueModelIds = new Set<string>();
    const providerIds = providerId
      ? [providerId]
      : ProviderRegistry.getRegisteredProviderIds();

    for (const targetProviderId of providerIds) {
      const envVars = parseEnvironmentVariables(
        this.plugin.getActiveEnvironmentVariables(targetProviderId),
      );
      for (const modelId of ProviderRegistry.getChatUIConfig(targetProviderId).getCustomModelIds(envVars)) {
        uniqueModelIds.add(modelId);
      }
    }

    if (uniqueModelIds.size === 0) {
      return;
    }

    const headerEl = container.createDiv({ cls: 'claudian-context-limits-header' });
    headerEl.createSpan({
      text: t('settings.customModelOverrides.name'),
      cls: 'claudian-context-limits-label',
    });

    const descEl = container.createDiv({ cls: 'claudian-context-limits-desc' });
    descEl.setText(t('settings.customModelOverrides.desc'));

    const listEl = container.createDiv({ cls: 'claudian-context-limits-list' });

    for (const modelId of uniqueModelIds) {
      const currentValue = this.plugin.settings.customContextLimits?.[modelId];
      const currentAlias = this.plugin.settings.customModelAliases?.[modelId] ?? '';

      const itemEl = listEl.createDiv({ cls: 'claudian-context-limits-item' });
      const nameEl = itemEl.createDiv({ cls: 'claudian-context-limits-model' });
      nameEl.setText(modelId);

      const inputWrapper = itemEl.createDiv({ cls: 'claudian-context-limits-input-wrapper' });
      const aliasInputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: t('settings.customModelAliases.placeholder'),
        cls: 'claudian-context-alias-input',
        value: currentAlias,
      });
      aliasInputEl.setAttribute('aria-label', `Alias for ${modelId}`);
      aliasInputEl.title = 'Custom label shown in the model selector. Leave empty to use the default.';

      const inputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: '200k',
        cls: 'claudian-context-limits-input',
        value: currentValue ? formatContextLimit(currentValue) : '',
      });
      inputEl.setAttribute('aria-label', `Context window for ${modelId}`);

      const validationEl = inputWrapper.createDiv({ cls: 'claudian-context-limit-validation claudian-hidden' });

      const saveAlias = async (): Promise<void> => {
        if (!this.plugin.settings.customModelAliases) {
          this.plugin.settings.customModelAliases = {};
        }

        const existing = this.plugin.settings.customModelAliases[modelId] ?? '';
        const trimmed = aliasInputEl.value.trim();
        if (trimmed === existing) {
          aliasInputEl.value = existing;
          return;
        }

        if (trimmed) {
          this.plugin.settings.customModelAliases[modelId] = trimmed;
        } else {
          delete this.plugin.settings.customModelAliases[modelId];
        }

        await this.plugin.saveSettings();
        for (const view of this.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
      };

      const saveContextLimit = async (): Promise<void> => {
        const trimmed = inputEl.value.trim();

        if (!this.plugin.settings.customContextLimits) {
          this.plugin.settings.customContextLimits = {};
        }

        if (!trimmed) {
          delete this.plugin.settings.customContextLimits[modelId];
          validationEl.toggleClass('claudian-hidden', true);
          inputEl.classList.remove('claudian-input-error');
        } else {
          const parsed = parseContextLimit(trimmed);
          if (parsed === null) {
            validationEl.setText(t('settings.customContextLimits.invalid'));
            validationEl.toggleClass('claudian-hidden', false);
            inputEl.classList.add('claudian-input-error');
            return;
          }

          this.plugin.settings.customContextLimits[modelId] = parsed;
          validationEl.toggleClass('claudian-hidden', true);
          inputEl.classList.remove('claudian-input-error');
        }

        await this.plugin.saveSettings();
      };

      inputEl.addEventListener('input', () => {
        void saveContextLimit();
      });
      aliasInputEl.addEventListener('blur', () => {
        void saveAlias();
      });
      aliasInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          aliasInputEl.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          aliasInputEl.value = this.plugin.settings.customModelAliases?.[modelId] ?? '';
          aliasInputEl.blur();
        }
      });
    }
  }

  private async restartServiceForPromptChange(): Promise<void> {
    const view = this.plugin.getView();
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

  private handleSearchQuery(
    query: string,
    containerEl: HTMLElement,
    tabIds: SettingsTabId[],
    ctx: SettingsCtx,
  ): void {
    const tabBar = containerEl.querySelector('.claudian-settings-tabs') as HTMLElement;
    const resultsHost = containerEl.querySelector(
      '.claudian-settings-search-results',
    ) as HTMLElement;

    if (!query.trim()) {
      // Empty query: hide results, show tabs
      tabBar.toggleClass('claudian-hidden', false);
      resultsHost.toggleClass('claudian-hidden', true);
      return;
    }

    // Get all fields from registry
    const allFields = getSettingsRegistry().getAllFields();

    // Search for matching fields, filtered by current visibility predicates
    const results = searchFields(allFields, query, ctx.settings);

    // Show results, hide tabs
    tabBar.toggleClass('claudian-hidden', true);
    resultsHost.toggleClass('claudian-hidden', false);

    // Render results view
    if (this.searchResultsView) {
      this.searchResultsView = null;
    }
    this.searchResultsView = new SearchResultsView(
      resultsHost,
      results,
      (tabId, sectionId, fieldId) =>
        this.handleGoToField(
          containerEl,
          tabId,
          sectionId,
          fieldId,
          tabIds,
          ctx,
          tabBar,
          resultsHost,
        ),
      () => this.handleResetSearch(containerEl, tabBar, resultsHost),
    );
    this.searchResultsView.render();
  }

  private handleGoToField(
    containerEl: HTMLElement,
    tabId: string,
    sectionId: string,
    fieldId: string,
    tabIds: SettingsTabId[],
    ctx: SettingsCtx,
    tabBar: HTMLElement,
    resultsHost: HTMLElement,
  ): void {
    // Clear search
    const searchInput = containerEl.querySelector(
      '.claudian-settings-search-bar input[type="search"]',
    ) as HTMLInputElement;
    if (searchInput) {
      searchInput.value = '';
    }

    // Hide results, show tabs
    tabBar.toggleClass('claudian-hidden', false);
    resultsHost.toggleClass('claudian-hidden', true);

    // Switch to target tab
    this.activeTab = tabId as SettingsTabId;
    const tabButtons = containerEl.querySelectorAll('.claudian-settings-tab');
    const tabContents = containerEl.querySelectorAll('.claudian-settings-tab-content');

    for (let i = 0; i < tabButtons.length; i++) {
      const button = tabButtons[i] as HTMLElement;
      const content = tabContents[i] as HTMLElement;
      const isActive = (button.getAttribute('data-tab-id') || '') === tabId;
      button.toggleClass('claudian-settings-tab--active', isActive);
      content.toggleClass('claudian-settings-tab-content--active', isActive);
    }

    // Scroll target field into view
    window.setTimeout(() => {
      const fieldRow = containerEl.querySelector(`[data-field-id="${fieldId}"]`);
      if (fieldRow instanceof HTMLElement) {
        fieldRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Add highlight class
        fieldRow.classList.add('claudian-settings-field--highlight');
        fieldRow.setAttribute('aria-highlighted', 'true');

        // Clear any existing timeout for this element
        if (this.highlightTimeouts.has(fieldRow)) {
          const existingTimeout = this.highlightTimeouts.get(fieldRow);
          if (existingTimeout !== undefined) {
            window.clearTimeout(existingTimeout);
          }
        }

        const timeout = window.setTimeout(() => {
          fieldRow.classList.remove('claudian-settings-field--highlight');
          fieldRow.removeAttribute('aria-highlighted');
          this.highlightTimeouts.delete(fieldRow);
        }, SETTINGS_FIELD_HIGHLIGHT_MS);

        this.highlightTimeouts.set(fieldRow, timeout);
      }
    }, 50);
  }

  private handleResetSearch(
    containerEl: HTMLElement,
    tabBar: HTMLElement,
    resultsHost: HTMLElement,
  ): void {
    const searchInput = containerEl.querySelector(
      '.claudian-settings-search-bar input[type="search"]',
    ) as HTMLInputElement;
    if (searchInput) {
      searchInput.value = '';
    }

    tabBar.toggleClass('claudian-hidden', false);
    resultsHost.toggleClass('claudian-hidden', true);
  }
}
