import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Platform } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import {
  createTab,
  initializeTabControllers,
  initializeTabService,
  initializeTabUI,
  wireTabInputEvents,
} from '@/features/chat/tabs/Tab';
import { createTabRuntimeHost } from '@/features/chat/tabs/tabRuntimeHost';
import {
  DEFAULT_CODEX_PRIMARY_MODEL,
} from '@/providers/codex/types/models';
import * as envUtils from '@/utils/env';

import {
  createMockBangBashModeManager,
  createMockBrowserSelectionController,
  createMockCanvasSelectionController,
  createMockClaudeChatRuntime,
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
  ClaudeChatRuntime: jest.fn().mockImplementation(() => ({
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
let mockBangBashModeManager: ReturnType<typeof createMockBangBashModeManager>;
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

describe('Tab - Event Wiring', () => {
  describe('wireTabInputEvents', () => {
    it('should register event listeners on input element', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      // Initialize minimal controllers needed
      tab.controllers.inputController = {
        sendMessage: jest.fn(),
        cancelStreaming: jest.fn(),
      } as any;
      tab.controllers.selectionController = {
        showHighlight: jest.fn(),
      } as any;

      wireTabInputEvents(tab, options.plugin);

      // Check that event listeners were added (cast to any to access mock method)
      const inputListeners = (tab.dom.inputEl as any).getEventListeners();
      expect(inputListeners.get('keydown')).toBeDefined();
      expect(inputListeners.get('input')).toBeDefined();
      // focusin is registered on contentEl (not inputEl) to catch focus on any sidebar element
      const contentListeners = (tab.dom.contentEl as any).getEventListeners();
      expect(contentListeners.get('focusin')).toBeDefined();
    });

    it('should store cleanup functions for memory management', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      // Initialize minimal controllers
      tab.controllers.inputController = { sendMessage: jest.fn() } as any;
      tab.controllers.selectionController = { showHighlight: jest.fn() } as any;

      wireTabInputEvents(tab, options.plugin);

      expect(tab.dom.eventCleanups.length).toBe(4); // keydown, input, focus, scroll
    });
  });
});


describe('Tab - Runtime Host', () => {
  describe('createTabRuntimeHost autoTurn rendering', () => {
    function setupAutoTurnTest() {
      const plugin = createMockPlugin();
      const tab = createTab(createMockOptions({ plugin }));
      const addMessageSpy = jest.spyOn(tab.state, 'addMessage');
      const addMessage = jest.fn(() => {
        const msgEl = createMockEl();
        msgEl.createDiv({ cls: 'specorator-message-content' });
        return msgEl;
      });
      const scrollToBottom = jest.fn();
      const handleStreamChunk = jest.fn().mockResolvedValue(undefined);

      Object.defineProperty(tab.dom.contentEl, 'isConnected', {
        value: true,
        writable: true,
        configurable: true,
      });

      tab.renderer = {
        addMessage,
        renderContent: jest.fn(),
        addTextCopyButton: jest.fn(),
        scrollToBottom,
      } as any;
      tab.controllers.streamController = {
        handleStreamChunk,
        appendText: jest.fn().mockResolvedValue(undefined),
        finalizeCurrentThinkingBlock: jest.fn().mockResolvedValue(undefined),
        finalizeCurrentTextBlock: jest.fn().mockResolvedValue(undefined),
        hideThinkingIndicator: jest.fn(),
        setRenderingAutoTurn: jest.fn(),
      } as any;
      tab.controllers.inputController = {
        handleApprovalRequest: jest.fn(),
        dismissPendingApproval: jest.fn(),
        handleAskUserQuestion: jest.fn(),
        handleExitPlanMode: jest.fn(),
      } as any;
      tab.services.subagentManager = {
        hasRunningSubagents: jest.fn().mockReturnValue(false),
        resetStreamingState: jest.fn(),
      } as any;

      // The host closes over live tab state; runtimes invoke host.autoTurn
      // directly (no setter indirection since ADR-0001 Phase 2).
      const host = createTabRuntimeHost(tab, plugin);
      const autoTurnCallback = host.autoTurn;
      return { tab, addMessageSpy, addMessage, handleStreamChunk, scrollToBottom, autoTurnCallback };
    }

    it('renders tool-only auto-triggered turns with a placeholder assistant message', async () => {
      const { addMessageSpy, addMessage, handleStreamChunk, scrollToBottom, autoTurnCallback } = setupAutoTurnTest();

      await autoTurnCallback({
        chunks: [
          { type: 'tool_result', id: 'task-1', content: 'done' },
        ],
        metadata: {},
      });

      expect(addMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: '(background task completed)',
        })
      );
      expect(addMessage).toHaveBeenCalled();
      expect(handleStreamChunk).toHaveBeenCalledWith(
        { type: 'tool_result', id: 'task-1', content: 'done' },
        expect.objectContaining({ role: 'assistant' })
      );
      expect(scrollToBottom).toHaveBeenCalled();
    });

    it('routes hidden async subagent auto-turn chunks without adding a placeholder message', async () => {
      const { addMessageSpy, addMessage, handleStreamChunk, scrollToBottom, autoTurnCallback } = setupAutoTurnTest();

      await autoTurnCallback({
        chunks: [
          {
            type: 'async_subagent_result',
            agentId: 'agent-1',
            status: 'completed',
            result: 'Done',
          },
        ],
        metadata: {},
      });

      expect(handleStreamChunk).toHaveBeenCalledWith(
        {
          type: 'async_subagent_result',
          agentId: 'agent-1',
          status: 'completed',
          result: 'Done',
        },
        expect.objectContaining({ role: 'assistant' })
      );
      expect(addMessageSpy).not.toHaveBeenCalled();
      expect(addMessage).not.toHaveBeenCalled();
      expect(scrollToBottom).not.toHaveBeenCalled();
    });

    it('skips auto-triggered rendering after the tab DOM is detached', async () => {
      const { tab, addMessageSpy, addMessage, handleStreamChunk, scrollToBottom, autoTurnCallback } = setupAutoTurnTest();

      (tab.dom.contentEl as any).isConnected = false;
      await autoTurnCallback({
        chunks: [
          { type: 'text', content: 'Background result' },
        ],
        metadata: {},
      });

      expect(addMessageSpy).not.toHaveBeenCalled();
      expect(addMessage).not.toHaveBeenCalled();
      expect(handleStreamChunk).not.toHaveBeenCalled();
      expect(scrollToBottom).not.toHaveBeenCalled();
    });
  });
});


