import '@/providers';

import { Notice } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import {
  createTab,
  getBlankTabModelOptions,
  getTabTitle,
  initializeTabUI,
  resolveBlankTabDefaultProviderId,
} from '@/features/chat/tabs/Tab';
import {
  DEFAULT_CODEX_PRIMARY_MODEL,
  DEFAULT_CODEX_PRIMARY_MODEL_LABEL,
} from '@/providers/codex/types/models';

import {
  createMockBrowserSelectionController,
  createMockCanvasSelectionController,
  createMockSpecoratorService,
  createMockContextUsageMeter,
  createMockExternalContextSelector,
  createMockFileContextManager,
  createMockImageContextManager,
  createMockInputController,
  createMockInstructionModeManager,
  createMockMcpServerSelector,
  createMockModelSelector,
  createMockModeSelector,
  createMockOptions,
  createMockPermissionToggle,
  createMockPlugin,
  createMockSelectionController,
  createMockServiceTierToggle,
  createMockSlashCommandDropdown,
  createMockStatusPanel,
  createMockThinkingBudgetSelector,
  installMockResizeObserver,
} from './tabTestKit';

installMockResizeObserver();

// Mock provider runtime used by ProviderRegistry
jest.mock('@/providers/claude/runtime/ClaudeChatRuntime', () => ({
  SpecoratorService: jest.fn().mockImplementation(() => ({
    ensureReady: jest.fn().mockResolvedValue(true),
    cleanup: jest.fn(),
    isReady: jest.fn().mockReturnValue(false),
    syncConversationState: jest.fn(),
    onReadyStateChange: jest.fn((listener: (ready: boolean) => void) => {
      listener(false);
      return () => {};
    }),
  })),
}));

// Shared mock instances (reset in beforeEach)
let mockFileContextManager: ReturnType<typeof createMockFileContextManager>;
let mockImageContextManager: ReturnType<typeof createMockImageContextManager>;
let mockSlashCommandDropdown: ReturnType<typeof createMockSlashCommandDropdown>;
let mockInstructionModeManager: ReturnType<typeof createMockInstructionModeManager>;
let mockStatusPanel: ReturnType<typeof createMockStatusPanel>;
let mockModelSelector: ReturnType<typeof createMockModelSelector>;
let mockModeSelector: ReturnType<typeof createMockModeSelector>;
let mockThinkingBudgetSelector: ReturnType<typeof createMockThinkingBudgetSelector>;
let mockContextUsageMeter: ReturnType<typeof createMockContextUsageMeter>;
let mockExternalContextSelector: ReturnType<typeof createMockExternalContextSelector>;
let mockMcpServerSelector: ReturnType<typeof createMockMcpServerSelector>;
let mockPermissionToggle: ReturnType<typeof createMockPermissionToggle>;
let mockServiceTierToggle: ReturnType<typeof createMockServiceTierToggle>;
let mockMessageRenderer: { scrollToBottomIfNeeded: jest.Mock; setAsyncSubagentClickCallback: jest.Mock };
let mockSelectionController: ReturnType<typeof createMockSelectionController>;
let mockBrowserSelectionController: ReturnType<typeof createMockBrowserSelectionController>;
let mockCanvasSelectionController: ReturnType<typeof createMockCanvasSelectionController>;
let mockStreamController: { onAsyncSubagentStateChange: jest.Mock };
let mockConversationController: { save: jest.Mock; rewind: jest.Mock };
let mockInputController: ReturnType<typeof createMockInputController>;
let mockNavigationController: { initialize: jest.Mock; dispose: jest.Mock };

jest.mock('@/features/chat/ui/FileContext', () => ({
  FileContextManager: jest.fn().mockImplementation(() => {
    mockFileContextManager = createMockFileContextManager();
    return mockFileContextManager;
  }),
}));

jest.mock('@/features/chat/ui/ImageContext', () => ({
  ImageContextManager: jest.fn().mockImplementation(() => {
    mockImageContextManager = createMockImageContextManager();
    return mockImageContextManager;
  }),
}));

