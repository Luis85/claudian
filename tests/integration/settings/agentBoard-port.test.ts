/**
 * @jest-environment jsdom
 */
import '../../setup/obsidianDom';

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

jest.mock('../../../src/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: {
    getSettingsTabRenderer: jest.fn().mockReturnValue(undefined),
  },
}));

jest.mock('../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getEnabledProviderIds: jest.fn().mockReturnValue([]),
    getRegisteredProviderIds: jest.fn().mockReturnValue([]),
    getProviderDisplayName: jest.fn().mockReturnValue(''),
    isEnabled: jest.fn().mockReturnValue(false),
    getChatUIConfig: jest.fn(),
  },
}));

import { resetSettingsRegistryForTests } from '../../../src/features/settings/registry/registry';
import { assertTabRendersRegistry, mountSettingsShell } from './_portTestHelpers';

describe('agentBoard tab port (integration)', () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
  });

  it('renders every registered agentBoard field and section through the registry', () => {
    const { plugin, tabContent } = mountSettingsShell({
      tabId: 'agentBoard',
      tabContentIndex: 1,
    });
    assertTabRendersRegistry(tabContent, plugin, 'agentBoard');
  });
});
