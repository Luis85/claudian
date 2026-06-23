import '@/providers';

import { Notice } from 'obsidian';

import {
  createTab,
  initializeTabControllers,
  initializeTabUI,
  maybeWarnYoloMode,
} from '@/features/chat/tabs/Tab';

import {
  createMockBrowserSelectionController,
  createMockCanvasSelectionController,
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

jest.mock('@/features/chat/ui/FileContext', () => ({
  FileContextManager: jest.fn().mockImplementation(() => createMockFileContextManager()),
}));

jest.mock('@/features/chat/ui/ImageContext', () => ({
  ImageContextManager: jest.fn().mockImplementation(() => createMockImageContextManager()),
}));

jest.mock('@/features/chat/ui/InstructionModeManager', () => ({
  InstructionModeManager: jest.fn().mockImplementation(() => createMockInstructionModeManager()),
}));

jest.mock('@/features/chat/ui/StatusPanel', () => ({
  StatusPanel: jest.fn().mockImplementation(() => createMockStatusPanel()),
}));

jest.mock('@/features/chat/ui/InputToolbar', () => ({
  createInputToolbar: jest.fn().mockImplementation(() => ({
    modelSelector: createMockModelSelector(),
    modeSelector: createMockModeSelector(),
    thinkingBudgetSelector: createMockThinkingBudgetSelector(),
    contextUsageMeter: createMockContextUsageMeter(),
    externalContextSelector: createMockExternalContextSelector(),
    mcpServerSelector: createMockMcpServerSelector(),
    permissionToggle: createMockPermissionToggle(),
    serviceTierToggle: createMockServiceTierToggle(),
    gitActionButton: null,
  })),
}));

jest.mock('@/shared/components/SlashCommandDropdown', () => ({
  SlashCommandDropdown: jest.fn().mockImplementation(() => createMockSlashCommandDropdown()),
}));

// Mock rendering
jest.mock('@/features/chat/rendering/MessageRenderer', () => ({
  MessageRenderer: jest.fn().mockImplementation(() => ({
    scrollToBottomIfNeeded: jest.fn(),
    setAsyncSubagentClickCallback: jest.fn(),
  })),
}));

jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  cleanupThinkingBlock: jest.fn(),
}));

// Mock controllers
jest.mock('@/features/chat/controllers/SelectionController', () => ({
  SelectionController: jest.fn().mockImplementation(() => createMockSelectionController()),
}));

jest.mock('@/features/chat/controllers/BrowserSelectionController', () => ({
  BrowserSelectionController: jest.fn().mockImplementation(() => createMockBrowserSelectionController()),
}));

jest.mock('@/features/chat/controllers/CanvasSelectionController', () => ({
  CanvasSelectionController: jest.fn().mockImplementation(() => createMockCanvasSelectionController()),
}));

jest.mock('@/features/chat/controllers/StreamController', () => ({
  StreamController: jest.fn().mockImplementation(() => ({ onAsyncSubagentStateChange: jest.fn() })),
}));