jest.mock('@/features/chat/ui/InstructionModeManager', () => ({
  InstructionModeManager: jest.fn().mockImplementation(() => {
    mockInstructionModeManager = createMockInstructionModeManager();
    return mockInstructionModeManager;
  }),
}));

jest.mock('@/features/chat/ui/StatusPanel', () => ({
  StatusPanel: jest.fn().mockImplementation(() => {
    mockStatusPanel = createMockStatusPanel();
    return mockStatusPanel;
  }),
}));

jest.mock('@/features/chat/ui/InputToolbar', () => ({
  createInputToolbar: jest.fn().mockImplementation(() => {
    mockModelSelector = createMockModelSelector();
    mockModeSelector = createMockModeSelector();
    mockThinkingBudgetSelector = createMockThinkingBudgetSelector();
    mockContextUsageMeter = createMockContextUsageMeter();
    mockExternalContextSelector = createMockExternalContextSelector();
    mockMcpServerSelector = createMockMcpServerSelector();
    mockPermissionToggle = createMockPermissionToggle();
    mockServiceTierToggle = createMockServiceTierToggle();
    return {
      modelSelector: mockModelSelector,
      modeSelector: mockModeSelector,
      thinkingBudgetSelector: mockThinkingBudgetSelector,
      contextUsageMeter: mockContextUsageMeter,
      externalContextSelector: mockExternalContextSelector,
      mcpServerSelector: mockMcpServerSelector,
      permissionToggle: mockPermissionToggle,
      serviceTierToggle: mockServiceTierToggle,
      gitActionButton: null,
    };
  }),
}));

jest.mock('@/shared/components/SlashCommandDropdown', () => ({
  SlashCommandDropdown: jest.fn().mockImplementation(() => {
    mockSlashCommandDropdown = createMockSlashCommandDropdown();
    return mockSlashCommandDropdown;
  }),
}));

// Mock rendering
jest.mock('@/features/chat/rendering/MessageRenderer', () => ({
  MessageRenderer: jest.fn().mockImplementation(() => {
    mockMessageRenderer = {
      scrollToBottomIfNeeded: jest.fn(),
      setAsyncSubagentClickCallback: jest.fn(),
    };
    return mockMessageRenderer;
  }),
}));

jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  cleanupThinkingBlock: jest.fn(),
}));

// Mock controllers
jest.mock('@/features/chat/controllers/SelectionController', () => ({
  SelectionController: jest.fn().mockImplementation(() => {
    mockSelectionController = createMockSelectionController();
    return mockSelectionController;
  }),
}));

jest.mock('@/features/chat/controllers/BrowserSelectionController', () => ({
  BrowserSelectionController: jest.fn().mockImplementation(() => {
    mockBrowserSelectionController = createMockBrowserSelectionController();
    return mockBrowserSelectionController;
  }),
}));

jest.mock('@/features/chat/controllers/CanvasSelectionController', () => ({
  CanvasSelectionController: jest.fn().mockImplementation(() => {
    mockCanvasSelectionController = createMockCanvasSelectionController();
    return mockCanvasSelectionController;
  }),
}));

jest.mock('@/features/chat/controllers/StreamController', () => ({
  StreamController: jest.fn().mockImplementation(() => {
    mockStreamController = { onAsyncSubagentStateChange: jest.fn() };
    return mockStreamController;
  }),
}));

jest.mock('@/features/chat/controllers/ConversationController', () => ({
  ConversationController: jest.fn().mockImplementation(() => {
    mockConversationController = {
      save: jest.fn().mockResolvedValue(undefined),
      rewind: jest.fn().mockResolvedValue(undefined),
    };
    return mockConversationController;
  }),
}));

jest.mock('@/features/chat/controllers/InputController', () => ({
  InputController: jest.fn().mockImplementation(() => {
    mockInputController = createMockInputController();
    return mockInputController;
  }),
}));

jest.mock('@/features/chat/controllers/NavigationController', () => ({
  NavigationController: jest.fn().mockImplementation(() => {
    mockNavigationController = { initialize: jest.fn(), dispose: jest.fn() };
    return mockNavigationController;
  }),
}));

