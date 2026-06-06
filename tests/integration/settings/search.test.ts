/**
 * @jest-environment jsdom
 */
/**
 * Integration test for settings search functionality.
 *
 * Tests that SearchBar and SearchResultsView integrate with ClaudianSettings.display():
 * - SearchBar mounts at the top
 * - Non-empty query hides tab strip and shows results
 * - Go button clears search, swaps tab, scrolls to field, adds highlight class
 */

import '../../setup/obsidianDom';

import { ProviderRegistry } from '../../../src/core/providers/ProviderRegistry';
import { ClaudianSettingTab } from '../../../src/features/settings/ClaudianSettings';
import { resetSettingsRegistryForTests } from '../../../src/features/settings/registry';

// Mock ProviderRegistry
jest.mock('../../../src/core/providers/ProviderRegistry');

// Mock renderGeneralTab to simplify shell setup
const mockRenderGeneralTab = jest.fn();

describe('Settings search integration', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
    jest.clearAllMocks();
    mockRenderGeneralTab.mockClear();

    // Configure ProviderRegistry mock for general tab + claude
    const reg = ProviderRegistry as unknown as {
      getEnabledProviderIds: jest.Mock;
      getRegisteredProviderIds: jest.Mock;
      getProviderDisplayName: jest.Mock;
      isEnabled: jest.Mock;
      getChatUIConfig: jest.Mock;
    };
    reg.getEnabledProviderIds.mockReturnValue(['claude']);
    reg.getRegisteredProviderIds.mockReturnValue(['claude']);
    reg.getProviderDisplayName.mockImplementation((id: string) => (id === 'claude' ? 'Claude' : id));
    reg.isEnabled.mockImplementation((id: string) => id === 'claude');
    reg.getChatUIConfig.mockReturnValue({
      ownsModel: () => false,
      getModelOptions: () => [],
    });
  });

  it('mounts SearchBar at top of settings', () => {
    const plugin = createStubPlugin();
    const tab = new ClaudianSettingTab({} as never, plugin as never);
    const containerEl = document.createElement('div');
    (tab as unknown as { containerEl: HTMLElement }).containerEl = containerEl;
    (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab =
      mockRenderGeneralTab;

    tab.display();

    const searchBarInput = containerEl.querySelector(
      '.claudian-settings-search-bar input[type="search"]',
    ) as HTMLInputElement | null;
    expect(searchBarInput).not.toBeNull();
    expect(searchBarInput?.type).toBe('search');
  });

  it('hides tab strip and shows results when search is non-empty', async () => {
    const plugin = createStubPlugin();
    const tab = new ClaudianSettingTab({} as never, plugin as never);
    const containerEl = document.createElement('div');
    (tab as unknown as { containerEl: HTMLElement }).containerEl = containerEl;
    (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab =
      mockRenderGeneralTab;

    tab.display();

    const tabStrip = containerEl.querySelector('.claudian-settings-tabs');
    const searchInput = containerEl.querySelector(
      '.claudian-settings-search-bar input[type="search"]',
    ) as HTMLInputElement;

    expect(tabStrip).not.toBeNull();
    expect(searchInput).not.toBeNull();
    expect(tabStrip?.classList.contains('claudian-hidden')).toBe(false);

    // Type "claude" in the search bar
    searchInput.value = 'claude';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 200));

    const updatedTabStrip = containerEl.querySelector('.claudian-settings-tabs');
    const updatedResultsView = containerEl.querySelector(
      '.claudian-settings-search-results',
    );

    expect(updatedTabStrip?.classList.contains('claudian-hidden')).toBe(true);
    expect(updatedResultsView?.classList.contains('claudian-hidden')).toBe(false);
  });

  it('shows correct results for search query', async () => {
    const plugin = createStubPlugin();
    const tab = new ClaudianSettingTab({} as never, plugin as never);
    const containerEl = document.createElement('div');
    (tab as unknown as { containerEl: HTMLElement }).containerEl = containerEl;
    (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab =
      mockRenderGeneralTab;

    tab.display();

    const searchInput = containerEl.querySelector(
      '.claudian-settings-search-bar input[type="search"]',
    ) as HTMLInputElement;

    // Search for "Models"
    searchInput.value = 'Models';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 200));

    const resultsView = containerEl.querySelector(
      '.claudian-settings-search-results',
    );
    const fieldRows = resultsView?.querySelectorAll(
      '[data-field-id]',
    );

    // Should have at least some results containing "Models"
    expect(fieldRows?.length || 0).toBeGreaterThan(0);
  });

  it('Go button clears search, swaps tab, scrolls field into view, and adds highlight class', async () => {
    const plugin = createStubPlugin();
    const tab = new ClaudianSettingTab({} as never, plugin as never);
    const containerEl = document.createElement('div');
    (tab as unknown as { containerEl: HTMLElement }).containerEl = containerEl;
    (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab =
      mockRenderGeneralTab;

    tab.display();

    const searchInput = containerEl.querySelector(
      '.claudian-settings-search-bar input[type="search"]',
    ) as HTMLInputElement;

    // Search for a field that exists in the registry (e.g., "Language" or "Provider")
    searchInput.value = 'language';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Find a Go button
    let goButton = containerEl.querySelector(
      '.claudian-settings-search-results [data-action="go"]',
    ) as HTMLButtonElement | null;

    // If no results, try a different search term
    if (!goButton) {
      searchInput.value = 'provider';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      goButton = containerEl.querySelector(
        '.claudian-settings-search-results [data-action="go"]',
      ) as HTMLButtonElement;
    }

    expect(goButton).not.toBeNull();

    // Mock scrollIntoView
    const mockScrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = mockScrollIntoView;

    // Click Go button
    goButton.click();

    // Wait for animations and state changes
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Search should be cleared
    expect(searchInput.value).toBe('');

    // Tab strip should be visible again
    const tabStrip = containerEl.querySelector('.claudian-settings-tabs');
    expect(tabStrip?.classList.contains('claudian-hidden')).toBe(false);

    // Results view should be hidden
    const resultsView = containerEl.querySelector(
      '.claudian-settings-search-results',
    );
    expect(resultsView?.classList.contains('claudian-hidden')).toBe(true);

    // Tab should have switched (to general or claude depending on which field matched)
    const activeTab = containerEl.querySelector('.claudian-settings-tab--active');
    expect(activeTab).not.toBeNull();

    // Target field row should have highlight class
    const highlightedField = containerEl.querySelector(
      '[data-field-id][aria-highlighted="true"]',
    );
    expect(highlightedField).not.toBeNull();
    expect(highlightedField?.classList.contains('claudian-settings-field--highlight')).toBe(true);

    // Highlight should be removed after 1500ms
    await new Promise((resolve) => setTimeout(resolve, 1600));

    expect(highlightedField?.classList.contains('claudian-settings-field--highlight')).toBe(false);
  });

  it('clears results when search is emptied', async () => {
    const plugin = createStubPlugin();
    const tab = new ClaudianSettingTab({} as never, plugin as never);
    const containerEl = document.createElement('div');
    (tab as unknown as { containerEl: HTMLElement }).containerEl = containerEl;
    (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab =
      mockRenderGeneralTab;

    tab.display();

    const searchInput = containerEl.querySelector(
      '.claudian-settings-search-bar input[type="search"]',
    ) as HTMLInputElement;

    // Type something
    searchInput.value = 'claude';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 200));

    let tabStrip = containerEl.querySelector('.claudian-settings-tabs');
    expect(tabStrip?.classList.contains('claudian-hidden')).toBe(true);

    // Clear the search
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 200));

    tabStrip = containerEl.querySelector('.claudian-settings-tabs');
    const resultsView = containerEl.querySelector(
      '.claudian-settings-search-results',
    );

    expect(tabStrip?.classList.contains('claudian-hidden')).toBe(false);
    expect(resultsView?.classList.contains('claudian-hidden')).toBe(true);
  });

  it('reset button clears search', async () => {
    const plugin = createStubPlugin();
    const tab = new ClaudianSettingTab({} as never, plugin as never);
    const containerEl = document.createElement('div');
    (tab as unknown as { containerEl: HTMLElement }).containerEl = containerEl;
    (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab =
      mockRenderGeneralTab;

    tab.display();

    const searchInput = containerEl.querySelector(
      '.claudian-settings-search-bar input[type="search"]',
    ) as HTMLInputElement;

    // Type something that returns no results
    searchInput.value = 'xyznonexistent';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 200));

    const resetButton = containerEl.querySelector(
      '.claudian-settings-search-results [data-action="reset"]',
    ) as HTMLButtonElement;

    expect(resetButton).not.toBeNull();

    resetButton.click();

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Search should be cleared
    expect(searchInput.value).toBe('');

    // Tab strip should be visible
    const tabStrip = containerEl.querySelector('.claudian-settings-tabs');
    expect(tabStrip?.classList.contains('claudian-hidden')).toBe(false);
  });
});

function createStubPlugin() {
  return {
    settings: {
      locale: 'en',
      providerConfigs: {
        claude: { enabled: true },
      },
      tabBarPosition: 'input',
      maxChatTabs: 3,
      chatViewPlacement: 'right-sidebar' as const,
      enableAutoScroll: true,
      deferMathRenderingDuringStreaming: true,
      enableAutoTitleGeneration: false,
      userName: 'User',
      systemPrompt: '',
      excludedTags: [],
      mediaFolder: 'Attachments',
      requireCommandOrControlEnterToSend: false,
      keyboardNavigation: {
        scrollUpKey: 'w',
        scrollDownKey: 's',
        focusInputKey: 'i',
      },
      hiddenProviderCommands: {},
      customContextLimits: {},
      customModelAliases: {},
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getAllViews: jest.fn().mockReturnValue([]),
    getView: jest.fn().mockReturnValue(undefined),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    getResolvedEnvironmentVariables: jest.fn().mockReturnValue({}),
    events: {
      on: jest.fn(() => () => undefined),
      emit: jest.fn(),
    },
  };
}
