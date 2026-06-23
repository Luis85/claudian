import * as sdkModule from '@anthropic-ai/claude-agent-sdk';
import type { MockRuntimeHost } from '@test/helpers/runtimeHost';

import { collectChunks, sdkMock, setupSpecoratorServiceTest } from './specoratorServiceTestKit';

describe('SpecoratorService', () => {
  const ctx = setupSpecoratorServiceTest();
  let service: typeof ctx.service;
  let mockPlugin: typeof ctx.mockPlugin;
  let host: MockRuntimeHost;

  beforeEach(() => {
    ({ service, mockPlugin, host } = ctx);
  });

  describe('Session Management', () => {
    it('should have null session ID initially', () => {
      expect(service.getSessionId()).toBeNull();
    });

    it('should set session ID', () => {
      service.setSessionId('test-session-123');
      expect(service.getSessionId()).toBe('test-session-123');
    });

    it('should reset session', () => {
      service.setSessionId('test-session-123');
      service.resetSession();
      expect(service.getSessionId()).toBeNull();
    });

    it('should not close persistent query when setting same session ID', () => {
      service.setSessionId('test-session-123');
      const activeStateBefore = service.isPersistentQueryActive();
      service.setSessionId('test-session-123');
      expect(service.getSessionId()).toBe('test-session-123');
      expect(service.isPersistentQueryActive()).toBe(activeStateBefore);
    });

    it('should update session ID when switching to different session', () => {
      service.setSessionId('test-session-123');
      service.setSessionId('different-session-456');
      expect(service.getSessionId()).toBe('different-session-456');
    });

    it('should handle setting null session ID', () => {
      service.setSessionId('test-session-123');
      service.setSessionId(null);
      expect(service.getSessionId()).toBeNull();
    });

    it('should NOT call ensureReady when setting session ID (passive sync)', async () => {
      const ensureReadySpy = jest.spyOn(service, 'ensureReady').mockResolvedValue(true);

      service.setSessionId('test-session', ['/path/a', '/path/b']);

      await Promise.resolve();

      // setSessionId is now passive — runtime starts on demand in query()
      expect(ensureReadySpy).not.toHaveBeenCalled();
      expect(service.getSessionId()).toBe('test-session');
    });

    it('should track externalContextPaths for later use without starting runtime', async () => {
      const ensureReadySpy = jest.spyOn(service, 'ensureReady').mockResolvedValue(true);

      service.setSessionId('test-session', ['/path/a']);

      await Promise.resolve();

      expect(ensureReadySpy).not.toHaveBeenCalled();
      expect(service.getSessionId()).toBe('test-session');
    });
  });


  describe('Session Restoration', () => {
    it('should restore session with custom model', () => {
      const customModel = 'claude-3-opus';
      (mockPlugin as any).settings.model = customModel;

      service.setSessionId('test-session-123');

      expect(service.getSessionId()).toBe('test-session-123');
    });

    it('should invalidate session on reset', () => {
      service.setSessionId('test-session-123');
      service.resetSession();

      expect(service.getSessionId()).toBeNull();
    });
  });


  describe('consumeSessionInvalidation', () => {
    it('should return false when no invalidation', () => {
      expect(service.consumeSessionInvalidation()).toBe(false);
    });

    it('should delegate to sessionManager', () => {
      const sessionManager = (service as any).sessionManager;
      sessionManager.invalidateSession();

      expect(service.consumeSessionInvalidation()).toBe(true);
      // Should be consumed
      expect(service.consumeSessionInvalidation()).toBe(false);
    });
  });


  describe('Cancel with persistent query', () => {
    it('should interrupt persistent query on cancel', () => {
      const interruptMock = jest.fn().mockResolvedValue(undefined);
      (service as any).persistentQuery = { interrupt: interruptMock };
      (service as any).shuttingDown = false;

      service.cancel();

      expect(interruptMock).toHaveBeenCalled();
    });

    it('should not interrupt persistent query when shutting down', () => {
      const interruptMock = jest.fn().mockResolvedValue(undefined);
      (service as any).persistentQuery = { interrupt: interruptMock };
      (service as any).shuttingDown = true;

      service.cancel();

      expect(interruptMock).not.toHaveBeenCalled();
    });
  });


  describe('Query Cancellation', () => {
    it('should cancel cold-start query', () => {
      const abortSpy = jest.fn();
      (service as any).abortController = { abort: abortSpy, signal: { aborted: false } };

      service.cancel();

      expect(abortSpy).toHaveBeenCalled();
    });

    it('should mark session as interrupted on cancel', () => {
      const sessionManager = (service as any).sessionManager;
      (service as any).abortController = { abort: jest.fn(), signal: { aborted: false } };

      service.cancel();

      expect(sessionManager.wasInterrupted()).toBe(true);
    });

    it('dismisses pending approval UI through the host on cancel', () => {
      // RuntimeHost cancel-dismiss invariant (ADR-0001 Phase 2): cancel must
      // clear pending approval prompts or they stay stuck on screen.
      service.cancel();

      expect(host.dismissApproval).toHaveBeenCalled();
    });
  });


  describe('query() - session expired retry (cold-start path)', () => {
    beforeEach(() => {
      sdkMock.resetMockMessages();
    });

    afterEach(() => {
      sdkMock.resetMockMessages();
      jest.restoreAllMocks();
    });


    it('should retry with history on session expired error in cold-start', async () => {
      // First call throws session expired, second succeeds
      let callCount = 0;
      const originalQuery = sdkMock.query;
      jest.spyOn(sdkModule, 'query' as any).mockImplementation((...args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          // First call: throw session expired error
          // eslint-disable-next-line require-yield
          const gen = (async function* () {
            throw new Error('session expired');
          })() as any;
          gen.interrupt = jest.fn();
          gen.setModel = jest.fn();
          gen.setMaxThinkingTokens = jest.fn();
          gen.setPermissionMode = jest.fn();
          gen.setMcpServers = jest.fn();
          return gen;
        }
        // Second call: succeed with retry
        const [params] = args as Parameters<typeof sdkModule.query>;
        return originalQuery.call(null, params);
      });

      service.setSessionId('old-session');
      const history: any[] = [
        { id: '1', role: 'user', content: 'Previous', timestamp: 1000 },
        { id: '2', role: 'assistant', content: 'Answer', timestamp: 1001 },
      ];

      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'retry-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Retried OK' }] } },
      ]);

      const chunks = await collectChunks(
        service.query('follow up', undefined, history, { forceColdStart: true })
      );

      // Should have retried and yielded chunks
      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('should yield error when session expired retry also fails', async () => {
      jest.spyOn(sdkModule, 'query' as any).mockImplementation(() => {
        // eslint-disable-next-line require-yield
        const gen = (async function* () {
          throw new Error('session expired');
        })() as any;
        gen.interrupt = jest.fn();
        gen.setModel = jest.fn();
        gen.setMaxThinkingTokens = jest.fn();
        gen.setPermissionMode = jest.fn();
        gen.setMcpServers = jest.fn();
        return gen;
      });

      service.setSessionId('old-session');
      const history: any[] = [
        { id: '1', role: 'user', content: 'Previous', timestamp: 1000 },
      ];

      const chunks = await collectChunks(
        service.query('follow up', undefined, history, { forceColdStart: true })
      );

      const errorChunks = chunks.filter(c => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].content).toContain('session expired');
    });
  });


  describe('query() - session expired retry from persistent path', () => {
    beforeEach(() => {
      sdkMock.resetMockMessages();
    });

    afterEach(() => {
      sdkMock.resetMockMessages();
      jest.restoreAllMocks();
    });


    it('should retry via cold-start when persistent query yields session expired error', async () => {
      // Set up a session and history so retry can happen
      service.setSessionId('old-persistent-session');
      const history: any[] = [
        { id: '1', role: 'user', content: 'Previous question', timestamp: 1000 },
        { id: '2', role: 'assistant', content: 'Previous answer', timestamp: 1001 },
      ];

      // Mock queryViaPersistent to throw session expired
      jest.spyOn(service as any, 'queryViaPersistent').mockImplementation(
        // eslint-disable-next-line require-yield
        async function* () {
          throw new Error('session expired');
        }
      );

      // Mock queryViaSDK to succeed on retry
      const queryViaSDKSpy = jest.spyOn(service as any, 'queryViaSDK').mockImplementation(
        async function* () {
          yield { type: 'text', content: 'Retried OK' };
          yield { type: 'done' };
        }
      );

      // Need a persistent query to be "active" for shouldUsePersistent
      (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      (service as any).shuttingDown = false;

      const chunks = await collectChunks(service.query('follow up', undefined, history));

      // Should have retried via SDK
      expect(queryViaSDKSpy).toHaveBeenCalled();
      const textChunks = chunks.filter(c => c.type === 'text');
      expect(textChunks[0].content).toBe('Retried OK');
    });

    it('should yield error when persistent session expired retry also fails', async () => {
      service.setSessionId('old-persistent-session');
      const history: any[] = [
        { id: '1', role: 'user', content: 'Previous question', timestamp: 1000 },
      ];

      jest.spyOn(service as any, 'queryViaPersistent').mockImplementation(
        // eslint-disable-next-line require-yield
        async function* () {
          throw new Error('session expired');
        }
      );

      jest.spyOn(service as any, 'queryViaSDK').mockImplementation(
        // eslint-disable-next-line require-yield
        async function* () {
          throw new Error('retry also failed');
        }
      );

      (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      (service as any).shuttingDown = false;

      const chunks = await collectChunks(service.query('follow up', undefined, history));

      const errorChunks = chunks.filter(c => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].content).toContain('retry also failed');
    });

    it('should re-throw non-session-expired errors from persistent path', async () => {
      jest.spyOn(service as any, 'queryViaPersistent').mockImplementation(
        // eslint-disable-next-line require-yield
        async function* () {
          throw new Error('unexpected failure');
        }
      );

      (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      (service as any).shuttingDown = false;

      // query() should propagate the error (not catch it)
      await expect(async () => {
        await collectChunks(service.query('hello'));
      }).rejects.toThrow('unexpected failure');
    });

    it('should not retry session expired without conversation history', async () => {
      jest.spyOn(service as any, 'queryViaPersistent').mockImplementation(
        // eslint-disable-next-line require-yield
        async function* () {
          throw new Error('session expired');
        }
      );

      (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      (service as any).shuttingDown = false;

      // No history → should re-throw, not retry
      await expect(async () => {
        await collectChunks(service.query('hello'));
      }).rejects.toThrow('session expired');
    });
  });


  describe('applyForkState (via syncConversationState)', () => {
    it('sets pendingForkSession and pendingResumeAt when conversation has forkSource but no sessionId', () => {
      service.syncConversationState({
        sessionId: null,
        providerState: { forkSource: { sessionId: 'source-session', resumeAt: 'asst-uuid-123' } },
      });

      expect(service.getSessionId()).toBe('source-session');
      expect((service as any).pendingForkSession).toBe(true);
      expect((service as any).pendingResumeAt).toBe('asst-uuid-123');
    });

    it('does not set pendingForkSession when conversation has its own sessionId', () => {
      service.syncConversationState({
        sessionId: 'own-session',
        providerState: { forkSource: { sessionId: 'source-session', resumeAt: 'asst-uuid-123' } },
      });

      expect(service.getSessionId()).toBe('own-session');
      expect((service as any).pendingForkSession).toBe(false);
      expect((service as any).pendingResumeAt).toBeUndefined();
    });

    it('resolves to null when no sessionId and no forkSource', () => {
      service.syncConversationState({
        sessionId: null,
      });

      expect(service.getSessionId()).toBeNull();
      expect((service as any).pendingForkSession).toBe(false);
    });

    it('resolves to sessionId when only sessionId is present (no forkSource)', () => {
      service.syncConversationState({
        sessionId: 'existing-session',
      });

      expect(service.getSessionId()).toBe('existing-session');
      expect((service as any).pendingForkSession).toBe(false);
    });

    it('clears pendingForkSession and pendingResumeAt from previous call', () => {
      // First call: set fork state
      service.syncConversationState({
        sessionId: null,
        providerState: { forkSource: { sessionId: 'source-1', resumeAt: 'asst-1' } },
      });
      expect((service as any).pendingForkSession).toBe(true);
      expect((service as any).pendingResumeAt).toBe('asst-1');

      // Second call: conversation has own sessionId, should clear fork state
      service.syncConversationState({
        sessionId: 'own-session',
        providerState: { forkSource: { sessionId: 'source-1', resumeAt: 'asst-1' } },
      });
      expect((service as any).pendingForkSession).toBe(false);
      expect((service as any).pendingResumeAt).toBeUndefined();
    });

    it('clears pendingResumeAt when switching to non-fork conversation', () => {
      // Set fork state
      service.syncConversationState({
        sessionId: null,
        providerState: { forkSource: { sessionId: 'source-1', resumeAt: 'asst-1' } },
      });
      expect((service as any).pendingResumeAt).toBe('asst-1');

      // Switch to a normal conversation (no forkSource)
      service.syncConversationState({ sessionId: 'normal-session' });
      expect((service as any).pendingResumeAt).toBeUndefined();
    });

    it('treats conversation as not pending when providerSessionId is set', () => {
      service.syncConversationState({
        sessionId: null,
        providerState: {
          providerSessionId: 'sdk-session-xyz',
          forkSource: { sessionId: 'source-session', resumeAt: 'asst-uuid-123' },
        },
      });

      // Resolves to forkSource.sessionId via the ?? chain, but does NOT set pending fork state
      expect(service.getSessionId()).toBe('source-session');
      expect((service as any).pendingForkSession).toBe(false);
      expect((service as any).pendingResumeAt).toBeUndefined();
    });
  });


  describe('syncConversationState', () => {
    it('resolves fork state before updating the session', () => {
      const setSessionIdSpy = jest.spyOn(service, 'setSessionId').mockImplementation(() => {});

      service.syncConversationState({
        sessionId: null,
        providerState: { forkSource: { sessionId: 'source-session', resumeAt: 'assistant-uuid' } },
      }, ['/external/path']);

      expect(setSessionIdSpy).toHaveBeenCalledWith('source-session', ['/external/path']);
      expect((service as any).pendingForkSession).toBe(true);
      expect((service as any).pendingResumeAt).toBe('assistant-uuid');
    });

    it('clears pending fork metadata when resetting conversation state', () => {
      const setSessionIdSpy = jest.spyOn(service, 'setSessionId').mockImplementation(() => {});

      service.syncConversationState({
        sessionId: null,
        providerState: { forkSource: { sessionId: 'source-session', resumeAt: 'assistant-uuid' } },
      });

      service.syncConversationState(null, ['/external/path']);

      expect(setSessionIdSpy).toHaveBeenCalledWith(null, ['/external/path']);
      expect((service as any).pendingForkSession).toBe(false);
      expect((service as any).pendingResumeAt).toBeUndefined();
    });
  });
});
