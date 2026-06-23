import type { MockRuntimeHost } from '@test/helpers/runtimeHost';
import { Notice } from 'obsidian';

import { createResponseHandler } from '@/providers/claude/runtime/types';

import { setupSpecoratorServiceTest } from './specoratorServiceTestKit';

describe('SpecoratorService', () => {
  const ctx = setupSpecoratorServiceTest();
  let service: typeof ctx.service;
  let mockPlugin: typeof ctx.mockPlugin;
  let host: MockRuntimeHost;

  beforeEach(() => {
    ({ service, mockPlugin, host } = ctx);
  });

  describe('routeMessage', () => {
    let handler: ReturnType<typeof createResponseHandler>;
    let onChunk: jest.Mock;
    let onDone: jest.Mock;

    beforeEach(() => {
      onChunk = jest.fn();
      onDone = jest.fn();
      handler = createResponseHandler({
        id: 'route-test',
        onChunk,
        onDone,
        onError: jest.fn(),
      });
      (service as any).responseHandlers = [handler];
      (service as any).messageChannel = {
        onTurnComplete: jest.fn(),
        setSessionId: jest.fn(),
      };
    });

    it('should route session_init event and capture session', async () => {
      const message = { type: 'system', subtype: 'init', session_id: 'new-session-42' };

      await (service as any).routeMessage(message);

      expect(service.getSessionId()).toBe('new-session-42');
    });

    it('should route stream chunks to handler', async () => {
      const message = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      };

      await (service as any).routeMessage(message);

      expect(onChunk).toHaveBeenCalled();
    });

    it('should route task_notification completion to the active handler', async () => {
      await (service as any).routeMessage({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-123',
        status: 'completed',
        output_file: '/tmp/agent-123.output',
        summary: 'Agent completed successfully.',
        uuid: 'notification-1',
        session_id: 'session-1',
      });

      expect(onChunk).toHaveBeenCalledWith({
        type: 'async_subagent_result',
        agentId: 'agent-123',
        status: 'completed',
        result: 'Agent completed successfully.',
      });
    });

    it('should flush task_notification completion through auto-turn callback without waiting for a result message', async () => {
      (service as any).responseHandlers = [];
      const autoTurnCallback = host.autoTurn;

      await (service as any).routeMessage({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-456',
        status: 'completed',
        output_file: '/tmp/agent-456.output',
        summary: 'Background agent finished.',
        uuid: 'notification-2',
        session_id: 'session-1',
      });

      expect(autoTurnCallback).toHaveBeenCalledWith({
        chunks: [
          {
            type: 'async_subagent_result',
            agentId: 'agent-456',
            status: 'completed',
            result: 'Background agent finished.',
          },
        ],
        metadata: {},
      });
    });

    it('should route tool input deltas as tool_use updates', async () => {
      await (service as any).routeMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'stream-tool-1',
            name: 'Write',
            input: {},
          },
        },
      });
      await (service as any).routeMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"file_path":"notes.md"',
          },
        },
      });

      const toolChunks = onChunk.mock.calls
        .map(([chunk]) => chunk)
        .filter((chunk: any) => chunk.type === 'tool_use');

      expect(toolChunks).toEqual([
        {
          type: 'tool_use',
          id: 'stream-tool-1',
          name: 'Write',
          input: {},
        },
        {
          type: 'tool_use',
          id: 'stream-tool-1',
          name: 'Write',
          input: { file_path: 'notes.md' },
        },
      ]);
    });

    it('should signal turn complete on result message', async () => {
      const message = { type: 'result', subtype: 'success', result: 'completed' };

      await (service as any).routeMessage(message);

      expect((service as any).messageChannel.onTurnComplete).toHaveBeenCalled();
      expect(onDone).toHaveBeenCalled();
    });

    it('should yield error event from assistant message with error field', async () => {
      const message = { type: 'assistant', error: 'rate_limit', message: { content: [] } };

      await (service as any).routeMessage(message);

      expect(onChunk).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', content: 'rate_limit' }),
      );
    });

    it('should add sessionId to usage chunks', async () => {
      service.setSessionId('usage-session');
      const message = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
          },
        },
      };

      await (service as any).routeMessage(message);

      const usageChunks = onChunk.mock.calls.filter(
        ([chunk]: any) => chunk.type === 'usage'
      );
      expect(usageChunks.length).toBeGreaterThan(0);
      expect(usageChunks[0][0].sessionId).toBe('usage-session');
    });

    it('should mark stream text seen only after a visible stream text chunk', async () => {
      const message = {
        type: 'stream_event',
        event: { type: 'content_block_start', content_block: { type: 'text', text: 'Hello' } },
      };

      await (service as any).routeMessage(message);

      expect(handler.sawStreamText).toBe(true);
    });

    it('should not mark stream text seen for empty text deltas', async () => {
      const message = {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } },
      };

      await (service as any).routeMessage(message);

      expect(handler.sawStreamText).toBe(false);
    });

    it('should mark stream thinking seen only after a visible stream thinking chunk', async () => {
      const message = {
        type: 'stream_event',
        event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: 'Thinking...' } },
      };

      await (service as any).routeMessage(message);

      expect(handler.sawStreamThinking).toBe(true);
    });

    it('should not mark stream thinking seen for empty thinking deltas', async () => {
      const message = {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } },
      };

      await (service as any).routeMessage(message);

      expect(handler.sawStreamThinking).toBe(false);
    });

    it('should skip duplicate text from assistant messages after stream text', async () => {
      // First, mark stream text as seen
      handler.markStreamTextSeen();

      // Now send an assistant message with text content
      const message = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Streamed text' }] },
      };

      await (service as any).routeMessage(message);

      // Text chunks should be skipped
      const textChunks = onChunk.mock.calls.filter(
        ([chunk]: any) => chunk.type === 'text'
      );
      expect(textChunks).toHaveLength(0);
    });

    it('should skip duplicate thinking from assistant messages after visible stream thinking', async () => {
      await (service as any).routeMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'Reasoning...' },
        },
      });
      await (service as any).routeMessage({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'Reasoning...' }] },
      });

      const thinkingChunks = onChunk.mock.calls.filter(
        ([chunk]: any) => chunk.type === 'thinking'
      );
      expect(thinkingChunks).toHaveLength(1);
    });

    it('should keep assistant text when stream delta was empty', async () => {
      await (service as any).routeMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '' },
        },
      });
      await (service as any).routeMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Final text' }] },
      });

      const textChunks = onChunk.mock.calls.filter(
        ([chunk]: any) => chunk.type === 'text'
      );
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0][0].content).toBe('Final text');
    });

    it('should keep assistant thinking when stream delta was empty', async () => {
      await (service as any).routeMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: '' },
        },
      });
      await (service as any).routeMessage({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'Final thinking' }] },
      });

      const thinkingChunks = onChunk.mock.calls.filter(
        ([chunk]: any) => chunk.type === 'thinking'
      );
      expect(thinkingChunks).toHaveLength(1);
      expect(thinkingChunks[0][0].content).toBe('Final thinking');
    });

    it('should reset auto-turn stream-text dedup after a buffered turn completes', async () => {
      (service as any).responseHandlers = [];
      const autoTurnCallback = host.autoTurn;

      await (service as any).routeMessage({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'First chunk' } },
      });
      await (service as any).routeMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Deduped away' }] },
      });
      await (service as any).routeMessage({
        type: 'result',
        subtype: 'success',
        result: 'first turn complete',
      });

      await (service as any).routeMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Fresh auto-turn text' }] },
      });
      await (service as any).routeMessage({
        type: 'result',
        subtype: 'success',
        result: 'second turn complete',
      });

      expect(autoTurnCallback).toHaveBeenCalledTimes(2);
      expect(autoTurnCallback).toHaveBeenNthCalledWith(2, {
        chunks: [
          expect.objectContaining({ type: 'text', content: 'Fresh auto-turn text' }),
        ],
        metadata: {},
      });
    });

    it('should notify when auto-turn callback rendering fails', async () => {
      (service as any).responseHandlers = [];
      const callbackError = new Error('renderer exploded');
      host.autoTurn.mockImplementation(() => {
        throw callbackError;
      });

      await (service as any).routeMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Background result' }] },
      });
      await (service as any).routeMessage({
        type: 'result',
        subtype: 'success',
        result: 'turn complete',
      });

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Background task completed')
      );
    });

    it('should suppress history rebuild and clear pendingForkSession on fork session init', async () => {
      // Set an existing session so captureSession detects a mismatch
      service.setSessionId('old-session');

      // Apply fork state to mark as pending fork via syncConversationState
      service.syncConversationState({
        sessionId: null,
        providerState: { forkSource: { sessionId: 'old-session', resumeAt: 'asst-uuid-1' } },
      });
      expect((service as any).pendingForkSession).toBe(true);

      // Simulate session_init from SDK with a NEW session ID (fork creates a new session)
      const message = { type: 'system', subtype: 'init', session_id: 'forked-session-new' };
      await (service as any).routeMessage(message);

      // Session should be captured
      expect(service.getSessionId()).toBe('forked-session-new');
      // Fork path should suppress the history rebuild that captureSession would normally trigger
      expect((service as any).sessionManager.needsHistoryRebuild()).toBe(false);
      // pendingForkSession should be consumed (one-shot)
      expect((service as any).pendingForkSession).toBe(false);
    });

    it('should NOT suppress history rebuild for non-fork session mismatch', async () => {
      // Set an existing session so captureSession detects a mismatch
      service.setSessionId('old-session');
      // No fork state applied — this is a normal session mismatch

      const message = { type: 'system', subtype: 'init', session_id: 'different-session' };
      await (service as any).routeMessage(message);

      expect(service.getSessionId()).toBe('different-session');
      // Normal mismatch should trigger history rebuild
      expect((service as any).sessionManager.needsHistoryRebuild()).toBe(true);
      expect((service as any).pendingForkSession).toBe(false);
    });
  });


  describe('Approval Callback', () => {
    describe('createApprovalCallback permission flow', () => {
      const canUseToolOptions = {
        signal: new AbortController().signal,
        toolUseID: 'test-tool-use-id',
      };

      it('should return deny when user denies', async () => {
        host.approval.mockResolvedValue('deny');

        const canUseTool = (service as any).createApprovalCallback();
        const result = await canUseTool('Bash', { command: 'ls' }, canUseToolOptions);

        expect(result.behavior).toBe('deny');
        expect(result.message).toBe('User denied this action.');
        expect(result).not.toHaveProperty('updatedPermissions');
      });

      it('should return deny without interrupt when approvalCallback throws', async () => {
        host.approval.mockRejectedValue(new Error('Modal render failed'));

        const canUseTool = (service as any).createApprovalCallback();
        const result = await canUseTool('Bash', { command: 'ls' }, canUseToolOptions);

        expect(result.behavior).toBe('deny');
        expect(result.message).toContain('Modal render failed');
        expect(result.interrupt).toBe(false);
      });

      it('should return deny with interrupt for cancel decisions', async () => {
        host.approval.mockResolvedValue('cancel');

        const canUseTool = (service as any).createApprovalCallback();
        const result = await canUseTool('Bash', { command: 'ls' }, canUseToolOptions);

        expect(result.behavior).toBe('deny');
        expect(result.message).toBe('User interrupted.');
        expect(result.interrupt).toBe(true);
      });

      it('should prompt again after deny (no session cache)', async () => {
        const callback = host.approval.mockResolvedValue('deny');

        const canUseTool = (service as any).createApprovalCallback();

        await canUseTool('Bash', { command: 'rm -rf /tmp' }, canUseToolOptions);
        await canUseTool('Bash', { command: 'rm -rf /tmp' }, canUseToolOptions);

        expect(callback).toHaveBeenCalledTimes(2);
      });

      it('should forward decisionReason and blockedPath to approvalCallback', async () => {
        const callback = host.approval.mockResolvedValue('allow');

        const canUseTool = (service as any).createApprovalCallback();
        await canUseTool('Read', { file_path: '/etc/passwd' }, {
          ...canUseToolOptions,
          decisionReason: 'Path is outside allowed directories',
          blockedPath: '/etc/passwd',
        });

        expect(callback).toHaveBeenCalledWith(
          'Read',
          { file_path: '/etc/passwd' },
          'Read file: /etc/passwd',
          {
            decisionReason: 'Path is outside allowed directories',
            blockedPath: '/etc/passwd',
            agentID: undefined,
          },
        );
      });

      it('should forward agentID to approvalCallback', async () => {
        const callback = host.approval.mockResolvedValue('allow');

        const canUseTool = (service as any).createApprovalCallback();
        await canUseTool('Bash', { command: 'ls' }, {
          ...canUseToolOptions,
          agentID: 'sub-agent-42',
        });

        expect(callback).toHaveBeenCalledWith(
          'Bash',
          { command: 'ls' },
          expect.any(String),
          {
            decisionReason: undefined,
            blockedPath: undefined,
            agentID: 'sub-agent-42',
          },
        );
      });

      it('should return updatedPermissions with session destination for allow decisions', async () => {
        host.approval.mockResolvedValue('allow');

        const canUseTool = (service as any).createApprovalCallback();
        const result = await canUseTool('Bash', { command: 'git status' }, canUseToolOptions);

        expect(result.behavior).toBe('allow');
        expect(result.updatedPermissions).toBeDefined();
        expect(result.updatedPermissions[0]).toMatchObject({
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
        });
      });

      it('should return updatedPermissions for allow-always decisions', async () => {
        host.approval.mockResolvedValue('allow-always');

        const canUseTool = (service as any).createApprovalCallback();
        const result = await canUseTool('Bash', { command: 'git status' }, canUseToolOptions);

        expect(result.behavior).toBe('allow');
        expect(result.updatedPermissions).toBeDefined();
        expect(result.updatedPermissions[0]).toMatchObject({
          type: 'addRules',
          behavior: 'allow',
          destination: 'projectSettings',
        });
      });
    });
  });


  describe('createApprovalCallback - allowed tools restriction', () => {
    const canUseToolOptions = {
      signal: new AbortController().signal,
      toolUseID: 'test-tool-use-id',
    };

    it('should deny tools not in allowedTools list', async () => {
      (service as any).currentAllowedTools = ['Read', 'Glob'];
      const callback = host.approval.mockResolvedValue('allow');

      const canUseTool = (service as any).createApprovalCallback();
      const result = await canUseTool('Bash', { command: 'ls' }, canUseToolOptions);

      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('not allowed');
      expect(result.message).toContain('Allowed tools: Read, Glob');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should deny when allowedTools is empty', async () => {
      (service as any).currentAllowedTools = [];
      host.approval.mockResolvedValue('allow');

      const canUseTool = (service as any).createApprovalCallback();
      const result = await canUseTool('Read', { file_path: 'test.md' }, canUseToolOptions);

      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('No tools are allowed');
    });

    it('should allow Skill tool even when not in allowedTools', async () => {
      (service as any).currentAllowedTools = ['Read'];
      const callback = host.approval.mockResolvedValue('allow');

      const canUseTool = (service as any).createApprovalCallback();
      const result = await canUseTool('Skill', { name: 'commit' }, canUseToolOptions);

      expect(result.behavior).toBe('allow');
      expect(callback).toHaveBeenCalled();
    });

    it('should allow tools in the allowedTools list', async () => {
      (service as any).currentAllowedTools = ['Read', 'Glob'];
      const callback = host.approval.mockResolvedValue('allow');

      const canUseTool = (service as any).createApprovalCallback();
      const result = await canUseTool('Read', { file_path: 'test.md' }, canUseToolOptions);

      expect(result.behavior).toBe('allow');
      expect(callback).toHaveBeenCalled();
    });

    it('should not restrict when currentAllowedTools is null', async () => {
      (service as any).currentAllowedTools = null;
      const callback = host.approval.mockResolvedValue('allow');

      const canUseTool = (service as any).createApprovalCallback();
      const result = await canUseTool('Bash', { command: 'rm -rf /' }, canUseToolOptions);

      expect(result.behavior).toBe('allow');
      expect(callback).toHaveBeenCalled();
    });
  });


  describe('Response Handler Management', () => {
    it('should register and unregister handlers', () => {
      const handler = createResponseHandler({
        id: 'test-handler',
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError: jest.fn(),
      });

      (service as any).registerResponseHandler(handler);
      expect((service as any).responseHandlers).toHaveLength(1);

      (service as any).unregisterResponseHandler('test-handler');
      expect((service as any).responseHandlers).toHaveLength(0);
    });

    it('should not fail when unregistering non-existent handler', () => {
      (service as any).unregisterResponseHandler('nonexistent');
      expect((service as any).responseHandlers).toHaveLength(0);
    });

    it('should register multiple handlers', () => {
      const handler1 = createResponseHandler({
        id: 'h1',
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError: jest.fn(),
      });
      const handler2 = createResponseHandler({
        id: 'h2',
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError: jest.fn(),
      });

      (service as any).registerResponseHandler(handler1);
      (service as any).registerResponseHandler(handler2);
      expect((service as any).responseHandlers).toHaveLength(2);

      (service as any).unregisterResponseHandler('h1');
      expect((service as any).responseHandlers).toHaveLength(1);
      expect((service as any).responseHandlers[0].id).toBe('h2');
    });
  });


  describe('Ready State Change Listeners', () => {
    it('should call listener immediately with current ready state on subscribe', () => {
      const listener = jest.fn();

      service.onReadyStateChange(listener);

      expect(listener).toHaveBeenCalledWith(false);
    });

    it('should call listener with true when service is ready', () => {
      (service as any).persistentQuery = {};
      (service as any).shuttingDown = false;

      const listener = jest.fn();
      service.onReadyStateChange(listener);

      expect(listener).toHaveBeenCalledWith(true);
    });

    it('should return unsubscribe function that removes listener', () => {
      const listener = jest.fn();
      const unsubscribe = service.onReadyStateChange(listener);

      unsubscribe();

      expect((service as any).readyStateListeners.has(listener)).toBe(false);
    });

    it('should notify multiple listeners when ready state changes', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      service.onReadyStateChange(listener1);
      service.onReadyStateChange(listener2);

      listener1.mockClear();
      listener2.mockClear();

      (service as any).notifyReadyStateChange();

      expect(listener1).toHaveBeenCalledWith(false);
      expect(listener2).toHaveBeenCalledWith(false);
    });

    it('should not call unsubscribed listeners on notify', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      service.onReadyStateChange(listener1);
      const unsubscribe2 = service.onReadyStateChange(listener2);

      listener1.mockClear();
      listener2.mockClear();

      unsubscribe2();
      (service as any).notifyReadyStateChange();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('should isolate listener errors and continue notifying other listeners', () => {
      const errorListener = jest.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const normalListener = jest.fn();

      service.onReadyStateChange(errorListener);
      service.onReadyStateChange(normalListener);

      normalListener.mockClear();

      expect(() => (service as any).notifyReadyStateChange()).not.toThrow();
      expect(normalListener).toHaveBeenCalledWith(false);
    });

    it('should isolate errors on immediate callback during subscribe', () => {
      const errorListener = jest.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });

      expect(() => service.onReadyStateChange(errorListener)).not.toThrow();
      expect(errorListener).toHaveBeenCalled();
    });

    it('should skip notification when no listeners registered', () => {
      expect(() => (service as any).notifyReadyStateChange()).not.toThrow();
    });
  });


  describe('routeMessage - agents event', () => {
    it('should set builtin agent names from init event', async () => {
      const mockAgentManager = { setBuiltinAgentNames: jest.fn() };
      (mockPlugin as any).agentManager = mockAgentManager;

      const onChunk = jest.fn();
      const handler = createResponseHandler({
        id: 'agents-test',
        onChunk,
        onDone: jest.fn(),
        onError: jest.fn(),
      });
      (service as any).responseHandlers = [handler];
      (service as any).messageChannel = {
        onTurnComplete: jest.fn(),
        setSessionId: jest.fn(),
      };

      // Send a system init message with agents
      const message = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        agents: ['agent1', 'agent2'],
      };

      await (service as any).routeMessage(message);

      expect(mockAgentManager.setBuiltinAgentNames).toHaveBeenCalledWith(['agent1', 'agent2']);
    });

    it('should not throw when agentManager.setBuiltinAgentNames fails', async () => {
      const mockAgentManager = {
        setBuiltinAgentNames: jest.fn().mockImplementation(() => {
          throw new Error('agent error');
        }),
      };
      (mockPlugin as any).agentManager = mockAgentManager;

      const handler = createResponseHandler({
        id: 'agents-error-test',
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError: jest.fn(),
      });
      (service as any).responseHandlers = [handler];
      (service as any).messageChannel = {
        onTurnComplete: jest.fn(),
        setSessionId: jest.fn(),
      };

      const message = {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        agents: ['agent1'],
      };

      // Should not throw
      await expect((service as any).routeMessage(message)).resolves.toBeUndefined();
    });
  });


  describe('routeMessage - usage chunk with sessionId', () => {
    it('should attach sessionId to usage chunks from assistant messages', async () => {
      service.setSessionId('usage-session-id');

      const onChunk = jest.fn();
      const handler = createResponseHandler({
        id: 'usage-test',
        onChunk,
        onDone: jest.fn(),
        onError: jest.fn(),
      });
      (service as any).responseHandlers = [handler];
      (service as any).messageChannel = {
        onTurnComplete: jest.fn(),
        setSessionId: jest.fn(),
      };

      // Usage is extracted from assistant messages (not result messages)
      const message = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
          },
        },
      };

      await (service as any).routeMessage(message);

      const usageChunks = onChunk.mock.calls
        .map(([chunk]: any) => chunk)
        .filter((c: any) => c.type === 'usage');

      expect(usageChunks.length).toBeGreaterThan(0);
      expect(usageChunks[0].sessionId).toBe('usage-session-id');
    });
  });

});
