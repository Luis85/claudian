/**
 * @jest-environment jsdom
 */
import '../../setup/obsidianDom';

// The shared obsidianDom helper installs createDiv / createEl / empty.
// `ClaudianSettings.display()` additionally calls addClass / toggleClass /
// setText, so polyfill those here without disturbing the shared helper.
function installExtraObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.addClass !== 'function') {
    proto.addClass = function addClass(this: HTMLElement, cls: string): void {
      this.classList.add(cls);
    };
  }
  if (typeof proto.removeClass !== 'function') {
    proto.removeClass = function removeClass(this: HTMLElement, cls: string): void {
      this.classList.remove(cls);
    };
  }
  if (typeof proto.toggleClass !== 'function') {
    proto.toggleClass = function toggleClass(
      this: HTMLElement,
      cls: string,
      force?: boolean,
    ): void {
      if (force === undefined) {
        this.classList.toggle(cls);
      } else {
        this.classList.toggle(cls, force);
      }
    };
  }
  if (typeof proto.setText !== 'function') {
    proto.setText = function setText(this: HTMLElement, value: string): void {
      this.textContent = value;
    };
  }
}
installExtraObsidianDom();

// The legacy renderers we don't exercise in this integration; stub them so the
// shell can still call them for the tabs that aren't part of this port.
jest.mock('../../../src/features/settings/ui/AgentBoardSettingsSection', () => ({
  renderAgentBoardSettingsSection: jest.fn(),
}));
jest.mock('../../../src/features/settings/ui/OrchestratorSettingsTab', () => ({
  renderOrchestratorSettingsTab: jest.fn(),
}));
jest.mock('../../../src/features/settings/ui/QuickActionsSettingsTab', () => ({
  renderQuickActionsSettingsTab: jest.fn(),
}));
jest.mock('../../../src/features/settings/ui/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: jest.fn(),
}));
jest.mock('../../../src/features/settings/ui/LoggingSettingsSection', () => ({
  renderLoggingSettingsSection: jest.fn(),
}));
jest.mock('../../../src/features/settings/providerEnableUpdaters', () => ({
  getProviderEnableUpdater: jest.fn().mockReturnValue(undefined),
}));

// Pin the provider workspace registry to a no-op so provider tabs are skipped.
jest.mock('../../../src/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: {
    getSettingsTabRenderer: jest.fn().mockReturnValue(undefined),
  },
}));

// Pin enabled providers to empty so the only tabs are general/agentBoard/orchestrator.
jest.mock('../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getEnabledProviderIds: jest.fn().mockReturnValue([]),
    getRegisteredProviderIds: jest.fn().mockReturnValue([]),
    getProviderDisplayName: jest.fn().mockReturnValue(''),
    isEnabled: jest.fn().mockReturnValue(false),
    getChatUIConfig: jest.fn(),
  },
}));

import { ClaudianSettingTab } from '../../../src/features/settings/ClaudianSettings';
import {
  getSettingsRegistry,
  registerAllSettings,
} from '../../../src/features/settings/registry';
import { resetSettingsRegistryForTests } from '../../../src/features/settings/registry/registry';

interface StubPlugin {
  settings: Record<string, unknown>;
  saveSettings: jest.Mock;
  getAllViews: jest.Mock;
  getView: jest.Mock;
  getActiveEnvironmentVariables: jest.Mock;
}

function createStubPlugin(): StubPlugin {
  return {
    settings: {
      locale: 'en',
      providerConfigs: {},
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getAllViews: jest.fn().mockReturnValue([]),
    getView: jest.fn().mockReturnValue(undefined),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
  };
}

function createTab(plugin: StubPlugin): ClaudianSettingTab {
  const tab = new ClaudianSettingTab(
    {} as never,
    plugin as never,
  );
  (tab as unknown as { containerEl: HTMLElement }).containerEl = document.createElement('div');
  // The legacy `renderGeneralTab` private path is not the subject of this
  // suite; replace with a no-op so the general tab branch can fire without
  // dragging in the Setting / Slider / Hotkey machinery.
  (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab = jest.fn();
  return tab;
}

describe('agentBoard tab port (integration)', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('renders every registered agentBoard field and section through the registry', () => {
    const plugin = createStubPlugin();
    const tab = createTab(plugin);

    tab.display();

    // Initialize the registry so we can introspect the declared sections/fields.
    // The shell already called `registerAllSettings()` via the lazy-init guard.
    const registry = getSettingsRegistry();

    // Defensive: if for some reason the shell did not init it (no tab in
    // REGISTRY_TABS), call it ourselves so the assertions are meaningful.
    if (registry.getAllFields().length === 0) {
      registerAllSettings();
    }

    const containerEl = (tab as unknown as { containerEl: HTMLElement }).containerEl;
    // Tab content order matches the shell's tabIds = [general, agentBoard, orchestrator, ...providers].
    const tabContents = containerEl.querySelectorAll('.claudian-settings-tab-content');
    const tabContent = tabContents[1] as HTMLElement | undefined;
    expect(tabContent).toBeDefined();

    const fields = registry.getAllFields().filter((f) => f.tabId === 'agentBoard');
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const row = tabContent!.querySelector(
        `[data-field-id="${field.id}"]`,
      );
      expect(row).not.toBeNull();
    }

    const sectionIds = Array.from(
      tabContent!.querySelectorAll('[data-section-id]'),
    ).map((el) => (el as HTMLElement).dataset.sectionId);
    const declaredSectionIds = registry
      .getSections('agentBoard', plugin.settings as never)
      .map((s) => s.id);
    expect(declaredSectionIds.length).toBeGreaterThan(0);
    for (const declared of declaredSectionIds) {
      expect(sectionIds).toContain(declared);
    }
  });
});