jest.mock('@/features/chat/controllers/ConversationController', () => ({
  ConversationController: jest.fn().mockImplementation(() => ({
    save: jest.fn().mockResolvedValue(undefined),
    rewind: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@/features/chat/controllers/InputController', () => ({
  InputController: jest.fn().mockImplementation(() => createMockInputController()),
}));

jest.mock('@/features/chat/controllers/NavigationController', () => ({
  NavigationController: jest.fn().mockImplementation(() => ({ initialize: jest.fn(), dispose: jest.fn() })),
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

const mockNotice = Notice as jest.Mock;

describe('Tab - handleForkRequest', () => {

  function setupForkTest(overrides: Record<string, any> = {}) {
    const options = createMockOptions(overrides);
    const tab = createTab(options);
    const mockComponent = {} as any;
    const forkRequestCallback = jest.fn().mockResolvedValue(undefined);

    initializeTabUI(tab, options.plugin);
    initializeTabControllers(tab, options.plugin, mockComponent, forkRequestCallback);

    // Extract the fork callback from the MessageRenderer constructor
    const { MessageRenderer } = jest.requireMock('@/features/chat/rendering/MessageRenderer') as { MessageRenderer: jest.Mock };
    const lastCall = MessageRenderer.mock.calls[MessageRenderer.mock.calls.length - 1];
    const forkCallback = lastCall[3].forkCallback;

    return { tab, forkCallback, forkRequestCallback, plugin: options.plugin };
  }

  beforeEach(() => {
    mockNotice.mockClear();
  });

  it('should show notice when streaming', async () => {
    const { tab, forkCallback } = setupForkTest();

    tab.state.isStreaming = true;
    tab.state.messages = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
    ];

    await forkCallback('u1');

    expect(mockNotice).toHaveBeenCalled();
  });

  it('should show notice when message ID not found', async () => {
    const { forkCallback, forkRequestCallback } = setupForkTest();

    await forkCallback('nonexistent');

    expect(forkRequestCallback).not.toHaveBeenCalled();
    expect(mockNotice).toHaveBeenCalledWith('Fork failed: Message not found');
  });

  it('should show notice when user message has no userMessageId', async () => {
    const { tab, forkCallback, forkRequestCallback } = setupForkTest();

    tab.state.messages = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1 },
    ];

    await forkCallback('u1');

    expect(mockNotice).toHaveBeenCalled();
    expect(forkRequestCallback).not.toHaveBeenCalled();
  });

  it('should show notice when no assistant response follows the user message', async () => {
    const { tab, forkCallback, forkRequestCallback } = setupForkTest();

    // User message without a following assistant response with UUID
    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      // No assistant response after u1
    ];

    await forkCallback('u1');

    expect(mockNotice).toHaveBeenCalled();
    expect(forkRequestCallback).not.toHaveBeenCalled();
  });

  it('should show notice when no session ID is available', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue(null),
    });
    const { tab, forkCallback, forkRequestCallback } = setupForkTest({ plugin });

    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
    ];
    // No service and no conversation
    tab.service = null;

    await forkCallback('u1');

    expect(mockNotice).toHaveBeenCalled();
    expect(forkRequestCallback).not.toHaveBeenCalled();
  });

  it('should call forkRequestCallback with correct ForkContext on success', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({
        title: 'My Conversation',
        currentNote: 'notes/test.md',
      }),
    });
    const { tab, forkCallback, forkRequestCallback } = setupForkTest({ plugin });

    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
      { id: 'u2', role: 'user', content: 'world', timestamp: 4, userMessageId: 'user-u2' },
      { id: 'a2', role: 'assistant', content: 'resp2', timestamp: 5, assistantMessageId: 'asst-2' },
    ];

    // Service has a session ID
    tab.service = {
      getSessionId: jest.fn().mockReturnValue('session-abc'),
      resolveSessionIdForFork: jest.fn().mockReturnValue('session-abc'),
    } as any;
    tab.conversationId = 'conv-1';

    await forkCallback('u2');

    expect(forkRequestCallback).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'session-abc',
      resumeAt: 'asst-1', // prev assistant UUID before u2
      sourceTitle: 'My Conversation',
      currentNote: 'notes/test.md',
      forkAtUserMessage: 2, // u2 is the 2nd user message
    }));

    // Messages should be deep-cloned and sliced before the fork point
    const ctx = forkRequestCallback.mock.calls[0][0];
    expect(ctx.messages).toHaveLength(3); // a0, u1, a1 (before u2)
    expect(ctx.messages.map((m: any) => m.id)).toEqual(['a0', 'u1', 'a1']);
  });

  it('should fall back to conversation session ID when service has none', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({
        providerState: { providerSessionId: 'conv-session-xyz' },
        title: 'Fallback Chat',
      }),
    });
    const { tab, forkCallback, forkRequestCallback } = setupForkTest({ plugin });

    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
    ];
    tab.service = null;
    tab.conversationId = 'conv-1';

    await forkCallback('u1');

    expect(forkRequestCallback).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'conv-session-xyz',
    }));
  });

  it('should produce deep-cloned messages that do not share references with originals', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({ title: 'Test' }),
    });
    const { tab, forkCallback, forkRequestCallback } = setupForkTest({ plugin });

    const originalMsg = { id: 'a0', role: 'assistant' as const, content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' };
    tab.state.messages = [
      originalMsg,
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
    ];
    tab.service = { getSessionId: jest.fn().mockReturnValue('session-1'), resolveSessionIdForFork: jest.fn().mockReturnValue('session-1') } as any;
    tab.conversationId = 'conv-1';

    await forkCallback('u1');

    const ctx = forkRequestCallback.mock.calls[0][0];
    // Deep clone should not share references
    expect(ctx.messages[0]).not.toBe(originalMsg);
    expect(ctx.messages[0]).toEqual(originalMsg);
  });

  it('should fork at first user message with empty messages before fork', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({ title: 'First Fork' }),
    });
    const { tab, forkCallback, forkRequestCallback } = setupForkTest({ plugin });

    tab.state.messages = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u1' },
      { id: 'a1', role: 'assistant', content: 'hi', timestamp: 2, assistantMessageId: 'asst-1' },
    ];
    tab.service = { getSessionId: jest.fn().mockReturnValue('session-1'), resolveSessionIdForFork: jest.fn().mockReturnValue('session-1') } as any;
    tab.conversationId = 'conv-1';

    await forkCallback('u1');

    // No assistant message before u1, so findRewindContext returns no prevAssistantUuid
    expect(forkRequestCallback).not.toHaveBeenCalled();
    expect(mockNotice).toHaveBeenCalled();
  });

  it('should fall back to conversation forkSource.sessionId when no sessionId or providerSessionId', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({
        title: 'Nested Fork',
        providerState: { forkSource: { sessionId: 'original-source-session', resumeAt: 'asst-prev' } },
      }),
    });
    const { tab, forkCallback, forkRequestCallback } = setupForkTest({ plugin });

    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
    ];
    tab.service = null;
    tab.conversationId = 'conv-1';

    await forkCallback('u1');

    expect(forkRequestCallback).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'original-source-session',
    }));
  });

  it('should prefer service session ID over conversation metadata', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({
        title: 'Test',
        providerState: { providerSessionId: 'conv-session' },
        sessionId: 'old-session',
      }),
    });
    const { tab, forkCallback, forkRequestCallback } = setupForkTest({ plugin });

    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
    ];
    tab.service = { getSessionId: jest.fn().mockReturnValue('service-session'), resolveSessionIdForFork: jest.fn().mockReturnValue('service-session') } as any;
    tab.conversationId = 'conv-1';

    await forkCallback('u1');

    expect(forkRequestCallback).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'service-session',
    }));
  });

  it('should set forkAtUserMessage to 1 for the first user message', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({ title: 'Test' }),
    });
    const { tab, forkCallback, forkRequestCallback } = setupForkTest({ plugin });

    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u1' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
    ];
    tab.service = { getSessionId: jest.fn().mockReturnValue('session-1'), resolveSessionIdForFork: jest.fn().mockReturnValue('session-1') } as any;
    tab.conversationId = 'conv-1';

    await forkCallback('u1');

    expect(forkRequestCallback).toHaveBeenCalledWith(expect.objectContaining({
      forkAtUserMessage: 1,
    }));
  });

  it('should not set forkCallback on renderer when no forkRequestCallback provided', () => {
    const options = createMockOptions();
    const tab = createTab(options);
    const mockComponent = {} as any;

    initializeTabUI(tab, options.plugin);
    initializeTabControllers(tab, options.plugin, mockComponent);

    const { MessageRenderer } = jest.requireMock('@/features/chat/rendering/MessageRenderer') as { MessageRenderer: jest.Mock };
    const lastCall = MessageRenderer.mock.calls[MessageRenderer.mock.calls.length - 1];
    const forkCallback = lastCall[3].forkCallback;

    expect(forkCallback).toBeUndefined();
  });
});

