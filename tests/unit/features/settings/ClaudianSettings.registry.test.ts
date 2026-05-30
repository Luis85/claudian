/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

// The shared obsidianDom helper installs createDiv / createEl / empty.
// `ClaudianSettings.display()` additionally calls addClass / toggleClass /
// setText, so polyfill those here for this suite without disturbing the
// shared helper that other tests rely on.
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

// Stub the legacy renderer modules so they don't execute their imperative
// Setting/DOM machinery in jsdom — we are only verifying the per-tab branch
// behaviour of `display()`, not what each legacy renderer produces.
jest.mock('../../../../src/features/settings/ui/AgentBoardSettingsSection', () => ({
  renderAgentBoardSettingsSection: jest.fn(),
}));
jest.mock('../../../../src/features/settings/ui/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: jest.fn(),
}));
jest.mock('../../../../src/features/settings/ui/LoggingSettingsSection', () => ({
  renderLoggingSettingsSection: jest.fn(),
}));
jest.mock('../../../../src/features/settings/ui/OrchestratorSettingsTab', () => ({
  renderOrchestratorSettingsTab: jest.fn(),
}));
jest.mock('../../../../src/features/settings/ui/QuickActionsSettingsTab', () => ({
  renderQuickActionsSettingsTab: jest.fn(),
}));

// The legacy general-tab path inside `display()` still routes through the
// private `renderGeneralTab`; stub its remaining imperative collaborators so
// the legacy branch can run without exploding under jsdom.
jest.mock('../../../../src/features/settings/providerEnableUpdaters', () => ({
  getProviderEnableUpdater: jest.fn().mockReturnValue(undefined),
}));

// Stub the registry barrel so we can spy on `renderTab` and override
// `useRegistryRenderer` per test. Real `registerAllSettings` /
// `getSettingsRegistry` / `SettingsCtx` types remain available because we
// re-import them from the real module inside the factory.
const renderTabMock = jest.fn();
const useRegistryRendererMock = jest.fn<boolean, [string]>();
const registerAllSettingsMock = jest.fn();
const getSettingsRegistryMock = jest.fn();

jest.mock('../../../../src/features/settings/registry', () => ({
  __esModule: true,
  renderTab: (...args: unknown[]) => renderTabMock(...args),
  useRegistryRenderer: (tabId: string) => useRegistryRendererMock(tabId),
  registerAllSettings: () => registerAllSettingsMock(),
  getSettingsRegistry: () => getSettingsRegistryMock(),
}));

// ProviderWorkspaceRegistry's per-provider settings tab renderer call would
// require the full provider stack; stub it out so provider tabs are no-ops.
jest.mock('../../../../src/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: {
    getSettingsTabRenderer: jest.fn().mockReturnValue(undefined),
  },
}));

// Pin enabled providers + display names so the shell doesn't require a fully
// bootstrapped ProviderRegistry. The empty list keeps the tab id sequence to
// just ['general', 'agentBoard', 'orchestrator'].
jest.mock('../../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getEnabledProviderIds: jest.fn().mockReturnValue([]),
    getRegisteredProviderIds: jest.fn().mockReturnValue([]),
    getProviderDisplayName: jest.fn().mockReturnValue(''),
    isEnabled: jest.fn().mockReturnValue(false),
    getChatUIConfig: jest.fn(),
  },
}));

import { ClaudianSettingTab } from '../../../../src/features/settings/ClaudianSettings';

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
    } as Record<string, unknown>,
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getAllViews: jest.fn().mockReturnValue([]),
    getView: jest.fn().mockReturnValue(undefined),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
  };
}

function createTab(plugin: StubPlugin): ClaudianSettingTab {
  // The mocked `PluginSettingTab` base class never reads `app`; an empty
  // object is enough for the shell under test.
  const tab = new ClaudianSettingTab(
    {} as any,
    plugin as any,
  );
  (tab as unknown as { containerEl: HTMLElement }).containerEl = document.createElement('div');
  // The legacy `renderGeneralTab` private path is not the subject of this
  // suite (it's exercised by the imperative renderer's existing tests).
  // Replace it with a no-op so the legacy branch can fire without dragging in
  // the Setting / Slider / Hotkey machinery that ClaudianSettings.ts depends
  // on internally.
  (tab as unknown as { renderGeneralTab: (el: HTMLElement) => void }).renderGeneralTab = jest.fn();
  return tab;
}

beforeEach(() => {
  renderTabMock.mockClear();
  useRegistryRendererMock.mockReset();
  registerAllSettingsMock.mockReset();
  getSettingsRegistryMock.mockReset().mockReturnValue({} as unknown);
});

describe('ClaudianSettingTab.display() registry gate', () => {
  it('routes the general tab through renderTab when useRegistryRenderer returns true for it', () => {
    const plugin = createStubPlugin();
    const tab = createTab(plugin);

    useRegistryRendererMock.mockImplementation((tabId: string) => tabId === 'general');

    tab.display();

    const generalCalls = renderTabMock.mock.calls.filter((call) => call[1] === 'general');
    expect(generalCalls).toHaveLength(1);
    expect(generalCalls[0][0]).toBeInstanceOf(HTMLElement);
    expect(generalCalls[0][2]).toMatchObject({
      saveSettings: expect.any(Function),
      refresh: expect.any(Function),
    });

    const otherCalls = renderTabMock.mock.calls.filter((call) => call[1] !== 'general');
    expect(otherCalls).toHaveLength(0);

    // The lazy-init guard fired registerAllSettings exactly once because the
    // general tab opted in.
    expect(registerAllSettingsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps every tab on the legacy renderer when useRegistryRenderer returns false', () => {
    const plugin = createStubPlugin();
    const tab = createTab(plugin);

    useRegistryRendererMock.mockReturnValue(false);

    tab.display();

    expect(renderTabMock).not.toHaveBeenCalled();
    // No tab requires the registry, so the lazy-init guard skips registration.
    expect(registerAllSettingsMock).not.toHaveBeenCalled();
  });

  it('initializes the registry only once even when display() is called repeatedly', () => {
    const plugin = createStubPlugin();
    const tab = createTab(plugin);

    useRegistryRendererMock.mockImplementation((tabId: string) => tabId === 'general');

    tab.display();
    tab.display();
    tab.display();

    expect(registerAllSettingsMock).toHaveBeenCalledTimes(1);
    expect(renderTabMock).toHaveBeenCalledTimes(3);
  });

  it('routes the agentBoard tab through renderTab without firing the general branch', () => {
    const plugin = createStubPlugin();
    const tab = createTab(plugin);

    useRegistryRendererMock.mockImplementation((tabId: string) => tabId === 'agentBoard');

    tab.display();

    const agentBoardCalls = renderTabMock.mock.calls.filter((call) => call[1] === 'agentBoard');
    expect(agentBoardCalls).toHaveLength(1);

    const generalCalls = renderTabMock.mock.calls.filter((call) => call[1] === 'general');
    expect(generalCalls).toHaveLength(0);
  });
});