// Mock services
jest.mock('@/features/chat/services/SubagentManager', () => ({
  SubagentManager: jest.fn().mockImplementation(() => ({
    orphanAllActive: jest.fn(),
    setCallback: jest.fn(),
    clear: jest.fn(),
  })),
}));

jest.mock('@/providers/claude/auxiliary/ClaudeInstructionRefineService', () => ({
  InstructionRefineService: jest.fn().mockImplementation(() => ({
    cancel: jest.fn(),
    resetConversation: jest.fn(),
  })),
}));

jest.mock('@/providers/claude/auxiliary/ClaudeTitleGenerationService', () => ({
  TitleGenerationService: jest.fn().mockImplementation(() => ({
    cancel: jest.fn(),
  })),
}));

// Mock path util
jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

describe('resolveBlankTabDefaultProviderId', () => {
  it('honors an enabled settingsProvider', () => {
    expect(resolveBlankTabDefaultProviderId({
      settingsProvider: 'codex',
      providerConfigs: { codex: { enabled: true } },
    })).toBe('codex');
  });

  it('ignores a disabled settingsProvider and uses the first enabled provider by order', () => {
    expect(resolveBlankTabDefaultProviderId({
      settingsProvider: 'codex',
      providerConfigs: {
        claude: { enabled: false },
        codex: { enabled: false },
        cursor: { enabled: true },
      },
    })).toBe('cursor');
  });

  it('falls back to the first enabled provider when settingsProvider is absent', () => {
    expect(resolveBlankTabDefaultProviderId({
      providerConfigs: {
        claude: { enabled: false },
        codex: { enabled: true },
      },
    })).toBe('codex');
  });

  it('returns Claude when only Claude is enabled', () => {
    expect(resolveBlankTabDefaultProviderId({})).toBe('claude');
  });
});


describe('Tab - Title', () => {
  describe('getTabTitle', () => {
    it('should return "New Chat" for tab without conversation', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      const title = getTabTitle(tab, options.plugin);

      expect(title).toBe('New Chat');
    });

    it('should return conversation title when available', () => {
      const plugin = createMockPlugin({
        getConversationSync: jest.fn().mockReturnValue({
          id: 'conv-123',
          title: 'My Conversation',
        }),
      });

      const options = createMockOptions({ plugin });
      const tab = createTab(options);
      tab.conversationId = 'conv-123';

      const title = getTabTitle(tab, plugin);

      expect(title).toBe('My Conversation');
    });

    it('should return "New Chat" when conversation has no title', () => {
      const plugin = createMockPlugin({
        getConversationSync: jest.fn().mockReturnValue({
          id: 'conv-123',
          title: null,
        }),
      });

      const options = createMockOptions({ plugin });
      const tab = createTab(options);
      tab.conversationId = 'conv-123';

      const title = getTabTitle(tab, plugin);

      expect(title).toBe('New Chat');
    });
  });
});


describe('Tab - Blank Tab Model Selector', () => {
  afterEach(() => {
    ProviderWorkspaceRegistry.clear();
    jest.restoreAllMocks();
  });

  it('returns Claude-only models when Codex is disabled', () => {
    const claudeModels = [
      { value: 'haiku', label: 'Haiku' },
      { value: 'sonnet', label: 'Sonnet' },
    ];
    jest.spyOn(ProviderRegistry, 'getEnabledProviderIds').mockReturnValue(['claude']);
    jest.spyOn(ProviderRegistry, 'getProviderDisplayName').mockImplementation((providerId) => (
      providerId === 'claude' ? 'Claude' : 'Codex'
    ));
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockImplementation((providerId?: string) => ({
      getModelOptions: () => providerId === 'claude' ? claudeModels : [],
      getProviderIcon: jest.fn().mockReturnValue(null),
    } as any));

    const result = getBlankTabModelOptions({ codexEnabled: false });
    expect(result).toEqual(claudeModels.map(m => ({ ...m, group: 'Claude' })));
  });

  it('returns Claude + Codex models when Codex is enabled', () => {
    const claudeModels = [
      { value: 'haiku', label: 'Haiku' },
      { value: 'sonnet', label: 'Sonnet' },
    ];
    const codexModels = [
      { value: DEFAULT_CODEX_PRIMARY_MODEL, label: DEFAULT_CODEX_PRIMARY_MODEL_LABEL },
    ];

    jest.spyOn(ProviderRegistry, 'getEnabledProviderIds').mockReturnValue(['codex', 'claude']);
    jest.spyOn(ProviderRegistry, 'getProviderDisplayName').mockImplementation((providerId) => (
      providerId === 'codex' ? 'Codex' : 'Claude'
    ));
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockImplementation((providerId?: string) => ({
      getModelOptions: () => providerId === 'codex' ? codexModels : claudeModels,
      getProviderIcon: jest.fn().mockReturnValue(null),
    } as any));

    const result = getBlankTabModelOptions({ codexEnabled: true });
    expect(result).toEqual([
      ...codexModels.map(m => ({ ...m, group: 'Codex' })),
      ...claudeModels.map(m => ({ ...m, group: 'Claude' })),
    ]);
  });
});


