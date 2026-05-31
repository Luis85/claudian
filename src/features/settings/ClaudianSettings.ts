import type { App } from 'obsidian';
import { PluginSettingTab } from 'obsidian';

import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type { ClaudianSettings } from '../../core/types/settings';
import { setLocale, t } from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import type ClaudianPlugin from '../../main';
import {
  getSettingsRegistry,
  registerAllSettings,
  renderTab,
  type SettingsCtx,
} from './registry';
import { SearchBar } from './search/SearchBar';
import { SearchResultsView } from './search/SearchResultsView';
import { searchFields } from './search/searchUtils';

type SettingsTabId = string;

export class ClaudianSettingTab extends PluginSettingTab {
  plugin: ClaudianPlugin;
  private activeTab: SettingsTabId = 'general';
  private registryInitialized = false;
  private searchBar: SearchBar | null = null;
  private searchResultsView: SearchResultsView | null = null;
  private highlightTimeouts: Map<HTMLElement, number> = new Map();

  constructor(app: App, plugin: ClaudianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('claudian-settings');

    setLocale(this.plugin.settings.locale as Locale);

    const providerTabs = ProviderRegistry.getEnabledProviderIds(
      this.plugin.settings as unknown as Record<string, unknown>,
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

    // Initialize the registry once per session. The guard prevents
    // `registerAllSettings` (which throws on duplicate registration) from running twice.
    if (!this.registryInitialized) {
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

    for (const tabId of tabIds) {
      const content = tabContents.get(tabId);
      if (content) {
        renderTab(content, tabId, ctx, getSettingsRegistry());
      }
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

    // Search for matching fields
    const results = searchFields(allFields, query);

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

        // Remove highlight after 1500ms
        const timeout = window.setTimeout(() => {
          fieldRow.classList.remove('claudian-settings-field--highlight');
          fieldRow.removeAttribute('aria-highlighted');
          this.highlightTimeouts.delete(fieldRow);
        }, 1500);

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