describe('Tab - UI Initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeTabUI', () => {
    it('should create FileContextManager', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.ui.fileContextManager).toBeDefined();
    });

    it('should wire FileContextManager to MCP service', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(mockFileContextManager.setMcpManager).toHaveBeenCalledWith((options.plugin as any).mcpManager);
    });

    it('should create ImageContextManager', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.ui.imageContextManager).toBeDefined();
    });

    it('should create selection indicator element', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.dom.selectionIndicatorEl).toBeDefined();
      expect(tab.dom.selectionIndicatorEl!.style.display).toBe('none');
    });

    it('should create SlashCommandDropdown', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.ui.slashCommandDropdown).toBeDefined();
    });

    it('should create InstructionRefineService', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.services.instructionRefineService).toBeDefined();
    });

    it('should create TitleGenerationService', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.services.titleGenerationService).toBeDefined();
    });

    it('should create InstructionModeManager', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.ui.instructionModeManager).toBeDefined();
    });

    it('should create and mount StatusPanel', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.ui.statusPanel).toBeDefined();
      expect(mockStatusPanel.mount).toHaveBeenCalledWith(tab.dom.statusPanelContainerEl);
    });

    it('should create input toolbar components', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(tab.ui.modelSelector).toBeDefined();
      expect(tab.ui.thinkingBudgetSelector).toBeDefined();
      expect(tab.ui.contextUsageMeter).toBeDefined();
      expect(tab.ui.externalContextSelector).toBeDefined();
      expect(tab.ui.mcpServerSelector).toBeDefined();
      expect(tab.ui.permissionToggle).toBeDefined();
    });

    it('should create bang-bash mode from provider UI config', () => {
      const getEnhancedPathSpy = jest
        .spyOn(envUtils, 'getEnhancedPath')
        .mockReturnValue('/usr/bin');
      const plugin = createMockPlugin({
        settings: {
          ...createMockPlugin().settings,
          providerConfigs: {
            claude: { enableBangBash: true },
            codex: { enabled: true },
          },
        },
      });
      const options = createMockOptions({ plugin });
      const tab = createTab(options);

      initializeTabUI(tab, plugin);

      expect(tab.ui.bangBashModeManager).toBeDefined();

      getEnhancedPathSpy.mockRestore();
    });

    it('should wire MCP server selector to MCP service', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(mockMcpServerSelector.setMcpManager).toHaveBeenCalledWith((options.plugin as any).mcpManager);
    });

    it('should wire external context selector onChange', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      expect(mockExternalContextSelector.setOnChange).toHaveBeenCalled();
    });

    it('should initialize persistent paths from settings', () => {
      const plugin = createMockPlugin({
        settings: {
          ...createMockPlugin().settings,
          persistentExternalContextPaths: ['/path/1', '/path/2'],
        },
      });
      const options = createMockOptions({ plugin });
      const tab = createTab(options);

      initializeTabUI(tab, plugin);

      expect(mockExternalContextSelector.setPersistentPaths).toHaveBeenCalledWith(['/path/1', '/path/2']);
    });

    it('should update ChatState callbacks for UI updates', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      // Verify callbacks are set by checking the state
      expect(tab.state.callbacks.onUsageChanged).toBeDefined();
      expect(tab.state.callbacks.onTodosChanged).toBeDefined();
    });
  });
});


describe('Tab - Controller Initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeTabControllers', () => {
    it('should create MessageRenderer', () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      expect(tab.renderer).toBeDefined();
    });

    it('should create SelectionController', () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      expect(tab.controllers.selectionController).toBeDefined();
    });

    it('should create StreamController', () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      expect(tab.controllers.streamController).toBeDefined();
    });

    it('should create ConversationController', () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      expect(tab.controllers.conversationController).toBeDefined();
    });

    it('should forward rewind mode from renderer to ConversationController', async () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const { MessageRenderer } = jest.requireMock('@/features/chat/rendering/MessageRenderer') as { MessageRenderer: jest.Mock };
      const lastCall = MessageRenderer.mock.calls[MessageRenderer.mock.calls.length - 1];
      const rewindCallback = lastCall[3].rewindCallback;

      await rewindCallback('message-1', 'conversation');

      expect(mockConversationController.rewind).toHaveBeenCalledWith('message-1', 'conversation');
    });

    it('should create InputController', () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      expect(tab.controllers.inputController).toBeDefined();
    });

    it('should create and initialize NavigationController', () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      expect(tab.controllers.navigationController).toBeDefined();
      expect(mockNavigationController.initialize).toHaveBeenCalled();
    });

    it('should update SubagentManager with StreamController callback', () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      // The subagent manager should have its callback set
      expect(tab.services.subagentManager).toBeDefined();
    });

    it('persists async subagent state changes when not streaming', async () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      tab.state.currentConversationId = 'conv-1';
      tab.state.isStreaming = false;

      const setCallback = tab.services.subagentManager.setCallback as jest.Mock;
      const callback = setCallback.mock.calls[0][0] as (subagent: any) => void;

      callback({
        id: 'task-1',
        description: 'Background task',
        mode: 'async',
        asyncStatus: 'completed',
        status: 'completed',
        prompt: 'do work',
        result: 'done',
        toolCalls: [],
        isExpanded: false,
      });

      // Wait one microtask so Promise chain from save(false) can run.
      await Promise.resolve();

      expect(mockStreamController.onAsyncSubagentStateChange).toHaveBeenCalled();
      expect(mockConversationController.save).toHaveBeenCalledWith(false);
    });

    it('does not persist async subagent state while main stream is active', async () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      tab.state.currentConversationId = 'conv-1';
      tab.state.isStreaming = true;

      const setCallback = tab.services.subagentManager.setCallback as jest.Mock;
      const callback = setCallback.mock.calls[0][0] as (subagent: any) => void;

      callback({
        id: 'task-1',
        description: 'Background task',
        mode: 'async',
        asyncStatus: 'running',
        status: 'running',
        toolCalls: [],
        isExpanded: false,
      });

      await Promise.resolve();

      expect(mockConversationController.save).not.toHaveBeenCalled();
    });
  });
});