describe('Tab - Cross-Provider Model Rejection', () => {
  it('rejects cross-provider model change on bound tab via toolbar onModelChange', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);

    // Simulate bound Claude tab
    tab.lifecycleState = 'bound_cold';
    tab.providerId = 'claude';
    tab.conversationId = 'conv-1';

    // Get the onModelChange callback from toolbar
    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];
    expect(toolbarCallbacks).toBeDefined();

    // Attempt cross-provider model change (Claude -> Codex)
    await toolbarCallbacks.onModelChange(DEFAULT_CODEX_PRIMARY_MODEL);

    // Should show a Notice rejecting it
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Cannot switch provider'));
    // Provider should remain Claude
    expect(tab.providerId).toBe('claude');
  });

  it('allows same-provider model change on bound tab', async () => {
    (Notice as unknown as jest.Mock).mockClear();
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({
      getModelOptions: jest.fn().mockReturnValue([]),
      ownsModel: jest.fn((model: string) => model.startsWith('gpt-') || /^o\d/.test(model)),
      isAdaptiveReasoningModel: jest.fn().mockReturnValue(false),
      getReasoningOptions: jest.fn().mockReturnValue([]),
      getDefaultReasoningValue: jest.fn().mockReturnValue('off'),
      getContextWindowSize: jest.fn().mockReturnValue(200000),
      isDefaultModel: jest.fn().mockReturnValue(false),
      applyModelDefaults: jest.fn(),
      normalizeModelVariant: jest.fn((model: string) => model),
      getCustomModelIds: jest.fn().mockReturnValue(new Set()),
    } as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);

    // Simulate bound Claude tab
    tab.lifecycleState = 'bound_cold';
    tab.providerId = 'claude';
    tab.conversationId = 'conv-1';

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    // Same-provider model change (Claude -> Claude)
    await toolbarCallbacks.onModelChange('opus');

    expect(Notice).not.toHaveBeenCalled();
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});