describe('Tab - handleForkAll (via /fork command)', () => {

  function setupForkAllTest(overrides: Record<string, any> = {}) {
    const options = createMockOptions(overrides);
    const tab = createTab(options);
    const mockComponent = {} as any;
    const forkRequestCallback = jest.fn().mockResolvedValue(undefined);

    initializeTabUI(tab, options.plugin);
    initializeTabControllers(tab, options.plugin, mockComponent, forkRequestCallback);

    // Extract onForkAll from InputController constructor call
    const { InputController } = jest.requireMock('@/features/chat/controllers/InputController') as { InputController: jest.Mock };
    const lastCall = InputController.mock.calls[InputController.mock.calls.length - 1];
    const config = lastCall[0];
    const onForkAll = config.onForkAll as (() => Promise<void>) | undefined;

    return { tab, onForkAll: onForkAll!, forkRequestCallback, plugin: options.plugin };
  }

  beforeEach(() => {
    mockNotice.mockClear();
  });

  it('should call forkRequestCallback with all messages and last assistant UUID', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({
        title: 'My Conversation',
        currentNote: 'notes/test.md',
      }),
    });
    const { tab, onForkAll, forkRequestCallback } = setupForkAllTest({ plugin });

    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u1' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
      { id: 'u2', role: 'user', content: 'world', timestamp: 4, userMessageId: 'user-u2' },
      { id: 'a2', role: 'assistant', content: 'resp2', timestamp: 5, assistantMessageId: 'asst-2' },
    ];
    tab.service = { getSessionId: jest.fn().mockReturnValue('session-abc'), resolveSessionIdForFork: jest.fn().mockReturnValue('session-abc') } as any;
    tab.conversationId = 'conv-1';

    await onForkAll();

    expect(forkRequestCallback).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'session-abc',
      resumeAt: 'asst-2', // last assistant UUID
      sourceTitle: 'My Conversation',
      currentNote: 'notes/test.md',
    }));

    const ctx = forkRequestCallback.mock.calls[0][0];
    expect(ctx.messages).toHaveLength(5); // all messages
    expect(ctx.messages.map((m: any) => m.id)).toEqual(['a0', 'u1', 'a1', 'u2', 'a2']);
    expect(ctx.forkAtUserMessage).toBe(3); // 2 user messages + 1
  });

  it('should include trailing user + interrupt messages and not count interrupt for fork number', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({
        title: 'My Conversation',
        currentNote: 'notes/test.md',
      }),
    });
    const { tab, onForkAll, forkRequestCallback } = setupForkAllTest({ plugin });

    tab.state.messages = [
      { id: 'a0', role: 'assistant', content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u1' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
      { id: 'u2', role: 'user', content: 'world', timestamp: 4, userMessageId: 'user-u2' },
      { id: 'a2', role: 'assistant', content: 'resp2', timestamp: 5, assistantMessageId: 'asst-2' },
      { id: 'u3', role: 'user', content: 'more', timestamp: 6, userMessageId: 'user-u3' },
      { id: 'int-1', role: 'user', content: '[Request interrupted by user]', timestamp: 7, userMessageId: 'user-int', isInterrupt: true },
    ];
    tab.service = { getSessionId: jest.fn().mockReturnValue('session-abc'), resolveSessionIdForFork: jest.fn().mockReturnValue('session-abc') } as any;
    tab.conversationId = 'conv-1';

    await onForkAll();

    expect(forkRequestCallback).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'session-abc',
      resumeAt: 'asst-2',
      forkAtUserMessage: 4, // u1, u2, u3 + 1 (interrupt excluded)
    }));

    const ctx = forkRequestCallback.mock.calls[0][0];
    expect(ctx.messages).toHaveLength(7);
    expect(ctx.messages.map((m: any) => m.id)).toEqual(['a0', 'u1', 'a1', 'u2', 'a2', 'u3', 'int-1']);
  });

  it('should show notice when streaming', async () => {
    const { tab, onForkAll, forkRequestCallback } = setupForkAllTest();

    tab.state.isStreaming = true;
    tab.state.messages = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 2, assistantMessageId: 'asst-1' },
    ];

    await onForkAll();

    expect(mockNotice).toHaveBeenCalled();
    expect(forkRequestCallback).not.toHaveBeenCalled();
  });

  it('should show notice when no messages', async () => {
    const { tab, onForkAll, forkRequestCallback } = setupForkAllTest();

    tab.state.messages = [];

    await onForkAll();

    expect(mockNotice).toHaveBeenCalledWith('Cannot fork: no messages in conversation');
    expect(forkRequestCallback).not.toHaveBeenCalled();
  });

  it('should show notice when no assistant message has assistantMessageId', async () => {
    const { tab, onForkAll, forkRequestCallback } = setupForkAllTest();

    tab.state.messages = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 2 },
    ];

    await onForkAll();

    expect(mockNotice).toHaveBeenCalledWith('Cannot fork: no assistant response with identifiers');
    expect(forkRequestCallback).not.toHaveBeenCalled();
  });

  it('should show notice when no session ID is available', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue(null),
    });
    const { tab, onForkAll, forkRequestCallback } = setupForkAllTest({ plugin });

    tab.state.messages = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 2, assistantMessageId: 'asst-1' },
    ];
    tab.service = null;

    await onForkAll();

    expect(mockNotice).toHaveBeenCalled();
    expect(forkRequestCallback).not.toHaveBeenCalled();
  });

  it('should fall back to conversation session ID when service has none', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({
        providerState: { providerSessionId: 'conv-session-xyz' },
        title: 'Fallback Chat',
      }),
    });
    const { tab, onForkAll, forkRequestCallback } = setupForkAllTest({ plugin });

    tab.state.messages = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 2, assistantMessageId: 'asst-1' },
    ];
    tab.service = null;
    tab.conversationId = 'conv-1';

    await onForkAll();

    expect(forkRequestCallback).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'conv-session-xyz',
    }));
  });

  it('should deep-clone messages (not share references)', async () => {
    const plugin = createMockPlugin({
      getConversationSync: jest.fn().mockReturnValue({ title: 'Test' }),
    });
    const { tab, onForkAll, forkRequestCallback } = setupForkAllTest({ plugin });

    const originalMsg = { id: 'a0', role: 'assistant' as const, content: 'hi', timestamp: 1, assistantMessageId: 'asst-0' };
    tab.state.messages = [
      originalMsg,
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'asst-1' },
    ];
    tab.service = { getSessionId: jest.fn().mockReturnValue('session-1'), resolveSessionIdForFork: jest.fn().mockReturnValue('session-1') } as any;
    tab.conversationId = 'conv-1';

    await onForkAll();

    const ctx = forkRequestCallback.mock.calls[0][0];
    expect(ctx.messages[0]).not.toBe(originalMsg);
    expect(ctx.messages[0]).toEqual(originalMsg);
  });

  it('should not set onForkAll on InputController when no forkRequestCallback provided', () => {
    const options = createMockOptions();
    const tab = createTab(options);
    const mockComponent = {} as any;

    initializeTabUI(tab, options.plugin);
    initializeTabControllers(tab, options.plugin, mockComponent);

    const { InputController } = jest.requireMock('@/features/chat/controllers/InputController') as { InputController: jest.Mock };
    const lastCall = InputController.mock.calls[InputController.mock.calls.length - 1];
    const config = lastCall[0];
    expect(config.onForkAll).toBeUndefined();
  });
});

describe('maybeWarnYoloMode (SEC-1)', () => {
  beforeEach(() => {
    (Notice as jest.Mock).mockClear();
  });

  it('warns once when yolo is first selected and persists the flag', async () => {
    const plugin = createMockPlugin();
    plugin.settings.yoloModeWarningShown = false;

    await maybeWarnYoloMode(plugin, 'yolo');

    expect(Notice).toHaveBeenCalledTimes(1);
    expect(plugin.settings.yoloModeWarningShown).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('does not warn again once the flag is set', async () => {
    const plugin = createMockPlugin();
    plugin.settings.yoloModeWarningShown = true;

    await maybeWarnYoloMode(plugin, 'yolo');

    expect(Notice).not.toHaveBeenCalled();
  });

  it('never warns for non-yolo modes', async () => {
    const plugin = createMockPlugin();
    plugin.settings.yoloModeWarningShown = false;

    await maybeWarnYoloMode(plugin, 'normal');
    await maybeWarnYoloMode(plugin, 'plan');

    expect(Notice).not.toHaveBeenCalled();
    expect(plugin.settings.yoloModeWarningShown).toBe(false);
  });
});