describe('Tab - Event Handler Behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.isMacOS = true;
    mockFileContextManager = createMockFileContextManager();
    mockSlashCommandDropdown = createMockSlashCommandDropdown();
    mockInstructionModeManager = createMockInstructionModeManager();
    mockBangBashModeManager = createMockBangBashModeManager();
    mockInputController = createMockInputController();
    mockSelectionController = createMockSelectionController();
  });

  // Wire up a tab with all UI managers and controllers needed for keydown tests,
  // then return the tab + a helper to fire keydown events.
  function setupKeydownTab(overrides?: {
    bangBashManager?: typeof mockBangBashModeManager;
  }) {
    const options = createMockOptions();
    const tab = createTab(options);

    tab.ui.bangBashModeManager = (overrides?.bangBashManager ?? mockBangBashModeManager) as any;
    tab.ui.instructionModeManager = mockInstructionModeManager as any;
    tab.ui.slashCommandDropdown = mockSlashCommandDropdown as any;
    tab.ui.fileContextManager = mockFileContextManager as any;
    tab.controllers.inputController = mockInputController as any;
    tab.controllers.selectionController = mockSelectionController as any;

    wireTabInputEvents(tab, options.plugin);

    const listeners = (tab.dom.inputEl as any).getEventListeners();
    const fireKeydown = (event: Record<string, any>) => listeners.get('keydown')[0](event);

    return { tab, options, listeners, fireKeydown };
  }

  describe('wireTabInputEvents - keydown handlers', () => {
    it('should not pass keydown events to other handlers when bang-bash mode is active', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      tab.ui.bangBashModeManager = mockBangBashModeManager as any;
      tab.ui.instructionModeManager = mockInstructionModeManager as any;
      tab.ui.slashCommandDropdown = mockSlashCommandDropdown as any;
      tab.ui.fileContextManager = mockFileContextManager as any;
      tab.controllers.inputController = mockInputController as any;
      tab.controllers.selectionController = mockSelectionController as any;

      mockBangBashModeManager.isActive.mockReturnValue(true);

      wireTabInputEvents(tab, options.plugin);

      const listeners = (tab.dom.inputEl as any).getEventListeners();
      const keydownHandler = listeners.get('keydown')[0];
      const event = { key: '#', preventDefault: jest.fn() };
      keydownHandler(event);

      expect(mockBangBashModeManager.handleKeydown).toHaveBeenCalled();
      expect(mockInstructionModeManager.handleTriggerKey).not.toHaveBeenCalled();
      expect(mockSlashCommandDropdown.handleKeydown).not.toHaveBeenCalled();
      expect(mockFileContextManager.handleMentionKeydown).not.toHaveBeenCalled();
    });

    it('should suppress slash dropdown and mention handling on bang-bash enter/exit', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      let active = false;
      tab.ui.bangBashModeManager = {
        isActive: jest.fn(() => active),
        handleTriggerKey: jest.fn((e: any) => {
          active = true;
          e.preventDefault();
          return true;
        }),
        handleKeydown: jest.fn((e: any) => {
          if (!active) return false;
          if (e.key === 'Escape') {
            active = false;
            e.preventDefault();
            return true;
          }
          return false;
        }),
        handleInputChange: jest.fn(),
        destroy: jest.fn(),
      } as any;

      tab.ui.instructionModeManager = mockInstructionModeManager as any;
      tab.ui.slashCommandDropdown = mockSlashCommandDropdown as any;
      tab.ui.fileContextManager = mockFileContextManager as any;
      tab.controllers.inputController = mockInputController as any;
      tab.controllers.selectionController = mockSelectionController as any;

      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);

      wireTabInputEvents(tab, options.plugin);

      const listeners = (tab.dom.inputEl as any).getEventListeners();
      const keydownHandler = listeners.get('keydown')[0];

      keydownHandler({ key: '!', preventDefault: jest.fn() });
      expect(mockSlashCommandDropdown.setEnabled).toHaveBeenCalledWith(false);
      expect(mockFileContextManager.hideMentionDropdown).toHaveBeenCalled();

      keydownHandler({ key: 'Escape', preventDefault: jest.fn() });
      expect(mockSlashCommandDropdown.setEnabled).toHaveBeenCalledWith(true);
    });

    it('should handle instruction mode trigger key', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValueOnce(true);
      const { fireKeydown } = setupKeydownTab();

      fireKeydown({ key: '#', preventDefault: jest.fn() });

      expect(mockInstructionModeManager.handleTriggerKey).toHaveBeenCalled();
    });

    it('should handle instruction mode keydown', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValueOnce(true);
      const { fireKeydown } = setupKeydownTab();

      fireKeydown({ key: 'Tab', preventDefault: jest.fn() });

      expect(mockInstructionModeManager.handleKeydown).toHaveBeenCalled();
    });

    it('should handle slash command dropdown keydown', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValueOnce(true);
      const { fireKeydown } = setupKeydownTab();

      fireKeydown({ key: 'ArrowDown', preventDefault: jest.fn() });

      expect(mockSlashCommandDropdown.handleKeydown).toHaveBeenCalled();
    });

    it('should let explicit Command+Enter send before slash dropdown handles Enter', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(true);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { fireKeydown } = setupKeydownTab();
      Platform.isMacOS = true;

      const event = {
        key: 'Enter',
        shiftKey: false,
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        isComposing: false,
        preventDefault: jest.fn(),
      };
      fireKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockInputController.sendMessage).toHaveBeenCalled();
      expect(mockSlashCommandDropdown.handleKeydown).not.toHaveBeenCalled();
    });

    it('should let explicit Ctrl+Enter send before slash dropdown handles Enter on non-mac', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(true);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { fireKeydown } = setupKeydownTab();
      Platform.isMacOS = false;

      const event = {
        key: 'Enter',
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        isComposing: false,
        preventDefault: jest.fn(),
      };
      fireKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockInputController.sendMessage).toHaveBeenCalled();
      expect(mockSlashCommandDropdown.handleKeydown).not.toHaveBeenCalled();
    });

    it('should keep plain Enter routed to visible slash dropdown before sending', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(true);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { fireKeydown } = setupKeydownTab();

      const event = {
        key: 'Enter',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        isComposing: false,
        preventDefault: jest.fn(),
      };
      fireKeydown(event);

      expect(mockSlashCommandDropdown.handleKeydown).toHaveBeenCalled();
      expect(mockInputController.sendMessage).not.toHaveBeenCalled();
    });

    it('should handle resume dropdown keydown', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockInputController.handleResumeKeydown.mockReturnValueOnce(true);
      const { fireKeydown } = setupKeydownTab();

      fireKeydown({ key: 'ArrowDown', preventDefault: jest.fn() });

      expect(mockInputController.handleResumeKeydown).toHaveBeenCalled();
      expect(mockSlashCommandDropdown.handleKeydown).not.toHaveBeenCalled();
      expect(mockFileContextManager.handleMentionKeydown).not.toHaveBeenCalled();
    });

    it('should handle file context mention keydown', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(false);
      mockFileContextManager.handleMentionKeydown.mockReturnValueOnce(true);
      const { fireKeydown } = setupKeydownTab();

      fireKeydown({ key: 'ArrowUp', preventDefault: jest.fn() });

      expect(mockFileContextManager.handleMentionKeydown).toHaveBeenCalled();
    });

    it('should cancel streaming on Escape when streaming', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(false);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { tab, fireKeydown } = setupKeydownTab();
      tab.state.isStreaming = true;

      const event = { key: 'Escape', isComposing: false, preventDefault: jest.fn() };
      fireKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockInputController.cancelStreaming).toHaveBeenCalled();
    });

    it('should not cancel streaming on Escape when isComposing (IME)', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(false);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { tab, fireKeydown } = setupKeydownTab();
      tab.state.isStreaming = true;

      const event = { key: 'Escape', isComposing: true, preventDefault: jest.fn() };
      fireKeydown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(mockInputController.cancelStreaming).not.toHaveBeenCalled();
    });

    it('should send message on Enter (without Shift)', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(false);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { fireKeydown } = setupKeydownTab();

      const event = { key: 'Enter', shiftKey: false, isComposing: false, preventDefault: jest.fn() };
      fireKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockInputController.sendMessage).toHaveBeenCalled();
    });

    it('should not send message on Shift+Enter (newline)', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(false);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { fireKeydown } = setupKeydownTab();

      const event = { key: 'Enter', shiftKey: true, isComposing: false, preventDefault: jest.fn() };
      fireKeydown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(mockInputController.sendMessage).not.toHaveBeenCalled();
    });

    it('should require Command+Enter on macOS when the send shortcut setting is enabled', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(false);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { options, fireKeydown } = setupKeydownTab();
      Platform.isMacOS = true;
      options.plugin.settings.requireCommandOrControlEnterToSend = true;

      const enterEvent = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, preventDefault: jest.fn() };
      fireKeydown(enterEvent);

      expect(enterEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockInputController.sendMessage).not.toHaveBeenCalled();

      const controlEnterEvent = { key: 'Enter', shiftKey: false, ctrlKey: true, metaKey: false, isComposing: false, preventDefault: jest.fn() };
      fireKeydown(controlEnterEvent);

      expect(controlEnterEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockInputController.sendMessage).not.toHaveBeenCalled();

      const commandEnterEvent = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: true, isComposing: false, preventDefault: jest.fn() };
      fireKeydown(commandEnterEvent);

      expect(commandEnterEvent.preventDefault).toHaveBeenCalled();
      expect(mockInputController.sendMessage).toHaveBeenCalled();
    });

    it('should require Ctrl+Enter off macOS when the send shortcut setting is enabled', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(false);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { options, fireKeydown } = setupKeydownTab();
      Platform.isMacOS = false;
      options.plugin.settings.requireCommandOrControlEnterToSend = true;

      const commandEnterEvent = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: true, isComposing: false, preventDefault: jest.fn() };
      fireKeydown(commandEnterEvent);

      expect(commandEnterEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockInputController.sendMessage).not.toHaveBeenCalled();

      const controlEnterEvent = { key: 'Enter', shiftKey: false, ctrlKey: true, metaKey: false, isComposing: false, preventDefault: jest.fn() };
      fireKeydown(controlEnterEvent);

      expect(controlEnterEvent.preventDefault).toHaveBeenCalled();
      expect(mockInputController.sendMessage).toHaveBeenCalled();
    });

    it('should not send message on Enter when isComposing (IME)', () => {
      mockInstructionModeManager.handleTriggerKey.mockReturnValue(false);
      mockInstructionModeManager.handleKeydown.mockReturnValue(false);
      mockSlashCommandDropdown.handleKeydown.mockReturnValue(false);
      mockFileContextManager.handleMentionKeydown.mockReturnValue(false);
      const { fireKeydown } = setupKeydownTab();

      const event = { key: 'Enter', shiftKey: false, isComposing: true, preventDefault: jest.fn() };
      fireKeydown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(mockInputController.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('wireTabInputEvents - input handler', () => {
    it('should trigger file context input change', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      tab.ui.fileContextManager = mockFileContextManager as any;
      tab.ui.instructionModeManager = mockInstructionModeManager as any;
      tab.controllers.inputController = mockInputController as any;
      tab.controllers.selectionController = mockSelectionController as any;

      wireTabInputEvents(tab, options.plugin);

      const listeners = (tab.dom.inputEl as any).getEventListeners();
      const inputHandler = listeners.get('input')[0];
      inputHandler();

      expect(mockFileContextManager.handleInputChange).toHaveBeenCalled();
      expect(mockInstructionModeManager.handleInputChange).toHaveBeenCalled();
    });
  });

  describe('wireTabInputEvents - focus handler', () => {
    it('should show selection highlight on focusin (any sidebar element)', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      tab.controllers.selectionController = mockSelectionController as any;
      tab.controllers.inputController = mockInputController as any;

      wireTabInputEvents(tab, options.plugin);

      const listeners = (tab.dom.contentEl as any).getEventListeners();
      const focusHandler = listeners.get('focusin')[0];
      // Simulate focus entering from outside (relatedTarget is null)
      focusHandler({ relatedTarget: null });

      expect(mockSelectionController.showHighlight).toHaveBeenCalled();
    });
  });

  describe('wireTabInputEvents - input handlers', () => {
    it('should not call FileContextManager.handleInputChange when bang-bash mode is active', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      tab.ui.bangBashModeManager = mockBangBashModeManager as any;
      tab.ui.instructionModeManager = mockInstructionModeManager as any;
      tab.ui.slashCommandDropdown = mockSlashCommandDropdown as any;
      tab.ui.fileContextManager = mockFileContextManager as any;

      mockBangBashModeManager.isActive.mockReturnValue(true);

      wireTabInputEvents(tab, options.plugin);

      const listeners = (tab.dom.inputEl as any).getEventListeners();
      const inputHandler = listeners.get('input')[0];
      inputHandler();

      expect(mockFileContextManager.handleInputChange).not.toHaveBeenCalled();
      expect(mockBangBashModeManager.handleInputChange).toHaveBeenCalled();
    });
  });
});


