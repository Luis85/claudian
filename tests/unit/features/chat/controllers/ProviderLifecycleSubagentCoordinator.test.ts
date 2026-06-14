import type { ProviderSubagentLifecycleAdapter } from '@/core/providers/types';
import type { ChatMessage, ToolCallInfo } from '@/core/types';
import {
  ProviderLifecycleSubagentCoordinator,
  type ProviderLifecycleSubagentCoordinatorDeps,
} from '@/features/chat/controllers/ProviderLifecycleSubagentCoordinator';

function setup(overrides: Partial<ProviderLifecycleSubagentCoordinatorDeps> = {}) {
  const deps: ProviderLifecycleSubagentCoordinatorDeps = {
    plugin: { app: {} } as never,
    state: { currentContentEl: null },
    findToolCall: jest.fn().mockReturnValue(undefined),
    normalizeToolResultContent: (c) => String(c),
    getSubagentLifecycleAdapter: jest.fn().mockReturnValue(null),
    flushPendingTools: jest.fn(),
    ...overrides,
  };
  return { coordinator: new ProviderLifecycleSubagentCoordinator(deps), deps };
}

const msg = (): ChatMessage => ({ id: 'm', role: 'assistant', content: '', timestamp: 0 } as ChatMessage);

function spawnAdapter(): ProviderSubagentLifecycleAdapter {
  return {
    isSpawnTool: (name: string) => name === 'spawn',
    isHiddenTool: () => false,
    isWaitTool: () => false,
    isCloseTool: () => false,
    buildSubagentInfo: () => ({ id: 's', description: 'd', prompt: 'p', status: 'running', toolCalls: [] }),
    extractSpawnResult: () => ({ agentId: undefined }),
    resolveSpawnToolIds: () => [],
  } as never;
}

describe('ProviderLifecycleSubagentCoordinator.dispatchToolUse', () => {
  it('declines when the provider exposes no lifecycle adapter', () => {
    const { coordinator } = setup();
    const handled = coordinator.dispatchToolUse(
      { type: 'tool_use', id: 't1', name: 'anything', input: {} },
      msg(),
    );
    expect(handled).toBe(false);
  });

  it('claims a provider spawn tool (no content element → tracks tool call only)', () => {
    const { coordinator } = setup({ getSubagentLifecycleAdapter: () => spawnAdapter() });
    const m = msg();
    const handled = coordinator.dispatchToolUse(
      { type: 'tool_use', id: 't2', name: 'spawn', input: {} },
      m,
    );
    expect(handled).toBe(true);
    expect(m.toolCalls?.some((tc: ToolCallInfo) => tc.id === 't2')).toBe(true);
  });
});

describe('ProviderLifecycleSubagentCoordinator.handleProviderSubagentResult', () => {
  it('declines a result with no matching tool call', () => {
    const { coordinator } = setup();
    const handled = coordinator.handleProviderSubagentResult(
      { type: 'tool_result', id: 'r1', content: 'x' },
      msg(),
    );
    expect(handled).toBe(false);
  });

  it('declines when the matching tool call is not a lifecycle tool', () => {
    const toolCall = { id: 'r2', name: 'Bash', input: {}, status: 'running', isExpanded: false } as ToolCallInfo;
    const { coordinator } = setup({
      findToolCall: () => toolCall,
      getSubagentLifecycleAdapter: () => null,
    });
    const handled = coordinator.handleProviderSubagentResult(
      { type: 'tool_result', id: 'r2', content: 'x' },
      msg(),
    );
    expect(handled).toBe(false);
  });
});
