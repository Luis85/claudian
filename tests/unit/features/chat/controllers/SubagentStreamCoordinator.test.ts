import { TOOL_AGENT_OUTPUT, TOOL_TASK } from '@/core/tools/toolNames';
import type { ChatMessage } from '@/core/types';
import {
  SubagentStreamCoordinator,
  type SubagentStreamCoordinatorDeps,
} from '@/features/chat/controllers/SubagentStreamCoordinator';

function setup(overrides: Partial<SubagentStreamCoordinatorDeps> = {}) {
  const subagentManager = {
    handleTaskToolUse: jest.fn().mockReturnValue({ action: 'buffered' }),
    handleAgentOutputToolUse: jest.fn(),
    hasPendingTask: jest.fn().mockReturnValue(false),
    getSyncSubagent: jest.fn().mockReturnValue(undefined),
    isPendingAsyncTask: jest.fn().mockReturnValue(false),
    isLinkedAgentOutputTool: jest.fn().mockReturnValue(false),
    handleAgentOutputToolResult: jest.fn().mockReturnValue(undefined),
    hydrateNestedSyncToolsFromTaskResult: jest.fn(),
    renderPendingTaskFromTaskResult: jest.fn().mockReturnValue(undefined),
  } as never;
  const flushPendingTools = jest.fn();
  const showThinkingIndicator = jest.fn();

  const deps: SubagentStreamCoordinatorDeps = {
    state: { currentContentEl: null, messages: [] } as never,
    subagentManager,
    findToolCall: jest.fn().mockReturnValue(undefined),
    normalizeToolResultContent: (c) => String(c),
    flushPendingTools,
    showThinkingIndicator,
    scrollToBottom: jest.fn(),
    ...overrides,
  };

  return {
    coordinator: new SubagentStreamCoordinator(deps),
    subagentManager: subagentManager as never as { handleTaskToolUse: jest.Mock; handleAgentOutputToolUse: jest.Mock },
    flushPendingTools,
  };
}

const msg = (): ChatMessage => ({ id: 'm', role: 'assistant', content: '', timestamp: 0 } as ChatMessage);

describe('SubagentStreamCoordinator.dispatchToolUse', () => {
  it('claims a Task tool (flushes pending tools, routes via SubagentManager)', () => {
    const { coordinator, subagentManager, flushPendingTools } = setup();
    const handled = coordinator.dispatchToolUse(
      { type: 'tool_use', id: 't1', name: TOOL_TASK, input: {} },
      msg(),
    );
    expect(handled).toBe(true);
    expect(flushPendingTools).toHaveBeenCalled();
    expect(subagentManager.handleTaskToolUse).toHaveBeenCalled();
  });

  it('claims a TaskOutput (agent-output) tool', () => {
    const { coordinator, subagentManager } = setup();
    const handled = coordinator.dispatchToolUse(
      { type: 'tool_use', id: 't2', name: TOOL_AGENT_OUTPUT, input: {} },
      msg(),
    );
    expect(handled).toBe(true);
    expect(subagentManager.handleAgentOutputToolUse).toHaveBeenCalled();
  });

  it('declines a regular tool (lets StreamController handle it)', () => {
    const { coordinator, flushPendingTools } = setup();
    const handled = coordinator.dispatchToolUse(
      { type: 'tool_use', id: 't3', name: 'Bash', input: {} },
      msg(),
    );
    expect(handled).toBe(false);
    expect(flushPendingTools).not.toHaveBeenCalled();
  });
});

describe('SubagentStreamCoordinator.handleToolResult', () => {
  it('declines a result that belongs to no Task subagent', async () => {
    const { coordinator } = setup();
    const handled = await coordinator.handleToolResult(
      { type: 'tool_result', id: 'r1', content: 'ok' },
      msg(),
    );
    expect(handled).toBe(false);
  });

  it('claims an async task result', async () => {
    const subagentManager = {
      hasPendingTask: jest.fn().mockReturnValue(false),
      getSyncSubagent: jest.fn().mockReturnValue(undefined),
      isPendingAsyncTask: jest.fn().mockReturnValue(true),
      handleTaskToolResult: jest.fn(),
    } as never;
    const showThinkingIndicator = jest.fn();
    const { coordinator } = setup({ subagentManager, showThinkingIndicator });

    const handled = await coordinator.handleToolResult(
      { type: 'tool_result', id: 'r2', content: 'done' },
      msg(),
    );
    expect(handled).toBe(true);
    expect(showThinkingIndicator).toHaveBeenCalled();
  });
});