describe('Tab - ChatState Callback Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should invoke onStreamingChanged callback when streaming state changes', () => {
    const onStreamingChanged = jest.fn();
    const options = createMockOptions({ onStreamingChanged });
    const tab = createTab(options);

    // Trigger the callback through ChatState
    tab.state.callbacks.onStreamingStateChanged?.(true);

    expect(onStreamingChanged).toHaveBeenCalledWith(true);
  });

  it('should invoke onAttentionChanged callback when attention state changes', () => {
    const onAttentionChanged = jest.fn();
    const options = createMockOptions({ onAttentionChanged });
    const tab = createTab(options);

    // Trigger the callback through ChatState
    tab.state.callbacks.onAttentionChanged?.(true);

    expect(onAttentionChanged).toHaveBeenCalledWith(true);
  });

  it('should invoke onConversationIdChanged callback when conversation changes', () => {
    const onConversationIdChanged = jest.fn();
    const options = createMockOptions({ onConversationIdChanged });
    const tab = createTab(options);

    // Trigger the callback through ChatState
    tab.state.callbacks.onConversationChanged?.('new-conv-id');

    expect(onConversationIdChanged).toHaveBeenCalledWith('new-conv-id');
  });
});


describe('Tab - UI Callback Wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeTabUI callbacks', () => {
    it('should wire onChipsChanged to scroll to bottom', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      // Initialize UI to wire callbacks
      initializeTabUI(tab, options.plugin);

      // Set up renderer
      tab.renderer = mockMessageRenderer as any;

      // Get the FileContextManager constructor call arguments
      const { FileContextManager } = jest.requireMock('@/features/chat/ui/FileContext');
      const constructorCall = FileContextManager.mock.calls[0];
      const callbacks = constructorCall[3]; // 4th argument is callbacks

      // Trigger onChipsChanged callback
      callbacks.onChipsChanged();

      expect(mockMessageRenderer.scrollToBottomIfNeeded).toHaveBeenCalled();
    });

    it('should wire onImagesChanged to scroll to bottom', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      tab.renderer = mockMessageRenderer as any;

      // Get the ImageContextManager constructor call
      const { ImageContextManager } = jest.requireMock('@/features/chat/ui/ImageContext');
      const constructorCall = ImageContextManager.mock.calls[0];
      const callbacks = constructorCall[2]; // 3rd argument is callbacks (app parameter was removed)

      callbacks.onImagesChanged();

      expect(mockMessageRenderer.scrollToBottomIfNeeded).toHaveBeenCalled();
    });

    it('should wire getExcludedTags to return plugin settings', () => {
      const plugin = createMockPlugin({
        settings: {
          ...createMockPlugin().settings,
          excludedTags: ['tag1', 'tag2'],
        },
      });
      const options = createMockOptions({ plugin });
      const tab = createTab(options);

      initializeTabUI(tab, plugin);

      const { FileContextManager } = jest.requireMock('@/features/chat/ui/FileContext');
      const constructorCall = FileContextManager.mock.calls[0];
      const callbacks = constructorCall[3];

      const excludedTags = callbacks.getExcludedTags();

      expect(excludedTags).toEqual(['tag1', 'tag2']);
    });

    it('should wire getExternalContexts to return external context selector contexts', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      // Mock external context selector return value
      mockExternalContextSelector.getExternalContexts.mockReturnValue(['/path/1', '/path/2']);

      const { FileContextManager } = jest.requireMock('@/features/chat/ui/FileContext');
      const constructorCall = FileContextManager.mock.calls[0];
      const callbacks = constructorCall[3];

      const contexts = callbacks.getExternalContexts();

      expect(contexts).toEqual(['/path/1', '/path/2']);
    });

    it('should wire MCP mention change to add servers to selector', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      // Get the setOnMcpMentionChange callback
      const onMcpMentionChange = mockFileContextManager.setOnMcpMentionChange.mock.calls[0][0];

      // Trigger with server list
      onMcpMentionChange(['server1', 'server2']);

      expect(mockMcpServerSelector.addMentionedServers).toHaveBeenCalledWith(['server1', 'server2']);
    });

    it('should wire external context onChange to pre-scan contexts', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      // Get the setOnChange callback
      const onChange = mockExternalContextSelector.setOnChange.mock.calls[0][0];

      // Trigger onChange
      onChange();

      expect(mockFileContextManager.preScanExternalContexts).toHaveBeenCalled();
    });

    it('should wire persistence change to save settings', async () => {
      const saveSettings = jest.fn().mockResolvedValue(undefined);
      const plugin = createMockPlugin({ saveSettings });
      const options = createMockOptions({ plugin });
      const tab = createTab(options);

      initializeTabUI(tab, plugin);

      // Get the setOnPersistenceChange callback
      const onPersistenceChange = mockExternalContextSelector.setOnPersistenceChange.mock.calls[0][0];

      // Trigger with new paths
      await onPersistenceChange(['/new/path1', '/new/path2']);

      expect(plugin.settings.persistentExternalContextPaths).toEqual(['/new/path1', '/new/path2']);
      expect(saveSettings).toHaveBeenCalled();
    });

    it('should wire onUsageChanged callback to update context meter', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      // Verify callback is wired
      const usage = { inputTokens: 1000, outputTokens: 500 };
      tab.state.callbacks.onUsageChanged?.(usage as any);

      expect(mockContextUsageMeter.update).toHaveBeenCalledWith(usage);
    });

    it('should update context meter for Codex tabs on usage change', () => {
      const getCapabilitiesSpy = jest.spyOn(ProviderRegistry, 'getCapabilities');
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

      mockContextUsageMeter.update.mockClear();

      const usage = {
        inputTokens: 5000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 1000,
        contextWindow: 200000,
        contextTokens: 6000,
        percentage: 3,
      };
      tab.state.callbacks.onUsageChanged?.(usage as any);

      expect(mockContextUsageMeter.update).toHaveBeenCalledWith(usage);

      getCapabilitiesSpy.mockRestore();
    });

    it('should wire onTodosChanged callback to update todo panel', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      // Verify callback is wired
      const todos = [{ id: '1', content: 'Test todo', status: 'pending' }];
      tab.state.callbacks.onTodosChanged?.(todos as any);

      expect(mockStatusPanel.updateTodos).toHaveBeenCalledWith(todos);
    });

    it('should wire instruction mode onSubmit to input controller', async () => {
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      // Get the InstructionModeManager constructor arguments
      const { InstructionModeManager } = jest.requireMock('@/features/chat/ui/InstructionModeManager');
      const constructorCall = InstructionModeManager.mock.calls[0];
      const callbacks = constructorCall[1]; // 2nd argument is callbacks

      // Trigger onSubmit
      await callbacks.onSubmit('refined instruction');

      expect(mockInputController.handleInstructionSubmit).toHaveBeenCalledWith('refined instruction');
    });

    it('should wire getInputWrapper to return input wrapper element', () => {
      const options = createMockOptions();
      const tab = createTab(options);

      initializeTabUI(tab, options.plugin);

      const { InstructionModeManager } = jest.requireMock('@/features/chat/ui/InstructionModeManager');
      const constructorCall = InstructionModeManager.mock.calls[0];
      const callbacks = constructorCall[1];

      const wrapper = callbacks.getInputWrapper();

      expect(wrapper).toBe(tab.dom.inputWrapper);
    });

    it('should wire provider catalog config when provided in options', async () => {
      const mockEntries = [{
        id: 'cmd-review',
        providerId: 'claude' as const,
        kind: 'command' as const,
        name: 'review',
        description: 'Review code',
        content: '',
        scope: 'vault' as const,
        source: 'user' as const,
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      }];
      const mockConfig = { providerId: 'claude' as const, triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' };
      const plugin = createMockPlugin();
      const options = createMockOptions({ plugin });
      const tab = createTab(options);

      initializeTabUI(tab, plugin, {
        getProviderCatalogConfig: () => ({
          config: mockConfig,
          getEntries: jest.fn().mockResolvedValue(mockEntries),
        }),
      });

      const { SlashCommandDropdown } = jest.requireMock('@/shared/components/SlashCommandDropdown');
      const constructorCall = SlashCommandDropdown.mock.calls[0];
      const opts = constructorCall[3]; // 4th argument is options

      expect(opts.providerConfig).toEqual(mockConfig);
      expect(typeof opts.getProviderEntries).toBe('function');
    });

    it('should wire provider-scoped hidden commands into the slash dropdown', () => {
      const plugin = createMockPlugin({
        settings: {
          excludedTags: [],
          model: DEFAULT_CODEX_PRIMARY_MODEL,
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

      const { SlashCommandDropdown } = jest.requireMock('@/shared/components/SlashCommandDropdown');
      const constructorCall = SlashCommandDropdown.mock.calls[0];
      const opts = constructorCall[3];

      expect(Array.from(opts.hiddenCommands)).toEqual(['analyze']);
    });
  });
});


