import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { ChatState } from '@/features/chat/state/ChatState';
import {
  activateTab,
  createTab,
  deactivateTab,
  destroyTab,
  initializeTabControllers,
  initializeTabService,
  initializeTabUI,
  onProviderAvailabilityChanged,
} from '@/features/chat/tabs/Tab';
import {
  DEFAULT_CODEX_PRIMARY_MODEL,
} from '@/providers/codex/types/models';

import {
  createMockBrowserSelectionController,
  createMockCanvasSelectionController,
  createMockClaudianService,
  createMockContextUsageMeter,
  createMockExternalContextSelector,
  createMockFileContextManager,
  createMockImageContextManager,
  createMockInputController,
  createMockInstructionModeManager,
  createMockMcpManager,
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
  ClaudianService: jest.fn().mockImplementation(() => ({
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

describe('Tab - Creation', () => {
  describe('createTab', () => {
    it('should create a new tab with unique ID', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      expect(tab.id).toBeDefined();
      expect(tab.id).toMatch(/^tab-/);
    });

    it('should use provided tab ID when specified', () => {
      const options = createMockOptions({ tabId: 'custom-tab-id' });
      const tab = createTab(options);

      expect(tab.id).toBe('custom-tab-id');
    });

    it('should initialize with null conversationId when no conversation provided', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      expect(tab.conversationId).toBeNull();
    });

    it('should set conversationId when conversation is provided', () => {
      const options = createMockOptions({
        conversation: {
          id: 'conv-123',
          providerId: 'claude',
          title: 'Test Conversation',
          messages: [],
          sessionId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      const tab = createTab(options);

      expect(tab.conversationId).toBe('conv-123');
    });

    it('should create tab with lazy-initialized service (null)', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      expect(tab.service).toBeNull();
      expect(tab.serviceInitialized).toBe(false);
    });

    it('should create ChatState with callbacks', () => {
      const onStreamingChanged = jest.fn();
      const onAttentionChanged = jest.fn();
      const onConversationIdChanged = jest.fn();

      const options = createMockOptions({
        onStreamingChanged,
        onAttentionChanged,
        onConversationIdChanged,
      });
      const tab = createTab(options);

      expect(tab.state).toBeInstanceOf(ChatState);
    });

    it('should create DOM structure with hidden content', () => {
      const containerEl = createMockEl();
      const options = createMockOptions({ containerEl });
      const tab = createTab(options);

      expect(tab.dom.contentEl).toBeDefined();
      expect(tab.dom.contentEl.style.display).toBe('none');
      expect(tab.dom.messagesEl).toBeDefined();
      expect(tab.dom.inputEl).toBeDefined();
    });

    it('should initialize empty eventCleanups array', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      expect(tab.dom.eventCleanups).toEqual([]);
    });

    it('should initialize all controllers as null', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      expect(tab.controllers.selectionController).toBeNull();
      expect(tab.controllers.conversationController).toBeNull();
      expect(tab.controllers.streamController).toBeNull();
      expect(tab.controllers.inputController).toBeNull();
      expect(tab.controllers.navigationController).toBeNull();
    });

    it('should derive the blank-tab provider from the default draft model', () => {
      const plugin = createMockPlugin();
      plugin.settings.model = DEFAULT_CODEX_PRIMARY_MODEL;

      const tab = createTab(createMockOptions({ plugin }));

      expect(tab.lifecycleState).toBe('blank');
      expect(tab.draftModel).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(tab.providerId).toBe('codex');
    });

    it('should resolve draft model from defaultProviderId via projection', () => {
      const plugin = createMockPlugin();
      // Top-level model is Claude, but Codex has its own saved model
      plugin.settings.model = 'claude-sonnet-4-5';
      plugin.settings.settingsProvider = 'claude';
      plugin.settings.savedProviderModel = { claude: 'claude-sonnet-4-5', codex: DEFAULT_CODEX_PRIMARY_MODEL };

      const tab = createTab(createMockOptions({ plugin, defaultProviderId: 'codex' }));

      expect(tab.lifecycleState).toBe('blank');
      expect(tab.draftModel).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(tab.providerId).toBe('codex');
    });

    it('should resolve draft model for Claude when defaultProviderId is claude', () => {
      const plugin = createMockPlugin();
      // Simulate settings where top-level model drifted to a codex value
      plugin.settings.model = 'gpt-5.4-mini';
      plugin.settings.settingsProvider = 'claude';
      plugin.settings.savedProviderModel = { claude: 'opus', codex: 'gpt-5.4-mini' };

      const tab = createTab(createMockOptions({ plugin, defaultProviderId: 'claude' }));

      expect(tab.lifecycleState).toBe('blank');
      expect(tab.draftModel).toBe('opus');
      expect(tab.providerId).toBe('claude');
    });

    it('should fall back to settings.model when no defaultProviderId is given', () => {
      const plugin = createMockPlugin();
      plugin.settings.model = 'opus';

      const tab = createTab(createMockOptions({ plugin }));

      expect(tab.lifecycleState).toBe('blank');
      expect(tab.draftModel).toBe('opus');
      expect(tab.providerId).toBe('claude');
    });

    // Regression — Agent Board task-run tabs need pinnedModel to persist past
    // runtime init so the ModelSelector keeps showing the work-order model
    // and `getTabModelOverride` returns it on every turn (not just the first).
    it('should store pinnedModel when provided', () => {
      const plugin = createMockPlugin();
      const tab = createTab(createMockOptions({ plugin, pinnedModel: 'sonnet' }));

      expect(tab.pinnedModel).toBe('sonnet');
    });

    it('should normalize whitespace-only pinnedModel to null', () => {
      const plugin = createMockPlugin();
      const tab = createTab(createMockOptions({ plugin, pinnedModel: '   ' }));

      expect(tab.pinnedModel).toBeNull();
    });

    it('should default pinnedModel to null when not provided', () => {
      const plugin = createMockPlugin();
      const tab = createTab(createMockOptions({ plugin }));

      expect(tab.pinnedModel).toBeNull();
    });

    it('should keep a Claude custom gpt model on Claude when Codex is disabled', () => {
      const plugin = createMockPlugin();
      plugin.settings.settingsProvider = 'claude';
      plugin.settings.model = DEFAULT_CODEX_PRIMARY_MODEL;
      plugin.settings.providerConfigs = {
        claude: {
          environmentVariables: `ANTHROPIC_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}`,
        },
        codex: {
          enabled: false,
        },
      };

      const tab = createTab(createMockOptions({ plugin }));

      expect(tab.lifecycleState).toBe('blank');
      expect(tab.draftModel).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(tab.providerId).toBe('claude');
    });

    it('should fall back to an enabled provider when defaultProviderId is disabled', () => {
      const plugin = createMockPlugin();
      plugin.settings.settingsProvider = 'claude';
      plugin.settings.model = 'claude-sonnet-4-5';
      plugin.settings.providerConfigs = {
        claude: {},
        codex: {
          enabled: false,
        },
      };
      plugin.settings.savedProviderModel = {
        claude: 'opus',
        codex: DEFAULT_CODEX_PRIMARY_MODEL,
      };

      const tab = createTab(createMockOptions({ plugin, defaultProviderId: 'codex' }));

      expect(tab.lifecycleState).toBe('blank');
      expect(tab.draftModel).toBe('opus');
      expect(tab.providerId).toBe('claude');
    });
  });
});


describe('Tab - Service Initialization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initializeTabService', () => {
    it('should not reinitialize if already initialized', async () => {
      const options = createMockOptions();
      const tab = createTab(options);
      tab.serviceInitialized = true;
      tab.service = createMockClaudianService() as any;

      await initializeTabService(tab, options.plugin, options.mcpManager);

      // Service should not be replaced
      expect(tab.service).toEqual(expect.objectContaining({ providerId: 'claude' }));
    });

    it('should create ClaudianService on first initialization', async () => {
      const options = createMockOptions();
      const tab = createTab(options);

      await initializeTabService(tab, options.plugin, options.mcpManager);

      expect(tab.service).toBeDefined();
      expect(tab.serviceInitialized).toBe(true);
    });

    it('should create the runtime for the conversation provider', async () => {
      const createChatRuntimeSpy = jest.spyOn(ProviderRegistry, 'createChatRuntime');
      const mockRuntime = createMockClaudianService({ providerId: 'codex' });
      createChatRuntimeSpy.mockReturnValue(mockRuntime as any);

      const conversation = {
        id: 'conv-codex',
        providerId: 'codex' as const,
        title: 'Codex Conversation',
        messages: [],
        sessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const plugin = createMockPlugin({
        getConversationById: jest.fn().mockResolvedValue(conversation),
      });

      const tab = createTab(createMockOptions({
        plugin,
        conversation,
      }));

      await initializeTabService(tab, plugin, createMockMcpManager());

      expect(createChatRuntimeSpy).toHaveBeenCalledWith(expect.objectContaining({
        plugin,
        providerId: 'codex',
      }));
    });

    it('should recreate the runtime when the conversation provider changes', async () => {
      const createChatRuntimeSpy = jest.spyOn(ProviderRegistry, 'createChatRuntime');
      const oldService = createMockClaudianService({ providerId: 'claude' });
      const newService = createMockClaudianService({ providerId: 'codex' });
      createChatRuntimeSpy.mockReturnValue(newService as any);

      const conversation = {
        id: 'conv-codex',
        providerId: 'codex' as const,
        title: 'Codex Conversation',
        messages: [],
        sessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const plugin = createMockPlugin({
        getConversationById: jest.fn().mockResolvedValue(conversation),
      });

      const tab = createTab(createMockOptions({
        plugin,
        conversation,
      }));
      tab.service = oldService as any;
      tab.serviceInitialized = true;

      await initializeTabService(tab, plugin, createMockMcpManager());

      expect(oldService.cleanup).toHaveBeenCalled();
      expect(createChatRuntimeSpy).toHaveBeenCalledWith(expect.objectContaining({
        plugin,
        providerId: 'codex',
      }));
      expect(tab.service).toBe(newService);
    });

    it('awaits the outgoing runtime cleanup before constructing the replacement', async () => {
      const createChatRuntimeSpy = jest.spyOn(ProviderRegistry, 'createChatRuntime');
      const newService = createMockClaudianService({ providerId: 'codex' });
      createChatRuntimeSpy.mockReturnValue(newService as any);

      // Old runtime cleanup blocks on a deferred promise that resolves only when
      // we release it; the new runtime must not be constructed before then.
      let releaseCleanup!: () => void;
      const cleanupGate = new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      let cleanupResolved = false;
      const oldService = createMockClaudianService({ providerId: 'claude' });
      oldService.cleanup = jest.fn().mockReturnValue(
        cleanupGate.then(() => {
          cleanupResolved = true;
        }),
      ) as any;

      const conversation = {
        id: 'conv-codex-order',
        providerId: 'codex' as const,
        title: 'Codex Conversation',
        messages: [],
        sessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const plugin = createMockPlugin({
        getConversationById: jest.fn().mockResolvedValue(conversation),
      });
      const tab = createTab(createMockOptions({ plugin, conversation }));
      tab.service = oldService as any;
      tab.serviceInitialized = true;

      const initPromise = initializeTabService(tab, plugin, createMockMcpManager());

      // Let the synchronous prefix + the awaited getConversationById settle.
      await Promise.resolve();
      await Promise.resolve();

      expect(oldService.cleanup).toHaveBeenCalled();
      // Cleanup is still pending → the replacement runtime must not exist yet.
      expect(cleanupResolved).toBe(false);
      expect(createChatRuntimeSpy).not.toHaveBeenCalled();

      releaseCleanup();
      await initPromise;

      expect(cleanupResolved).toBe(true);
      expect(createChatRuntimeSpy).toHaveBeenCalledWith(expect.objectContaining({
        plugin,
        providerId: 'codex',
      }));
      expect(tab.service).toBe(newService);
    });

    it('awaits a fire-and-forget pending cleanup before constructing a replacement', async () => {
      const createChatRuntimeSpy = jest.spyOn(ProviderRegistry, 'createChatRuntime');
      const newService = createMockClaudianService({ providerId: 'claude' });
      createChatRuntimeSpy.mockReturnValue(newService as any);

      let releaseCleanup!: () => void;
      const cleanupGate = new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      let cleanupResolved = false;

      const plugin = createMockPlugin();
      const tab = createTab(createMockOptions({ plugin }));
      // Simulate a prior switch that detached a runtime and left its teardown
      // in flight (e.g. the new-conversation reset launched fire-and-forget).
      tab.pendingRuntimeCleanup = cleanupGate.then(() => {
        cleanupResolved = true;
      });

      const initPromise = initializeTabService(tab, plugin, createMockMcpManager());
      await Promise.resolve();
      await Promise.resolve();

      expect(cleanupResolved).toBe(false);
      expect(createChatRuntimeSpy).not.toHaveBeenCalled();

      releaseCleanup();
      await initPromise;

      expect(cleanupResolved).toBe(true);
      expect(createChatRuntimeSpy).toHaveBeenCalled();
    });

    it('should NOT call ensureReady for blank tabs (lazy start)', async () => {
      const mockEnsureReady = jest.fn().mockResolvedValue(true);
      const runtimeModule = jest.requireMock('@/providers/claude/runtime/ClaudeChatRuntime') as { ClaudianService: jest.Mock };
      runtimeModule.ClaudianService.mockImplementationOnce(() => createMockClaudianService({ ensureReady: mockEnsureReady }));

      const options = createMockOptions();
      const tab = createTab(options);

      await initializeTabService(tab, options.plugin, options.mcpManager);

      // Runtime starts on demand in query(), not during initialization
      expect(mockEnsureReady).not.toHaveBeenCalled();
      expect(tab.serviceInitialized).toBe(true);
      expect(tab.lifecycleState).toBe('bound_active');
    });

    it('should sync existing conversations with saved external contexts', async () => {
      const mockSyncConversationState = jest.fn();
      const runtimeModule = jest.requireMock('@/providers/claude/runtime/ClaudeChatRuntime') as { ClaudianService: jest.Mock };
      runtimeModule.ClaudianService.mockImplementationOnce(() => createMockClaudianService({
        syncConversationState: mockSyncConversationState,
      }));

      const conversation = {
        id: 'conv-1',
        providerId: 'claude' as const,
        title: 'Existing Conversation',
        messages: [{ id: 'msg-1', role: 'user' as const, content: 'test', timestamp: Date.now() }],
        sessionId: 'session-123',
        externalContextPaths: ['/saved/path'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const plugin = createMockPlugin();
      plugin.settings.persistentExternalContextPaths = ['/persistent/path'];
      plugin.getConversationById = jest.fn().mockResolvedValue(conversation);

      const options = createMockOptions({ plugin, conversation });
      const tab = createTab(options);

      await initializeTabService(tab, options.plugin, options.mcpManager);

      expect(mockSyncConversationState).toHaveBeenCalledWith(conversation, ['/saved/path']);
    });

    it('should initialize toolbar config for the tab provider', () => {
      const getChatUIConfigSpy = jest.spyOn(ProviderRegistry, 'getChatUIConfig');
      const getCapabilitiesSpy = jest.spyOn(ProviderRegistry, 'getCapabilities');
      jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);
      getChatUIConfigSpy.mockReturnValue({
        getModelOptions: jest.fn().mockReturnValue([]),
        ownsModel: jest.fn().mockReturnValue(false),
        isAdaptiveReasoningModel: jest.fn().mockReturnValue(false),
        getReasoningOptions: jest.fn().mockReturnValue([]),
        getDefaultReasoningValue: jest.fn().mockReturnValue('off'),
        getContextWindowSize: jest.fn().mockReturnValue(200000),
        isDefaultModel: jest.fn().mockReturnValue(true),
        applyModelDefaults: jest.fn(),
        normalizeModelVariant: jest.fn((model: string) => model),
        getCustomModelIds: jest.fn().mockReturnValue(new Set()),
      });
      getCapabilitiesSpy.mockReturnValue({
        providerId: 'codex',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: false,
        supportsRewind: false,
        supportsFork: false,
        supportsProviderCommands: false,
        supportsImageAttachments: true,
        supportsInstructionMode: false,
        supportsMcpTools: false,
        reasoningControl: 'none',
      });

      const options = createMockOptions({
        conversation: {
          id: 'conv-codex',
          providerId: 'codex',
          title: 'Codex Conversation',
          messages: [],
          sessionId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
        createInputToolbar: jest.Mock;
      };
      const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];
      expect(toolbarCallbacks).toBeDefined();

      toolbarCallbacks.getUIConfig();
      toolbarCallbacks.getCapabilities();

      expect(getChatUIConfigSpy).toHaveBeenCalledWith('codex');
      expect(getCapabilitiesSpy).toHaveBeenCalledWith('codex');
    });

    it('resolves the agent mention service through the provider-specific lookup', () => {
      jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

      const codexAgentMentionProvider = { searchAgents: jest.fn().mockReturnValue([]) };
      const getAgentMentionProviderSpy = jest.spyOn(ProviderWorkspaceRegistry, 'getAgentMentionProvider')
        .mockReturnValue(codexAgentMentionProvider as any);
      const plugin = createMockPlugin({
        codexAgentMentionProvider,
      });
      const tab = createTab(createMockOptions({
        plugin,
        conversation: {
          id: 'conv-codex-agent-split',
          providerId: 'codex',
          title: 'Codex agent split',
          messages: [],
          sessionId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }));

      initializeTabUI(tab, plugin);

      expect(getAgentMentionProviderSpy).toHaveBeenCalledWith('codex');
      expect(mockFileContextManager.setAgentService).toHaveBeenCalledWith(codexAgentMentionProvider);
    });

    it('falls back blank Codex draft to Claude when Codex is disabled', async () => {
      jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

      const plugin = createMockPlugin();
      const tab = createTab(createMockOptions({ plugin }));
      initializeTabUI(tab, plugin);

      // Simulate blank tab with Codex draft model
      tab.draftModel = DEFAULT_CODEX_PRIMARY_MODEL;
      tab.providerId = 'codex';
      tab.lifecycleState = 'blank';

      const staleService = createMockClaudianService({ providerId: 'codex' });
      tab.service = staleService as any;
      tab.serviceInitialized = true;

      // Disable Codex
      plugin.settings.codexEnabled = false;

      await onProviderAvailabilityChanged(tab, plugin);

      expect(staleService.cleanup).toHaveBeenCalled();
      expect(tab.providerId).toBe('claude');
      expect(tab.service).toBeNull();
      expect(tab.serviceInitialized).toBe(false);
      expect(mockSlashCommandDropdown.resetSdkSkillsCache).toHaveBeenCalled();
    });

    it('rebinds provider-scoped helper services when a newly enabled provider takes over the draft model', async () => {
      const createInstructionRefineServiceSpy = jest.spyOn(ProviderRegistry, 'createInstructionRefineService')
        .mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
      const createTitleGenerationServiceSpy = jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
        .mockReturnValue({ cancel: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

      const plugin = createMockPlugin();
      plugin.settings.settingsProvider = 'claude';
      plugin.settings.model = DEFAULT_CODEX_PRIMARY_MODEL;
      plugin.settings.providerConfigs = {
        claude: {
          environmentVariables: `ANTHROPIC_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}`,
        },
        codex: {
          enabled: false,
        },
      };

      const tab = createTab(createMockOptions({ plugin }));
      initializeTabUI(tab, plugin);

      expect(tab.draftModel).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(tab.providerId).toBe('claude');

      plugin.settings.providerConfigs = {
        ...plugin.settings.providerConfigs,
        codex: {
          enabled: true,
        },
      };

      await onProviderAvailabilityChanged(tab, plugin);

      expect(tab.providerId).toBe('codex');
      expect(createInstructionRefineServiceSpy).toHaveBeenLastCalledWith(plugin, 'codex');
      expect(createTitleGenerationServiceSpy).not.toHaveBeenCalledWith(plugin, 'codex');
    });

    it('surfaces provider-scoped model settings for inactive-provider tabs and saves back to that provider snapshot', async () => {
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
          providerConfigs: {
            claude: { enabled: true },
          },
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
        },
      });

      const tab = createTab(createMockOptions({
        plugin,
        conversation: {
          id: 'conv-codex-settings',
          providerId: 'codex',
          title: 'Codex conversation',
          messages: [],
          sessionId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }));

      initializeTabUI(tab, plugin);

      const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
        createInputToolbar: jest.Mock;
      };
      const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

      expect(toolbarCallbacks.getSettings()).toEqual(expect.objectContaining({
        model: DEFAULT_CODEX_PRIMARY_MODEL,
        effortLevel: 'medium',
      }));

      await toolbarCallbacks.onModelChange(DEFAULT_CODEX_PRIMARY_MODEL);

      expect(plugin.settings.model).toBe('claude-sonnet-4-5');
      expect(plugin.settings.savedProviderModel).toEqual(expect.objectContaining({
        claude: 'claude-sonnet-4-5',
        codex: DEFAULT_CODEX_PRIMARY_MODEL,
      }));
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('maps shared permission mode selections onto managed OpenCode modes', async () => {
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
          providerConfigs: {
            claude: { enabled: true },
            opencode: {
              availableModes: [
                { id: 'claudian-yolo', name: 'YOLO' },
                { id: 'claudian-safe', name: 'Safe' },
                { id: 'plan', name: 'Plan' },
              ],
              enabled: true,
              selectedMode: 'claudian-yolo',
            },
          },
          savedProviderEffort: {
            claude: 'high',
            opencode: 'default',
          },
          savedProviderModel: {
            claude: 'claude-sonnet-4-5',
            opencode: 'opencode:openai/gpt-5',
          },
          savedProviderPermissionMode: {
            claude: 'yolo',
          },
        },
      });

      const tab = createTab(createMockOptions({
        plugin,
        conversation: {
          id: 'conv-opencode-settings',
          providerId: 'opencode',
          title: 'OpenCode conversation',
          messages: [],
          sessionId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }));

      initializeTabUI(tab, plugin);
      expect(mockPermissionToggle.setVisible).toHaveBeenLastCalledWith(true);

      const toolbarModule = jest.requireMock('@/features/chat/ui/InputToolbar') as {
        createInputToolbar: jest.Mock;
      };
      const toolbarCallbacks = toolbarModule.createInputToolbar.mock.calls.at(-1)?.[1];

      await toolbarCallbacks.onPermissionModeChange('normal');

      expect(plugin.settings.providerConfigs.opencode.selectedMode).toBe('claudian-safe');
      expect(plugin.settings.savedProviderPermissionMode).toEqual(expect.objectContaining({
        claude: 'yolo',
        opencode: 'normal',
      }));
      expect(plugin.settings.permissionMode).toBe('yolo');
      expect(plugin.saveSettings).toHaveBeenCalled();
      expect(mockPermissionToggle.updateDisplay).toHaveBeenCalled();
    });

    it('resets to blank state when the new-conversation callback fires', () => {
      jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

      const plugin = createMockPlugin();
      const tab = createTab(createMockOptions({ plugin }));
      initializeTabUI(tab, plugin);
      initializeTabControllers(tab, plugin, {} as any);

      // Simulate a bound tab
      tab.lifecycleState = 'bound_cold';
      tab.conversationId = 'conv-1';

      const convCtrlModule = jest.requireMock('@/features/chat/controllers/ConversationController') as {
        ConversationController: jest.Mock;
      };
      const callback = convCtrlModule.ConversationController.mock.calls.at(-1)?.[1]?.onNewConversation;

      expect(callback).toBeDefined();

      callback();

      expect(tab.lifecycleState).toBe('blank');
      expect(tab.conversationId).toBeNull();
      // Draft model is resolved via provider projection, not raw settings.model
      expect(tab.draftModel).toBe(plugin.settings.savedProviderModel.claude);
      expect(tab.serviceInitialized).toBe(false);
    });

    it('preserves codex provider on new session when tab was codex', () => {
      jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

      const plugin = createMockPlugin();
      plugin.settings.savedProviderModel = { claude: 'claude-sonnet-4-5', codex: DEFAULT_CODEX_PRIMARY_MODEL };
      const tab = createTab(createMockOptions({ plugin }));
      initializeTabUI(tab, plugin);
      initializeTabControllers(tab, plugin, {} as any);

      // Simulate a bound Codex tab
      tab.lifecycleState = 'bound_cold';
      tab.conversationId = 'conv-1';
      tab.providerId = 'codex';

      const convCtrlModule = jest.requireMock('@/features/chat/controllers/ConversationController') as {
        ConversationController: jest.Mock;
      };
      const callback = convCtrlModule.ConversationController.mock.calls.at(-1)?.[1]?.onNewConversation;

      callback();

      expect(tab.lifecycleState).toBe('blank');
      expect(tab.draftModel).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(tab.providerId).toBe('codex');
    });

    it('cleans up the active runtime when resetting to a new blank session', () => {
      jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
      jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

      const plugin = createMockPlugin();
      plugin.settings.savedProviderModel = { claude: 'claude-sonnet-4-5', codex: DEFAULT_CODEX_PRIMARY_MODEL };
      const tab = createTab(createMockOptions({ plugin }));
      initializeTabUI(tab, plugin);
      initializeTabControllers(tab, plugin, {} as any);

      const staleService = createMockClaudianService({ providerId: 'codex' });
      tab.lifecycleState = 'bound_active';
      tab.conversationId = 'conv-1';
      tab.providerId = 'codex';
      tab.service = staleService as any;
      tab.serviceInitialized = true;

      const convCtrlModule = jest.requireMock('@/features/chat/controllers/ConversationController') as {
        ConversationController: jest.Mock;
      };
      const callback = convCtrlModule.ConversationController.mock.calls.at(-1)?.[1]?.onNewConversation;

      callback();

      expect(staleService.cleanup).toHaveBeenCalledTimes(1);
      expect(tab.service).toBeNull();
      expect(tab.serviceInitialized).toBe(false);
      expect(tab.lifecycleState).toBe('blank');
      expect(tab.providerId).toBe('codex');
      expect(tab.draftModel).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
    });
  });
});


describe('Tab - Activation/Deactivation', () => {
  describe('activateTab', () => {
    it('should show tab content', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      activateTab(tab);

      expect(tab.dom.contentEl.style.display).toBe('flex');
    });
  });

  describe('deactivateTab', () => {
    it('should hide tab content', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      // First activate, then deactivate
      activateTab(tab);
      deactivateTab(tab);

      expect(tab.dom.contentEl.style.display).toBe('none');
    });
  });
});


describe('Tab - Destruction', () => {
  describe('destroyTab', () => {
    it('should be an async function', async () => {
      const options = createMockOptions();
      const tab = createTab(options);

      const result = destroyTab(tab);

      expect(result).toBeInstanceOf(Promise);
      await result; // Should resolve without error
    });

    it('should call cleanup functions for event listeners', async () => {
      const options = createMockOptions();
      const tab = createTab(options);

      const cleanup1 = jest.fn();
      const cleanup2 = jest.fn();
      tab.dom.eventCleanups = [cleanup1, cleanup2];

      await destroyTab(tab);

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
    });

    it('should clear eventCleanups array after cleanup', async () => {
      const options = createMockOptions();
      const tab = createTab(options);

      tab.dom.eventCleanups = [jest.fn(), jest.fn()];

      await destroyTab(tab);

      expect(tab.dom.eventCleanups.length).toBe(0);
    });

    it('should unsubscribe from ready state changes when tab is destroyed', async () => {
      const unsubscribeFn = jest.fn();
      const mockOnReadyStateChange = jest.fn(() => unsubscribeFn);

      const runtimeModule = jest.requireMock('@/providers/claude/runtime/ClaudeChatRuntime') as { ClaudianService: jest.Mock };
      runtimeModule.ClaudianService.mockImplementationOnce(() => createMockClaudianService({ onReadyStateChange: mockOnReadyStateChange }));

      const options = createMockOptions();
      const tab = createTab(options);
      initializeTabUI(tab, options.plugin);

      await initializeTabService(tab, options.plugin, options.mcpManager);

      expect(mockOnReadyStateChange).toHaveBeenCalled();

      await destroyTab(tab);

      expect(unsubscribeFn).toHaveBeenCalled();
    });

    it('should cleanup the runtime service', async () => {
      const mockCleanup = jest.fn();
      const options = createMockOptions();
      const tab = createTab(options);

      tab.service = {
        cleanup: mockCleanup,
      } as any;

      await destroyTab(tab);

      expect(mockCleanup).toHaveBeenCalled();
      expect(tab.service).toBeNull();
    });

    it('should remove DOM element', async () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const removeSpy = jest.spyOn(tab.dom.contentEl, 'remove');

      await destroyTab(tab);

      expect(removeSpy).toHaveBeenCalled();
    });

    it('should cleanup subagents', async () => {
      const options = createMockOptions();
      const tab = createTab(options);

      const orphanAllActive = jest.fn();
      const clear = jest.fn();
      tab.services.subagentManager = { orphanAllActive, clear } as any;

      await destroyTab(tab);

      expect(orphanAllActive).toHaveBeenCalled();
      expect(clear).toHaveBeenCalled();
    });

    it('should cleanup UI components', async () => {
      const options = createMockOptions();
      const tab = createTab(options);

      const destroyFileContext = jest.fn();
      const destroySlashDropdown = jest.fn();
      const destroyInstructionMode = jest.fn();
      const cancelInstructionRefine = jest.fn();
      const cancelTitleGeneration = jest.fn();
      const destroyTodoPanel = jest.fn();
      const destroyResumeDropdown = jest.fn();

      tab.controllers.inputController = { destroyResumeDropdown, dismissPendingApproval: jest.fn() } as any;
      tab.ui.fileContextManager = { destroy: destroyFileContext } as any;
      tab.ui.slashCommandDropdown = { destroy: destroySlashDropdown } as any;
      tab.ui.instructionModeManager = { destroy: destroyInstructionMode } as any;
      tab.services.instructionRefineService = { cancel: cancelInstructionRefine, resetConversation: jest.fn() } as any;
      tab.services.titleGenerationService = { cancel: cancelTitleGeneration } as any;
      tab.ui.statusPanel = { destroy: destroyTodoPanel } as any;

      await destroyTab(tab);

      expect(destroyResumeDropdown).toHaveBeenCalled();
      expect(destroyFileContext).toHaveBeenCalled();
      expect(destroySlashDropdown).toHaveBeenCalled();
      expect(destroyInstructionMode).toHaveBeenCalled();
      expect(cancelInstructionRefine).toHaveBeenCalled();
      expect(cancelTitleGeneration).toHaveBeenCalled();
      expect(destroyTodoPanel).toHaveBeenCalled();
    });
  });
});


describe('Tab - Service Initialization Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should skip re-initialization if already initialized', async () => {
    const options = createMockOptions();
    const tab = createTab(options);

    // Mark as already initialized
    tab.serviceInitialized = true;
    const originalService = createMockClaudianService() as any;
    tab.service = originalService;

    await initializeTabService(tab, options.plugin, options.mcpManager);

    // Should not change existing service
    expect(tab.service).toBe(originalService);
    expect(tab.serviceInitialized).toBe(true);
  });

  it('should set serviceInitialized to true after successful initialization', async () => {
    const options = createMockOptions();
    const tab = createTab(options);

    expect(tab.serviceInitialized).toBe(false);
    expect(tab.service).toBeNull();

    await initializeTabService(tab, options.plugin, options.mcpManager);

    expect(tab.serviceInitialized).toBe(true);
    expect(tab.service).not.toBeNull();
  });

});