describe('Tab - Blank Tab Draft Model Change', () => {
  it('updates draft model and provider without creating runtime', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({
      getModelOptions: jest.fn().mockReturnValue([]),
      ownsModel: jest.fn((model: string) => model.startsWith('gpt-') || /^o\d/.test(model)),
      isAdaptiveReasoningModel: jest.fn().mockReturnValue(false),
      getReasoningOptions: jest.fn().mockReturnValue([]),
      getDefaultReasoningValue: jest.fn().mockReturnValue('off'),
      getContextWindowSize: jest.fn().mockReturnValue(200000),
      isDefaultModel: jest.fn().mockReturnValue(false),
      applyModelDefaults: jest.fn(),
      normalizeModelVariant: jest.fn((model: string) => model),
      getCustomModelIds: jest.fn().mockReturnValue(new Set()),
    } as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);

    expect(tab.lifecycleState).toBe('blank');
    expect(tab.service).toBeNull();

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    // Switch to Codex model on blank tab
    await toolbarCallbacks.onModelChange(DEFAULT_CODEX_PRIMARY_MODEL);

    expect(tab.draftModel).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
    expect(tab.providerId).toBe('codex');
    // No runtime should have been created
    expect(tab.service).toBeNull();
    expect(tab.serviceInitialized).toBe(false);
    expect(tab.lifecycleState).toBe('blank');
  });

  it('refreshes the service-tier toggle when the model changes on a blank tab', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({
      getModelOptions: jest.fn().mockReturnValue([]),
      ownsModel: jest.fn((model: string) => model.startsWith('gpt-') || /^o\d/.test(model)),
      isAdaptiveReasoningModel: jest.fn().mockReturnValue(false),
      getReasoningOptions: jest.fn().mockReturnValue([]),
      getDefaultReasoningValue: jest.fn().mockReturnValue('off'),
      getContextWindowSize: jest.fn().mockReturnValue(200000),
      isDefaultModel: jest.fn().mockReturnValue(false),
      applyModelDefaults: jest.fn(),
      normalizeModelVariant: jest.fn((model: string) => model),
      getCustomModelIds: jest.fn().mockReturnValue(new Set()),
    } as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    mockServiceTierToggle.updateDisplay.mockClear();

    await toolbarCallbacks.onModelChange(DEFAULT_CODEX_PRIMARY_MODEL);

    expect(mockServiceTierToggle.updateDisplay).toHaveBeenCalled();
  });

  it('awaits async provider warmup callbacks before resolving blank-tab provider changes', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    let releaseWarmup!: () => void;
    const onProviderChanged = jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
      releaseWarmup = resolve;
    }));
    initializeTabUI(tab, plugin, { onProviderChanged });

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    let settled = false;
    const changePromise = toolbarCallbacks.onModelChange('gpt-5.4')
      .then(() => { settled = true; });

    await Promise.resolve();
    await Promise.resolve();

    expect(onProviderChanged).toHaveBeenCalledWith('codex');
    expect(settled).toBe(false);

    releaseWarmup();
    await changePromise;

    expect(settled).toBe(true);
  });

  it('does not trigger provider warmup when a blank-tab model switch stays on OpenCode', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);
    jest.spyOn(ProviderRegistry, 'resolveProviderForModel').mockImplementation((model: string) => {
      if (model.startsWith('opencode:')) {
        return 'opencode';
      }
      if (model.startsWith('gpt-') || /^o\d/.test(model)) {
        return 'codex';
      }
      return 'claude';
    });

    const plugin = createMockPlugin();
    plugin.settings.providerConfigs = {
      opencode: {
        enabled: true,
      },
    };
    plugin.settings.savedProviderModel = {
      ...plugin.settings.savedProviderModel,
      opencode: 'opencode:openai/gpt-5',
    };

    const tab = createTab(createMockOptions({
      draftModel: 'opencode:openai/gpt-5',
      plugin,
    }));

    let releaseWarmup!: () => void;
    const onProviderChanged = jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
      releaseWarmup = resolve;
    }));
    initializeTabUI(tab, plugin, { onProviderChanged });

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    let settled = false;
    const changePromise = toolbarCallbacks.onModelChange('opencode:anthropic/claude-sonnet-4')
      .then(() => { settled = true; });

    await Promise.resolve();
    await Promise.resolve();

    expect(tab.providerId).toBe('opencode');
    expect(tab.draftModel).toBe('opencode:anthropic/claude-sonnet-4');
    expect(onProviderChanged).not.toHaveBeenCalled();

    await changePromise;
    expect(settled).toBe(true);

    if (releaseWarmup) {
      releaseWarmup();
    }
  });

  it('preserves the saved Codex fast preference when switching away and back', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

    const plugin = createMockPlugin();
    plugin.settings.settingsProvider = 'codex';
    plugin.settings.model = DEFAULT_CODEX_PRIMARY_MODEL;
    plugin.settings.effortLevel = 'medium';
    plugin.settings.serviceTier = 'fast';
    plugin.settings.savedProviderModel = {
      claude: 'claude-sonnet-4-5',
      codex: DEFAULT_CODEX_PRIMARY_MODEL,
    };
    plugin.settings.savedProviderEffort = {
      claude: 'high',
      codex: 'medium',
    };
    plugin.settings.savedProviderServiceTier = {
      claude: 'default',
      codex: 'fast',
    };
    plugin.settings.savedProviderThinkingBudget = {
      claude: 'low',
      codex: 'off',
    };

    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    await toolbarCallbacks.onModelChange('gpt-5.4-mini');
    expect(plugin.settings.savedProviderServiceTier.codex).toBe('fast');

    await toolbarCallbacks.onModelChange(DEFAULT_CODEX_PRIMARY_MODEL);
    expect(plugin.settings.savedProviderServiceTier.codex).toBe('fast');
  });

  it('swaps dropdown provider catalog on blank tab model change', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({
      getModelOptions: jest.fn().mockReturnValue([]),
      ownsModel: jest.fn((model: string) => model.startsWith('gpt-') || /^o\d/.test(model)),
      isAdaptiveReasoningModel: jest.fn().mockReturnValue(false),
      getReasoningOptions: jest.fn().mockReturnValue([]),
      getDefaultReasoningValue: jest.fn().mockReturnValue('off'),
      getContextWindowSize: jest.fn().mockReturnValue(200000),
      isDefaultModel: jest.fn().mockReturnValue(false),
      applyModelDefaults: jest.fn(),
      normalizeModelVariant: jest.fn((model: string) => model),
      getCustomModelIds: jest.fn().mockReturnValue(new Set()),
    } as any);

    const codexCatalog = {
      listDropdownEntries: jest.fn().mockResolvedValue([]),
      listVaultEntries: jest.fn(),
      saveVaultEntry: jest.fn(),
      deleteVaultEntry: jest.fn(),
      getDropdownConfig: jest.fn().mockReturnValue({
        triggerChars: ['/', '$'],
        builtInPrefix: '/',
        skillPrefix: '$',
        commandPrefix: '/',
      }),
      refresh: jest.fn(),
    };
    const managerGetEntries = jest.fn().mockResolvedValue([
      {
        id: 'codex-skill-analyze',
        providerId: 'codex',
        kind: 'skill',
        name: 'analyze',
        description: 'Analyze',
        content: 'Analyze code',
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '$',
        insertPrefix: '$',
      },
    ]);

    ProviderWorkspaceRegistry.setServices('codex', { commandCatalog: codexCatalog as any });

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin, {
      getProviderCatalogConfig: () => (
        tab.providerId === 'codex'
          ? {
            config: codexCatalog.getDropdownConfig(),
            getEntries: managerGetEntries,
          }
          : null
      ),
    });

    // Mock setProviderCatalog on the dropdown
    const setProviderCatalogSpy = jest.fn();
    tab.ui.slashCommandDropdown!.setProviderCatalog = setProviderCatalogSpy;

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    // Switch to Codex model → should swap catalog
    await toolbarCallbacks.onModelChange(DEFAULT_CODEX_PRIMARY_MODEL);

    expect(setProviderCatalogSpy).toHaveBeenCalledTimes(1);
    const [config, getEntries] = setProviderCatalogSpy.mock.calls[0];
    expect(config.triggerChars).toEqual(['/', '$']);
    expect(config.skillPrefix).toBe('$');
    expect(typeof getEntries).toBe('function');
    await getEntries();
    expect(managerGetEntries).toHaveBeenCalledTimes(1);
    expect(codexCatalog.listDropdownEntries).not.toHaveBeenCalled();
  });

  it('updates hidden commands on blank tab model change', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({
      getModelOptions: jest.fn().mockReturnValue([]),
      ownsModel: jest.fn((model: string) => model.startsWith('gpt-') || /^o\d/.test(model)),
      isAdaptiveReasoningModel: jest.fn().mockReturnValue(false),
      getReasoningOptions: jest.fn().mockReturnValue([]),
      getDefaultReasoningValue: jest.fn().mockReturnValue('off'),
      getContextWindowSize: jest.fn().mockReturnValue(200000),
      isDefaultModel: jest.fn().mockReturnValue(false),
      applyModelDefaults: jest.fn(),
      normalizeModelVariant: jest.fn((model: string) => model),
      getCustomModelIds: jest.fn().mockReturnValue(new Set()),
    } as any);

    const codexCatalog = {
      listDropdownEntries: jest.fn().mockResolvedValue([]),
      listVaultEntries: jest.fn(),
      saveVaultEntry: jest.fn(),
      deleteVaultEntry: jest.fn(),
      getDropdownConfig: jest.fn().mockReturnValue({
        providerId: 'codex',
        triggerChars: ['/', '$'],
        builtInPrefix: '/',
        skillPrefix: '$',
        commandPrefix: '/',
      }),
      refresh: jest.fn(),
    };

    ProviderWorkspaceRegistry.setServices('codex', { commandCatalog: codexCatalog as any });

    const plugin = createMockPlugin({
      settings: {
        excludedTags: [],
        model: 'claude-sonnet-4-5',
        thinkingBudget: 'low',
        effortLevel: 'high',
        permissionMode: 'yolo',
        keyboardNavigation: {
          scrollUpKey: 'k',
          scrollDownKey: 'j',
          focusInputKey: 'i',
        },
        persistentExternalContextPaths: [],
        settingsProvider: 'claude',
        codexEnabled: true,
        savedProviderModel: {
          claude: 'claude-sonnet-4-5',
          codex: DEFAULT_CODEX_PRIMARY_MODEL,
        },
        savedProviderEffort: {
          claude: 'high',
          codex: 'medium',
        },
        savedProviderThinkingBudget: {
          claude: 'low',
          codex: 'off',
        },
        hiddenProviderCommands: {
          claude: ['commit'],
          codex: ['analyze'],
        },
      },
    });
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);

    const setProviderCatalogSpy = jest.fn();
    const setHiddenCommandsSpy = jest.fn();
    tab.ui.slashCommandDropdown!.setProviderCatalog = setProviderCatalogSpy;
    tab.ui.slashCommandDropdown!.setHiddenCommands = setHiddenCommandsSpy;

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    await toolbarCallbacks.onModelChange(DEFAULT_CODEX_PRIMARY_MODEL);

    expect(setHiddenCommandsSpy).toHaveBeenCalledWith(new Set(['analyze']));
  });

  it('rebinds provider helper services and clears stale runtime on blank tab provider change', async () => {
    const createInstructionRefineServiceSpy = jest.spyOn(ProviderRegistry, 'createInstructionRefineService')
      .mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    const createTitleGenerationServiceSpy = jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);
    jest.spyOn(ProviderRegistry, 'getChatUIConfig').mockReturnValue({
      getModelOptions: jest.fn().mockReturnValue([]),
      ownsModel: jest.fn((model: string) => model.startsWith('gpt-') || /^o\d/.test(model)),
      isAdaptiveReasoningModel: jest.fn().mockReturnValue(false),
      getReasoningOptions: jest.fn().mockReturnValue([]),
      getDefaultReasoningValue: jest.fn().mockReturnValue('off'),
      getContextWindowSize: jest.fn().mockReturnValue(200000),
      isDefaultModel: jest.fn().mockReturnValue(false),
      applyModelDefaults: jest.fn(),
      normalizeModelVariant: jest.fn((model: string) => model),
      getCustomModelIds: jest.fn().mockReturnValue(new Set()),
    } as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);

    const staleService = createMockSpecoratorService({ providerId: 'codex' });
    tab.service = staleService as any;
    tab.serviceInitialized = false;

    const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
      createInputToolbar: jest.Mock;
    };
    const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

    const initialInstructionCalls = createInstructionRefineServiceSpy.mock.calls.length;
    const initialTitleCalls = createTitleGenerationServiceSpy.mock.calls.length;

    await toolbarCallbacks.onModelChange(DEFAULT_CODEX_PRIMARY_MODEL);
    await toolbarCallbacks.onModelChange('opus');

    expect(staleService.cleanup).toHaveBeenCalledTimes(1);
    expect(tab.service).toBeNull();
    expect(tab.serviceInitialized).toBe(false);
    expect(tab.providerId).toBe('claude');
    expect(createInstructionRefineServiceSpy.mock.calls.length).toBeGreaterThan(initialInstructionCalls);
    expect(createTitleGenerationServiceSpy.mock.calls.length).toBe(initialTitleCalls);
  });
});