describe('Tab - Controller Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('InputController configuration', () => {
    it('should wire ensureServiceInitialized to return true when already initialized and bound_active', async () => {
      const { InputController } = jest.requireMock('@/features/chat/controllers/InputController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      // Get InputController constructor config
      const constructorCall = InputController.mock.calls[0];
      const config = constructorCall[0];

      // Test ensureServiceInitialized when already initialized and bound_active
      tab.serviceInitialized = true;
      tab.lifecycleState = 'bound_active';
      const result = await config.ensureServiceInitialized();
      expect(result).toBe(true);
    });

    it('should wire getAgentService to return tab service', () => {
      const { InputController } = jest.requireMock('@/features/chat/controllers/InputController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = InputController.mock.calls[0];
      const config = constructorCall[0];

      // Verify getAgentService returns tab's service
      tab.service = { id: 'test-service' } as any;
      expect(config.getAgentService()).toBe(tab.service);
    });

    it('should wire getters to return tab UI components', () => {
      const { InputController } = jest.requireMock('@/features/chat/controllers/InputController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = InputController.mock.calls[0];
      const config = constructorCall[0];

      // Test getters return correct UI components
      expect(config.getInputEl()).toBe(tab.dom.inputEl);
      expect(config.getMessagesEl()).toBe(tab.dom.messagesEl);
      expect(config.getFileContextManager()).toBe(tab.ui.fileContextManager);
      expect(config.getImageContextManager()).toBe(tab.ui.imageContextManager);
      expect(config.getMcpServerSelector()).toBe(tab.ui.mcpServerSelector);
      expect(config.getExternalContextSelector()).toBe(tab.ui.externalContextSelector);
      expect(config.getInstructionModeManager()).toBe(tab.ui.instructionModeManager);
      expect(config.getInstructionRefineService()).toBe(tab.services.instructionRefineService);
      expect(config.getTitleGenerationService()).toBe(tab.services.titleGenerationService);
    });

  });

  describe('StreamController configuration', () => {
    it('should wire updateQueueIndicator to input controller', () => {
      const { StreamController } = jest.requireMock('@/features/chat/controllers/StreamController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = StreamController.mock.calls[0];
      const config = constructorCall[0];

      config.updateQueueIndicator();

      expect(mockInputController.updateQueueIndicator).toHaveBeenCalled();
    });

    it('should wire getAgentService to return tab service', () => {
      const { StreamController } = jest.requireMock('@/features/chat/controllers/StreamController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      tab.service = { id: 'test-service' } as any;

      const constructorCall = StreamController.mock.calls[0];
      const config = constructorCall[0];

      expect(config.getAgentService()).toBe(tab.service);
    });

    it('should wire getMessagesEl to return tab messages element', () => {
      const { StreamController } = jest.requireMock('@/features/chat/controllers/StreamController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = StreamController.mock.calls[0];
      const config = constructorCall[0];

      expect(config.getMessagesEl()).toBe(tab.dom.messagesEl);
    });
  });

  describe('NavigationController configuration', () => {
    it('should wire shouldSkipEscapeHandling to check UI state', () => {
      const { NavigationController } = jest.requireMock('@/features/chat/controllers/NavigationController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = NavigationController.mock.calls[0];
      const config = constructorCall[0];

      // Test when instruction mode is active
      mockInstructionModeManager.isActive.mockReturnValue(true);
      expect(config.shouldSkipEscapeHandling()).toBe(true);

      // Test when slash command dropdown is visible
      mockInstructionModeManager.isActive.mockReturnValue(false);
      mockSlashCommandDropdown.isVisible.mockReturnValue(true);
      expect(config.shouldSkipEscapeHandling()).toBe(true);

      // Test when mention dropdown is visible
      mockSlashCommandDropdown.isVisible.mockReturnValue(false);
      mockFileContextManager.isMentionDropdownVisible.mockReturnValue(true);
      expect(config.shouldSkipEscapeHandling()).toBe(true);

      // Test when resume dropdown is visible
      mockFileContextManager.isMentionDropdownVisible.mockReturnValue(false);
      mockInputController.isResumeDropdownVisible.mockReturnValue(true);
      expect(config.shouldSkipEscapeHandling()).toBe(true);

      // Test when nothing active
      mockInputController.isResumeDropdownVisible.mockReturnValue(false);
      expect(config.shouldSkipEscapeHandling()).toBe(false);
    });

    it('should wire isStreaming to return tab state', () => {
      const { NavigationController } = jest.requireMock('@/features/chat/controllers/NavigationController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = NavigationController.mock.calls[0];
      const config = constructorCall[0];

      tab.state.isStreaming = true;
      expect(config.isStreaming()).toBe(true);

      tab.state.isStreaming = false;
      expect(config.isStreaming()).toBe(false);
    });

    it('should wire getSettings to return keyboard navigation settings', () => {
      const keyboardNavigation = {
        scrollUpKey: 'k',
        scrollDownKey: 'j',
        focusInputKey: 'i',
      };
      const plugin = createMockPlugin({
        settings: {
          ...createMockPlugin().settings,
          keyboardNavigation,
        },
      });
      const { NavigationController } = jest.requireMock('@/features/chat/controllers/NavigationController');
      const options = createMockOptions({ plugin });
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, plugin);
      initializeTabControllers(tab, plugin, mockComponent);

      const constructorCall = NavigationController.mock.calls[0];
      const config = constructorCall[0];

      expect(config.getSettings()).toEqual(keyboardNavigation);
    });
  });

  describe('ConversationController configuration', () => {
    it('should wire getHistoryDropdown to return null (tab has no dropdown)', () => {
      const { ConversationController } = jest.requireMock('@/features/chat/controllers/ConversationController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = ConversationController.mock.calls[0];
      const config = constructorCall[0];

      expect(config.getHistoryDropdown()).toBeNull();
    });

    it('should wire welcome element getters and setters', () => {
      const { ConversationController } = jest.requireMock('@/features/chat/controllers/ConversationController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = ConversationController.mock.calls[0];
      const config = constructorCall[0];

      // Test getter - use mock element
      const mockWelcome = { id: 'welcome-el' } as any;
      tab.dom.welcomeEl = mockWelcome;
      expect(config.getWelcomeEl()).toBe(mockWelcome);

      // Test setter
      const newWelcomeEl = { id: 'new-welcome-el' } as any;
      config.setWelcomeEl(newWelcomeEl);
      expect(tab.dom.welcomeEl).toBe(newWelcomeEl);
    });

    it('should reset slash-command cache across conversation lifecycle events', () => {
      const { ConversationController } = jest.requireMock('@/features/chat/controllers/ConversationController');
      const options = createMockOptions();
      const tab = createTab(options);
      const mockComponent = {} as any;

      initializeTabUI(tab, options.plugin);
      initializeTabControllers(tab, options.plugin, mockComponent);

      const constructorCall = ConversationController.mock.calls[0];
      const callbacks = constructorCall[1];

      callbacks.onNewConversation();
      callbacks.onConversationLoaded();
      callbacks.onConversationSwitched();

      expect(mockSlashCommandDropdown.resetSdkSkillsCache).toHaveBeenCalledTimes(3);
    });
  });
});

describe('Tab - First Send Binding', () => {
  it('derives provider from draft model on first send (Claude)', async () => {
    const mockEnsureReady = jest.fn().mockResolvedValue(true);
    const runtimeModule = jest.requireMock('@/providers/claude/runtime/ClaudeChatRuntime') as { ClaudeChatRuntime: jest.Mock };
    runtimeModule.ClaudeChatRuntime.mockImplementationOnce(() => createMockClaudeChatRuntime({ ensureReady: mockEnsureReady }));
    const createChatRuntimeSpy = jest.spyOn(ProviderRegistry, 'createChatRuntime')
      .mockReturnValue(createMockClaudeChatRuntime() as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));

    tab.draftModel = 'sonnet';
    tab.lifecycleState = 'blank';

    await initializeTabService(tab, plugin, createMockMcpManager());

    expect(createChatRuntimeSpy).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'claude',
    }));
    expect(tab.lifecycleState).toBe('bound_active');
    expect(tab.draftModel).toBeNull();
  });

  it('derives provider from draft model on first send (Codex)', async () => {
    const createChatRuntimeSpy = jest.spyOn(ProviderRegistry, 'createChatRuntime')
      .mockReturnValue(createMockClaudeChatRuntime({ providerId: 'codex' }) as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));

    tab.draftModel = DEFAULT_CODEX_PRIMARY_MODEL;
    tab.providerId = 'codex';
    tab.lifecycleState = 'blank';

    await initializeTabService(tab, plugin, createMockMcpManager());

    expect(createChatRuntimeSpy).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'codex',
    }));
    expect(tab.lifecycleState).toBe('bound_active');
    expect(tab.draftModel).toBeNull();
  });
});


