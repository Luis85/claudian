/**
 * Shared, pure test fixtures for the Tab.*.test.ts sibling specs.
 *
 * This kit holds only reusable, side-effect-free helpers: the `createMock*`
 * factories, plugin/MCP/options builders, the `TestTabCreateOptions` type, and
 * the jsdom ResizeObserver shim. It intentionally contains NO `jest.mock(...)`
 * calls — module mocking is hoisted per-file, so each sibling declares its own
 * `let mock*` bindings and `jest.mock(...)` blocks (whose factories call these
 * `createMock*` builders lazily, at mock-instantiation time).
 */
import { createMockEl } from '@test/helpers/mockElement';

import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { type TabCreateOptions } from '@/features/chat/tabs/Tab';

// Mock ResizeObserver (not available in jsdom). Each sibling installs it once at
// module scope via installMockResizeObserver().
export const resizeObserverInstances: MockResizeObserver[] = [];

export class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObserverInstances.push(this);
  }
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

export function installMockResizeObserver(): void {
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

// Mock factories must be defined before jest.mock calls due to hoisting.
// These are initialized fresh per mock instantiation in the sibling specs.
export const createMockFileContextManager = () => ({
  setMcpManager: jest.fn(),
  setAgentService: jest.fn(),
  setOnMcpMentionChange: jest.fn(),
  preScanExternalContexts: jest.fn(),
  handleInputChange: jest.fn(),
  handleMentionKeydown: jest.fn().mockReturnValue(false),
  isMentionDropdownVisible: jest.fn().mockReturnValue(false),
  hideMentionDropdown: jest.fn(),
  destroy: jest.fn(),
});

export const createMockImageContextManager = () => ({
  destroy: jest.fn(),
  clearImages: jest.fn(),
  setEnabled: jest.fn(),
});

export const createMockSlashCommandDropdown = () => ({
  handleKeydown: jest.fn().mockReturnValue(false),
  isVisible: jest.fn().mockReturnValue(false),
  hide: jest.fn(),
  resetSdkSkillsCache: jest.fn(),
  setHiddenCommands: jest.fn(),
  setEnabled: jest.fn(),
  destroy: jest.fn(),
});

export const createMockInstructionModeManager = () => ({
  handleTriggerKey: jest.fn().mockReturnValue(false),
  handleKeydown: jest.fn().mockReturnValue(false),
  handleInputChange: jest.fn(),
  isActive: jest.fn().mockReturnValue(false),
  destroy: jest.fn(),
});

export const createMockBangBashModeManager = () => ({
  handleTriggerKey: jest.fn().mockReturnValue(false),
  handleKeydown: jest.fn().mockReturnValue(false),
  handleInputChange: jest.fn(),
  isActive: jest.fn().mockReturnValue(false),
  destroy: jest.fn(),
});

export const createMockStatusPanel = () => ({
  mount: jest.fn(),
  remount: jest.fn(),
  updateTodos: jest.fn(),
  destroy: jest.fn(),
});

export const createMockModelSelector = () => ({
  updateDisplay: jest.fn(),
  renderOptions: jest.fn(),
  setReady: jest.fn(),
});

export const createMockModeSelector = () => ({
  updateDisplay: jest.fn(),
  renderOptions: jest.fn(),
});

export const createMockClaudianService = (overrides?: {
  ensureReady?: jest.Mock;
  syncConversationState?: jest.Mock;
  onReadyStateChange?: jest.Mock;
  providerId?: 'claude' | 'codex';
}) => ({
  providerId: overrides?.providerId ?? 'claude',
  ensureReady: overrides?.ensureReady ?? jest.fn().mockResolvedValue(true),
  cleanup: jest.fn(),
  isReady: jest.fn().mockReturnValue(false),
  getCapabilities: jest.fn().mockReturnValue({
    providerId: overrides?.providerId ?? 'claude',
    supportsPersistentRuntime: true,
    supportsNativeHistory: true,
    supportsPlanMode: true,
    supportsRewind: true,
    supportsFork: true,
    supportsProviderCommands: true,
    supportsImageAttachments: true,
    supportsInstructionMode: true,
    supportsMcpTools: true,
    reasoningControl: 'effort',
  }),
  syncConversationState: overrides?.syncConversationState ?? jest.fn(),
  onReadyStateChange: overrides?.onReadyStateChange ?? jest.fn((listener: (ready: boolean) => void) => {
    listener(false);
    return () => {};
  }),
});

export const createMockThinkingBudgetSelector = () => ({
  updateDisplay: jest.fn(),
});

export const createMockContextUsageMeter = () => ({
  update: jest.fn(),
  setVisible: jest.fn(),
});

export const createMockExternalContextSelector = () => ({
  getExternalContexts: jest.fn().mockReturnValue([]),
  setOnChange: jest.fn(),
  setPersistentPaths: jest.fn(),
  setOnPersistenceChange: jest.fn(),
});

export const createMockMcpServerSelector = () => ({
  setMcpManager: jest.fn(),
  addMentionedServers: jest.fn(),
  clearEnabled: jest.fn(),
  setVisible: jest.fn(),
});

export const createMockPermissionToggle = () => ({
  setVisible: jest.fn(),
  updateDisplay: jest.fn(),
});

export const createMockServiceTierToggle = () => ({
  updateDisplay: jest.fn(),
});

export const createMockSelectionController = () => ({
  start: jest.fn(),
  stop: jest.fn(),
  clear: jest.fn(),
  showHighlight: jest.fn(),
  updateContextRowVisibility: jest.fn(),
});

export const createMockBrowserSelectionController = () => ({
  start: jest.fn(),
  stop: jest.fn(),
  clear: jest.fn(),
  updateContextRowVisibility: jest.fn(),
});

export const createMockCanvasSelectionController = () => ({
  start: jest.fn(),
  stop: jest.fn(),
  clear: jest.fn(),
  updateContextRowVisibility: jest.fn(),
});

export const createMockInputController = () => ({
  sendMessage: jest.fn(),
  cancelStreaming: jest.fn(),
  handleInstructionSubmit: jest.fn(),
  updateQueueIndicator: jest.fn(),
  handleResumeKeydown: jest.fn().mockReturnValue(false),
  isResumeDropdownVisible: jest.fn().mockReturnValue(false),
  destroyResumeDropdown: jest.fn(),
  dismissPendingApproval: jest.fn(),
});

// Helper to create mock plugin
export function createMockPlugin(overrides: Record<string, any> = {}): any {
  const claudeAgentMentionProvider = { searchAgents: jest.fn().mockReturnValue([]) };
  const codexAgentMentionProvider = { searchAgents: jest.fn().mockReturnValue([]) };
  return {
    app: {
      vault: {
        adapter: { basePath: '/test/vault' },
      },
    },
    settings: {
      excludedTags: [],
      model: 'claude-sonnet-4-5',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
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
      },
      savedProviderEffort: {
        claude: 'high',
      },
      savedProviderServiceTier: {
        claude: 'default',
      },
      savedProviderThinkingBudget: {
        claude: 'low',
      },
    },
    mcpManager: { getMcpServers: jest.fn().mockReturnValue([]) },
    agentManager: claudeAgentMentionProvider,
    codexAgentMentionProvider,
    getConversationById: jest.fn().mockResolvedValue(null),
    getConversationSync: jest.fn().mockReturnValue(null),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    ...overrides,
  };
}

// Helper to create mock MCP manager
export function createMockMcpManager(): any {
  return {
    getMcpServers: jest.fn().mockReturnValue([]),
  };
}

export type TestTabCreateOptions = TabCreateOptions & {
  mcpManager: ReturnType<typeof createMockMcpManager>;
};

// Helper to create TabCreateOptions
export function createMockOptions(overrides: Partial<TestTabCreateOptions> = {}): TestTabCreateOptions {
  const options = {
    plugin: createMockPlugin(),
    mcpManager: createMockMcpManager(),
    containerEl: createMockEl(),
    ...overrides,
  } as TestTabCreateOptions;

  const plugin = options.plugin as any;
  ProviderWorkspaceRegistry.setServices('claude', {
    mcpManager: plugin.mcpManager,
    mcpServerManager: plugin.mcpManager,
    agentMentionProvider: plugin.agentManager,
  } as any);
  ProviderWorkspaceRegistry.setServices('codex', {
    agentMentionProvider: plugin.codexAgentMentionProvider,
  } as any);

  return options;
}
