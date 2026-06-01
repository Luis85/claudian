import { EnvironmentApplyService } from '@/app/environment/EnvironmentApplyService';
import * as providerEnv from '@/core/providers/providerEnvironment';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ProviderId } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import type ClaudianPlugin from '@/main';

function createTab(overrides: Partial<{
  providerId: ProviderId;
  isStreaming: boolean;
  service: unknown;
  serviceInitialized: boolean;
  conversationId: string | null;
}> = {}) {
  return {
    providerId: overrides.providerId ?? 'claude',
    state: { isStreaming: overrides.isStreaming ?? false },
    service: overrides.service ?? {
      cleanup: jest.fn(),
      syncConversationState: jest.fn(),
      resetSession: jest.fn(),
      ensureReady: jest.fn().mockResolvedValue(undefined),
    },
    serviceInitialized: overrides.serviceInitialized ?? true,
    conversationId: overrides.conversationId ?? null,
    controllers: { inputController: { cancelStreaming: jest.fn() } },
    ui: { externalContextSelector: undefined },
  };
}

function createPlugin(overrides: Partial<{
  affectedTabs: ReturnType<typeof createTab>[];
  settings: Record<string, unknown>;
  reconcileResult: { changed: boolean; invalidatedConversations: Conversation[] };
}> = {}): ClaudianPlugin {
  const tabs = overrides.affectedTabs ?? [];
  const tabManager = {
    getAllTabs: jest.fn().mockReturnValue(tabs),
  };
  const view = {
    getTabManager: jest.fn().mockReturnValue(tabManager),
    invalidateProviderCommandCaches: jest.fn(),
    refreshModelSelector: jest.fn(),
  };
  return {
    settings: overrides.settings ?? {},
    getView: jest.fn().mockReturnValue(view),
    getAllViews: jest.fn().mockReturnValue([view]),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    storage: {
      sessions: {
        saveMetadata: jest.fn().mockResolvedValue(undefined),
        toSessionMetadata: jest.fn((c: Conversation) => c),
      },
    },
    conversationStore: { getConversations: () => [] },
    getConversationSync: jest.fn().mockReturnValue(null),
  } as unknown as ClaudianPlugin;
}

describe('EnvironmentApplyService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('short-circuits when no scope value changed', async () => {
    jest.spyOn(providerEnv, 'getEnvironmentVariablesForScope').mockReturnValue('X=1');
    const plugin = createPlugin();
    const service = new EnvironmentApplyService(plugin);

    await service.applyBatch([{ scope: 'shared', envText: 'X=1' }]);

    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('expands shared scope to every registered provider', () => {
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue(['claude', 'codex']);
    const plugin = createPlugin();
    const service = new EnvironmentApplyService(plugin);

    const ids = service.affectedProvidersForTests(['shared']);

    expect(ids.sort()).toEqual(['claude', 'codex']);
  });

  it('narrows provider:<id> scope to that one provider when registered', () => {
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue(['claude', 'codex']);
    const plugin = createPlugin();
    const service = new EnvironmentApplyService(plugin);

    const ids = service.affectedProvidersForTests(['provider:codex']);
    expect(ids).toEqual(['codex']);
  });

  it('cancels streaming tabs before restarting them on change', async () => {
    jest.spyOn(providerEnv, 'getEnvironmentVariablesForScope').mockReturnValue('OLD');
    jest.spyOn(providerEnv, 'setEnvironmentVariablesForScope').mockImplementation(() => undefined);
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue(['claude']);
    jest.spyOn(ProviderSettingsCoordinator, 'handleEnvironmentChange' as any).mockImplementation(() => undefined);
    jest.spyOn(ProviderSettingsCoordinator, 'reconcileProviders' as any).mockReturnValue({
      changed: true,
      invalidatedConversations: [],
    });

    const streamingTab = createTab({ isStreaming: true });
    const plugin = createPlugin({ affectedTabs: [streamingTab] });
    const service = new EnvironmentApplyService(plugin);

    await service.apply('shared', 'NEW');

    expect(streamingTab.controllers.inputController.cancelStreaming).toHaveBeenCalled();
    expect((streamingTab.service as { resetSession: jest.Mock }).resetSession).toHaveBeenCalled();
    expect((streamingTab.service as { ensureReady: jest.Mock }).ensureReady).toHaveBeenCalled();
  });
});