describe('Tab - Destroy Lifecycle Transition', () => {
  it('transitions to closing state and cleans up runtime', async () => {
    const mockCleanup = jest.fn();
    const options = createMockOptions();
    const tab = createTab(options);

    tab.lifecycleState = 'bound_active';
    tab.service = { cleanup: mockCleanup } as any;
    tab.serviceInitialized = true;

    await destroyTab(tab);

    expect(tab.lifecycleState).toBe('closing');
    expect(mockCleanup).toHaveBeenCalled();
    expect(tab.service).toBeNull();
  });

  it('does not fail when destroying a blank tab with no runtime', async () => {
    const options = createMockOptions();
    const tab = createTab(options);

    expect(tab.lifecycleState).toBe('blank');
    expect(tab.service).toBeNull();

    await destroyTab(tab);

    expect(tab.lifecycleState).toBe('closing');
  });

  it('does not fail when destroying a bound_cold tab with no runtime', async () => {
    const options = createMockOptions({
      conversation: {
        id: 'conv-1',
        providerId: 'claude' as any,
        title: 'Test',
        messages: [],
        sessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    const tab = createTab(options);

    expect(tab.lifecycleState).toBe('bound_cold');
    expect(tab.service).toBeNull();

    await destroyTab(tab);

    expect(tab.lifecycleState).toBe('closing');
  });
});

