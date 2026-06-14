import type { App } from 'obsidian';
import { PluginSettingTab, Setting } from 'obsidian';

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
import { openHotkeySettingsWithFilter } from '../../utils/obsidianPrivateApi';
// setEnabled is provided by the registered ProviderSettingsReconciler.
import { formatBoundHotkeys } from './hotkeyFormat';
import {
  getSettingsRegistry,
  renderTab,
  type SettingsCtx,
  useRegistryRenderer,
} from './registry';
import { SearchBar } from './search/SearchBar';
import { SearchResultsView } from './search/SearchResultsView';
import { clearSearchAndShowTabs } from './search/searchTabToggle';
import { searchFields } from './search/searchUtils';
import {
  buildTabBar,
  buildTabContents,
  computeTabIds,
  ensureRegistryForLocale,
  type SettingsTabId,
} from './settingsTabStrip';
import { renderAgentBoardSettingsSection } from './ui/AgentBoardSettingsSection';
import { renderCustomContextLimits } from './ui/CustomContextLimits';
import {
  renderExcludedTagsSetting,
  renderMaxChatTabsSetting,
  renderMediaFolderSetting,
  renderNavMappingsSetting,
  renderProviderEnableSetting,
  renderSharedEnvironmentSection,
  renderSystemPromptSetting,
  renderTabBarPositionSetting,
  renderUserNameSetting,
} from './ui/GeneralTabSections';
import { renderLoggingSettingsSection } from './ui/LoggingSettingsSection';
import { renderQuickActionsSettingsTab } from './ui/QuickActionsSettingsTab';

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
  // Locale the registry's t()-captured labels were registered under; null
  // until first registry render.
  private registryLocale: string | null = null;
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

    const tabIds = computeTabIds(this.plugin.settings);
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = 'general';
    }

    // `setLocale` above runs first so the (re)registered registry captures the
    // active locale; see `ensureRegistryForLocale` for why this is required.
    this.registryLocale = ensureRegistryForLocale(
      tabIds,
      this.plugin.settings.locale,
      this.registryLocale,
    );

    const ctx: SettingsCtx = {
      // Cast: `ClaudianPlugin.settings` carries provider-typed extensions
      // beyond the core `ClaudianSettings` shape. Registry fields only read
      // through `readPath`/`writePath`, so the wider object is safe.
      settings: this.plugin.settings as unknown as ClaudianSettings,
      saveSettings: () => this.plugin.saveSettings(),
      refresh: () => this.display(),
      plugin: this.plugin,
    };

    this.mountSearchBar(containerEl, ctx);

    const tabBar = containerEl.createDiv({ cls: 'claudian-settings-tabs' });
    containerEl.createDiv({
      cls: 'claudian-settings-search-results claudian-hidden',
    });
    const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();
    const tabContents = new Map<SettingsTabId, HTMLDivElement>();

    buildTabBar(
      tabBar,
      tabIds,
      this.activeTab,
      (id) => {
        this.activeTab = id;
      },
      tabButtons,
      tabContents,
    );
    buildTabContents(containerEl, tabIds, this.activeTab, tabContents);

    this.renderTabBodies(tabIds, tabContents, ctx);
  }

  // Mount (replacing any prior instance) the top search bar wired to the
  // current render context.
  private mountSearchBar(containerEl: HTMLElement, ctx: SettingsCtx): void {
    const searchBarHost = containerEl.createDiv({
      cls: 'claudian-settings-search-bar',
    });
    if (this.searchBar) {
      this.searchBar.dispose();
    }
    this.searchBar = new SearchBar(searchBarHost, (query) => {
      this.handleSearchQuery(query, containerEl, ctx);
    });
    this.searchBar.render();
  }

  // Render every tab's body into its content host. The fixed tabs each have a
  // registry-or-legacy fork; provider tabs route through `renderProviderTab`.
  // Ordering matches the legacy inline sequence exactly.
  private renderTabBodies(
    tabIds: readonly SettingsTabId[],
    tabContents: Map<SettingsTabId, HTMLDivElement>,
    ctx: SettingsCtx,
  ): void {
    this.renderFixedTabBodies(tabContents, ctx);

    // Provider tabs are every tab id that is not one of the three fixed tabs,
    // preserving the original enabled-provider iteration order.
    for (const id of tabIds) {
      if (id === 'general' || id === 'agentBoard' || id === 'diagnostics') {
        continue;
      }
      const content = tabContents.get(id);
      if (content) {
        this.renderProviderTab(id, content, ctx);
      }
    }
  }

  // Render the general / agentBoard / diagnostics bodies. Each prefers the
  // registry renderer when enabled and falls back to the legacy imperative
  // renderer (diagnostics has none, so it renders only under the registry).
  private renderFixedTabBodies(
    tabContents: Map<SettingsTabId, HTMLDivElement>,
    ctx: SettingsCtx,
  ): void {
    const generalContent = tabContents.get('general')!;
    if (!this.pushRegistryTab(generalContent, 'general', ctx)) {
      this.renderGeneralTab(generalContent);
    }

    const agentBoardContent = tabContents.get('agentBoard');
    if (agentBoardContent && !this.pushRegistryTab(agentBoardContent, 'agentBoard', ctx)) {
      renderAgentBoardSettingsSection(agentBoardContent, this.plugin);
    }

    // Diagnostics has no legacy tab renderer — its imperative collaborators
    // still surface inside the General tab's Diagnostics section. Until the
    // flag flips, the dedicated tab simply renders nothing.
    const diagnosticsContent = tabContents.get('diagnostics');
    if (diagnosticsContent) {
      this.pushRegistryTab(diagnosticsContent, 'diagnostics', ctx);
    }
  }

  // Render `id` through the registry renderer (tracking its disposer) when the
  // registry is enabled for it. Returns whether the registry handled the tab,
  // so callers can fall back to a legacy renderer.
  private pushRegistryTab(
    content: HTMLElement,
    id: SettingsTabId,
    ctx: SettingsCtx,
  ): boolean {
    if (!useRegistryRenderer(id)) {
      return false;
    }
    this.tabDisposers.push(renderTab(content, id, ctx, getSettingsRegistry()));
    return true;
  }

  // Render a single provider tab: registry renderer when enabled for the
  // provider, otherwise the provider-owned imperative settings tab renderer.
  private renderProviderTab(
    providerId: SettingsTabId,
    content: HTMLElement,
    ctx: SettingsCtx,
  ): void {
    if (this.pushRegistryTab(content, providerId, ctx)) {
      return;
    }

    ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId)?.render(content, {
      plugin: this.plugin,
      renderHiddenProviderCommandSetting: (target, targetProviderId, copy) =>
        this.renderHiddenProviderCommandSetting(target, targetProviderId, copy),
      refreshModelSelectors: () => {
        for (const view of this.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
      },
      renderCustomContextLimits: (target, innerProviderId) =>
        renderCustomContextLimits(this.plugin, target, innerProviderId),
    });
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

    renderTabBarPositionSetting(this.plugin, container);

    renderMaxChatTabsSetting(this.plugin, container);

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

    new Setting(container)
      .setName(t('settings.showAgentEditedFiles.name'))
      .setDesc(t('settings.showAgentEditedFiles.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showAgentEditedFiles ?? true)
          .onChange(async (value) => {
            this.plugin.settings.showAgentEditedFiles = value;
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

    renderUserNameSetting(this.plugin, container);

    renderSystemPromptSetting(this.plugin, container);

    renderExcludedTagsSetting(this.plugin, container);

    renderMediaFolderSetting(this.plugin, container);

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

    renderNavMappingsSetting(this.plugin, container);

    // --- Hotkeys ---

    new Setting(container).setName(t('settings.hotkeys')).setHeading();

    const hotkeyGrid = container.createDiv({ cls: 'claudian-hotkey-grid' });
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:inline-edit', 'settings.inlineEditHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:open-view', 'settings.openChatHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:new-session', 'settings.newSessionHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:new-tab', 'settings.newTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, 'claudian:close-current-tab', 'settings.closeTabHotkey');

    // --- Environment ---

    renderSharedEnvironmentSection(this.plugin, container, t('settings.environment'));

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

    for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
      renderProviderEnableSetting(this.plugin, container, providerId, () => this.display());
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

  private handleSearchQuery(
    query: string,
    containerEl: HTMLElement,
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
      (tabId, _sectionId, fieldId) =>
        this.handleGoToField(containerEl, tabId, fieldId, tabBar, resultsHost),
      () => this.handleResetSearch(containerEl, tabBar, resultsHost),
    );
    this.searchResultsView.render();
  }

  private handleGoToField(
    containerEl: HTMLElement,
    tabId: string,
    fieldId: string,
    tabBar: HTMLElement,
    resultsHost: HTMLElement,
  ): void {
    clearSearchAndShowTabs(containerEl, tabBar, resultsHost);

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
    clearSearchAndShowTabs(containerEl, tabBar, resultsHost);
  }
}