describe('Tab - History Bind Without Runtime', () => {
  it('ensureServiceForConversation binds to bound_cold without starting runtime', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);
    initializeTabControllers(tab, plugin, {} as any);

    const convCtrlModule = jest.requireMock('@/features/chat/controllers/ConversationController') as {
      ConversationController: jest.Mock;
    };
    const deps = convCtrlModule.ConversationController.mock.calls.at(-1)?.[0];
    const ensureServiceForConversation = deps?.ensureServiceForConversation;

    const conversation = {
      id: 'conv-history',
      providerId: 'codex' as const,
      messages: [{ id: 'msg-1', role: 'user' as const, content: 'hi', timestamp: Date.now() }],
    };

    await ensureServiceForConversation(conversation);

    expect(tab.lifecycleState).toBe('bound_cold');
    expect(tab.providerId).toBe('codex');
    expect(tab.conversationId).toBe('conv-history');
    expect(tab.draftModel).toBeNull();
    // No runtime created
    expect(tab.serviceInitialized).toBe(false);
  });

  it('ensureServiceForConversation updates hidden commands when the provider changes', async () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

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
    initializeTabControllers(
      tab,
      plugin,
      {} as any,
      undefined,
      undefined,
      () => (
        tab.providerId === 'codex'
          ? {
            config: codexCatalog.getDropdownConfig(),
            getEntries: managerGetEntries,
          }
          : null
      ),
    );

    const setProviderCatalogSpy = jest.fn();
    const setHiddenCommandsSpy = jest.fn();
    tab.ui.slashCommandDropdown!.setProviderCatalog = setProviderCatalogSpy;
    tab.ui.slashCommandDropdown!.setHiddenCommands = setHiddenCommandsSpy;

    const convCtrlModule = jest.requireMock('@/features/chat/controllers/ConversationController') as {
      ConversationController: jest.Mock;
    };
    const deps = convCtrlModule.ConversationController.mock.calls.at(-1)?.[0];
    const ensureServiceForConversation = deps?.ensureServiceForConversation;

    await ensureServiceForConversation({
      id: 'conv-history',
      providerId: 'codex' as const,
      messages: [{ id: 'msg-1', role: 'user' as const, content: 'hi', timestamp: Date.now() }],
    });

    expect(setProviderCatalogSpy).toHaveBeenCalledTimes(1);
    expect(setHiddenCommandsSpy).toHaveBeenCalledWith(new Set(['analyze']));
    const [, getEntries] = setProviderCatalogSpy.mock.calls[0];
    await getEntries();
    expect(managerGetEntries).toHaveBeenCalledTimes(1);
    expect(codexCatalog.listDropdownEntries).not.toHaveBeenCalled();
  });
});


describe('Tab - InputController getTabProviderId wiring', () => {
  it('wires getTabProviderId to InputController deps', () => {
    jest.spyOn(ProviderRegistry, 'createInstructionRefineService').mockReturnValue({ cancel: jest.fn(), resetConversation: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService').mockReturnValue({ cancel: jest.fn() } as any);
    jest.spyOn(ProviderRegistry, 'getTaskResultInterpreter').mockReturnValue({} as any);

    const plugin = createMockPlugin();
    const tab = createTab(createMockOptions({ plugin }));
    initializeTabUI(tab, plugin);
    initializeTabControllers(tab, plugin, {} as any);

    const { InputController } = jest.requireMock('@/features/chat/controllers/InputController') as { InputController: jest.Mock };
    const lastCall = InputController.mock.calls[InputController.mock.calls.length - 1];
    const config = lastCall[0];
    expect(config.getTabProviderId).toBeDefined();
    expect(typeof config.getTabProviderId).toBe('function');

    // For a blank tab with default model, should resolve to claude
    const result = config.getTabProviderId();
    expect(result).toBe('claude');
  });
});

