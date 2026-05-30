/**
 * @jest-environment jsdom
 */
import '../../setup/obsidianDom';

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

jest.mock('../../../src/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: {
    getSettingsTabRenderer: jest.fn().mockReturnValue(undefined),
  },
}));

jest.mock('../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getEnabledProviderIds: jest.fn().mockReturnValue(['codex']),
    getRegisteredProviderIds: jest.fn().mockReturnValue(['codex']),
    getProviderDisplayName: jest.fn().mockImplementation((id: string) => id),
    isEnabled: jest.fn().mockReturnValue(true),
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
      providerConfigs: {
        codex: { enabled: true },
      },
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
  (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab = jest.fn();
  return tab;
}

describe('codex tab port (integration)', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('renders every registered codex field and section through the registry', () => {
    const plugin = createStubPlugin();
    const tab = createTab(plugin);

    tab.display();

    const registry = getSettingsRegistry();
    if (registry.getAllFields().length === 0) {
      registerAllSettings();
    }

    const containerEl = (tab as unknown as { containerEl: HTMLElement }).containerEl;
    // Tab content order matches shell's tabIds = [general, agentBoard, orchestrator, diagnostics, codex].
    const tabContents = containerEl.querySelectorAll('.claudian-settings-tab-content');
    const tabContent = tabContents[4] as HTMLElement | undefined;
    expect(tabContent).toBeDefined();

    const fields = registry.getAllFields().filter((f) => f.tabId === 'codex');
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      if (field.visible && !field.visible(plugin.settings as never)) continue;
      const row = tabContent!.querySelector(`[data-field-id="${field.id}"]`);
      expect(row).not.toBeNull();
    }

    const sectionIds = Array.from(
      tabContent!.querySelectorAll('[data-section-id]'),
    ).map((el) => (el as HTMLElement).dataset.sectionId);
    const declaredSectionIds = registry
      .getSections('codex', plugin.settings as never)
      .map((s) => s.id);
    expect(declaredSectionIds.length).toBeGreaterThan(0);
    for (const declared of declaredSectionIds) {
      expect(sectionIds).toContain(declared);
    }
  });
});
