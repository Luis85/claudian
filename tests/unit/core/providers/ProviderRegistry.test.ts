import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderId,
  TitleGenerationCallback,
  TitleGenerationResult,
  TitleGenerationService,
} from '@/core/providers/types';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';

describe('ProviderRegistry', () => {
  beforeEach(() => {
    ProviderWorkspaceRegistry.clear();
    ProviderWorkspaceRegistry.setServices('claude', {
      mcpManager: {} as any,
      mcpServerManager: {} as any,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a runtime with the default provider id', () => {
    const runtime = ProviderRegistry.createChatRuntime({
      plugin: {} as any,
    });

    expect(runtime.providerId).toBe('claude');
  });

  it('returns capabilities for the default provider', () => {
    const caps = ProviderRegistry.getCapabilities();
    expect(caps.providerId).toBe('claude');
    expect(caps).toHaveProperty('supportsPlanMode');
    expect(caps).toHaveProperty('supportsFork');
  });

  it('returns boundary services for the default provider', () => {
    const historyService = ProviderRegistry.getConversationHistoryService();
    expect(historyService).toHaveProperty('hydrateConversationHistory');

    const taskInterpreter = ProviderRegistry.getTaskResultInterpreter();
    expect(taskInterpreter).toHaveProperty('resolveTerminalStatus');
  });

  it('returns a settings reconciler for the default provider', () => {
    const reconciler = ProviderRegistry.getSettingsReconciler();
    expect(reconciler).toHaveProperty('reconcileModelWithEnvironment');
    expect(reconciler).toHaveProperty('normalizeModelVariantSettings');
  });

  it('returns a chat UI config for the default provider', () => {
    const uiConfig = ProviderRegistry.getChatUIConfig();
    expect(uiConfig).toHaveProperty('getModelOptions');
    expect(uiConfig).toHaveProperty('getCustomModelIds');
  });

  it('throws when an unknown provider is requested', () => {
    expect(() => ProviderRegistry.getCapabilities(
      'nonexistent' as any,
    )).toThrow('Provider "nonexistent" is not registered.');
  });

  it('creates a Codex runtime', () => {
    const runtime = ProviderRegistry.createChatRuntime({
      providerId: 'codex',
      plugin: {} as any,
    });
    expect(runtime.providerId).toBe('codex');
  });

  it('returns Codex capabilities', () => {
    const caps = ProviderRegistry.getCapabilities('codex');
    expect(caps.providerId).toBe('codex');
    expect(caps.supportsPlanMode).toBe(true);
    expect(caps.supportsFork).toBe(true);
    expect(caps.supportsInstructionMode).toBe(true);
    expect(caps.supportsRewind).toBe(false);
    expect(caps.reasoningControl).toBe('effort');
  });

  it('returns OpenCode capabilities', () => {
    const caps = ProviderRegistry.getCapabilities('opencode');
    expect(caps.providerId).toBe('opencode');
    expect(caps.supportsProviderCommands).toBe(true);
    expect(caps.supportsInstructionMode).toBe(true);
    expect(caps.supportsFork).toBe(false);
  });

  it('lists registered provider ids', () => {
    const ids = ProviderRegistry.getRegisteredProviderIds();
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
    expect(ids).toContain('cursor');
  });

  it('filters enabled provider ids using registration metadata', () => {
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: false },
      },
    })).toEqual(['claude']);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: true },
      },
    })).toEqual(['codex', 'claude']);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: true },
        opencode: { enabled: true },
        cursor: { enabled: true },
      },
    })).toEqual(['cursor', 'opencode', 'codex', 'claude']);
  });

  it('excludes Claude from enabled providers when claude.enabled is false', () => {
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: false },
      },
    })).toEqual([]);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: false },
        cursor: { enabled: true },
      },
    })).toEqual(['cursor']);
  });

  describe('resolveTitleGenerationProviderId', () => {
    it('returns Claude when Claude is enabled and no title model is set', () => {
      expect(ProviderRegistry.resolveTitleGenerationProviderId({
        providerConfigs: { claude: { enabled: true } },
      })).toBe('claude');
      expect(ProviderRegistry.resolveTitleGenerationProviderId({
        providerConfigs: { claude: { enabled: true }, codex: { enabled: true } },
      })).toBe('claude');
    });

    it('falls back to the active provider when Claude is disabled and no title model is set', () => {
      expect(ProviderRegistry.resolveTitleGenerationProviderId({
        providerConfigs: {
          claude: { enabled: false },
          cursor: { enabled: true },
        },
      })).toBe('cursor');
    });

    it('routes an explicit title model to its owning provider', () => {
      expect(ProviderRegistry.resolveTitleGenerationProviderId({
        titleGenerationModel: DEFAULT_CODEX_PRIMARY_MODEL,
        providerConfigs: { codex: { enabled: true } },
      })).toBe('codex');
    });
  });

  it('returns the display name from provider registration metadata', () => {
    expect(ProviderRegistry.getProviderDisplayName('claude')).toBe('Claude');
    expect(ProviderRegistry.getProviderDisplayName('codex')).toBe('Codex');
    expect(ProviderRegistry.getProviderDisplayName('cursor')).toBe('Cursor Agent');
  });

  it('creates a Cursor runtime', () => {
    const runtime = ProviderRegistry.createChatRuntime({
      providerId: 'cursor',
      plugin: {} as any,
    });
    expect(runtime.providerId).toBe('cursor');
  });

  it('returns Cursor capabilities', () => {
    const caps = ProviderRegistry.getCapabilities('cursor');
    expect(caps.providerId).toBe('cursor');
    expect(caps.supportsNativeHistory).toBe(true);
    expect(caps.supportsFork).toBe(false);
    expect(caps.supportsRewind).toBe(false);
  });

  it('routes auto title generation to Claude independently of chat provider state', async () => {
    const providerCalls: ProviderId[] = [];
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin: any, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        providerCalls.push(providerId);
        return createMockTitleService(providerId);
      });

    const service = ProviderRegistry.createTitleGenerationService({
      settings: {
        titleGenerationModel: '',
        providerConfigs: {
          claude: { enabled: true },
          codex: { enabled: true },
        },
      },
    } as any);
    const callback = jest.fn();

    await service.generateTitle('conv-1', 'hello', callback);

    expect(providerCalls).toEqual(['claude']);
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'claude title',
    });
  });

  it('routes explicit title model selections to the owning provider', async () => {
    const providerCalls: ProviderId[] = [];
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin: any, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        providerCalls.push(providerId);
        return createMockTitleService(providerId);
      });

    const service = ProviderRegistry.createTitleGenerationService({
      settings: {
        titleGenerationModel: DEFAULT_CODEX_PRIMARY_MODEL,
        providerConfigs: {
          codex: { enabled: true },
        },
      },
    } as any);
    const callback = jest.fn();

    await service.generateTitle('conv-1', 'hello', callback);

    expect(providerCalls).toEqual(['codex']);
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'codex title',
    });
  });

  it('suppresses stale callbacks when a newer title generation replaces the old one', async () => {
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    const claudeService = createDeferredTitleService();
    const codexService = createMockTitleService('codex');

    jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin: any, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        return providerId === 'claude' ? claudeService : codexService;
      });

    const plugin = {
      settings: {
        titleGenerationModel: 'sonnet',
        providerConfigs: {
          codex: { enabled: true },
        },
      },
    } as any;
    const service = ProviderRegistry.createTitleGenerationService(plugin);
    const callback = jest.fn();

    const first = service.generateTitle('conv-1', 'first', callback);
    plugin.settings.titleGenerationModel = DEFAULT_CODEX_PRIMARY_MODEL;
    await service.generateTitle('conv-1', 'second', callback);
    await claudeService.resolve({ success: true, title: 'stale title' });
    await first;

    expect(claudeService.cancel).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'codex title',
    });
  });
});

function createMockTitleService(providerId: ProviderId): TitleGenerationService {
  return {
    cancel: jest.fn(),
    generateTitle: jest.fn(async (conversationId, _userMessage, callback) => {
      await callback(conversationId, {
        success: true,
        title: `${providerId} title`,
      });
    }),
  };
}

function createDeferredTitleService(): TitleGenerationService & {
  resolve: (result: TitleGenerationResult) => Promise<void>;
} {
  let callback: TitleGenerationCallback | null = null;
  let conversationId = '';
  let resolvePromise: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    cancel: jest.fn(),
    generateTitle: jest.fn(async (nextConversationId, _userMessage, nextCallback) => {
      conversationId = nextConversationId;
      callback = nextCallback;
      await done;
    }),
    resolve: async (result) => {
      await callback?.(conversationId, result);
      resolvePromise?.();
    },
  };
}
