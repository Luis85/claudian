import { MessageChannel } from '@/providers/claude/runtime/ClaudeMessageChannel';
import { createResponseHandler } from '@/providers/claude/runtime/types';

import { sdkMock, setupClaudianServiceTest } from './claudianServiceTestKit';

describe('ClaudianService', () => {
  const ctx = setupClaudianServiceTest();
  let service: typeof ctx.service;
  let mockPlugin: typeof ctx.mockPlugin;

  beforeEach(() => {
    ({ service, mockPlugin } = ctx);
  });

  describe('Persistent Query Management', () => {
    it('should not be active initially', () => {
      expect(service.isPersistentQueryActive()).toBe(false);
    });

    it('should close persistent query', () => {
      service.setSessionId('test-session');
      service.closePersistentQuery('test reason');

      expect(service.isPersistentQueryActive()).toBe(false);
    });

    it('should restart persistent query via ensureReady with force', async () => {
      service.setSessionId('test-session');

      const startPersistentQuerySpy = jest.spyOn(service as any, 'startPersistentQuery');
      startPersistentQuerySpy.mockResolvedValue(undefined);

      const result = await service.ensureReady({ force: true });

      expect(result).toBe(true);
      expect(startPersistentQuerySpy).toHaveBeenCalled();
    });

    it('should return false (no-op) when config unchanged and query running', async () => {
      const startPersistentQuerySpy = jest.spyOn(service as any, 'startPersistentQuery');

      // Mock startPersistentQuery to simulate real side effects (subprocess boundary)
      startPersistentQuerySpy.mockImplementation(async (...args: unknown[]) => {
        const [vaultPath, cliPath, , externalContextPaths] = args as [string, string, string?, string[]?];
        (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
        (service as any).currentConfig = (service as any).buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths);
      });

      // First call starts the query
      const result1 = await service.ensureReady();
      expect(result1).toBe(true);
      expect(startPersistentQuerySpy).toHaveBeenCalledTimes(1);

      // Second call with same config should no-op
      const result2 = await service.ensureReady();
      expect(result2).toBe(false);
      expect(startPersistentQuerySpy).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('should restart when config changed (external context paths)', async () => {
      const startPersistentQuerySpy = jest.spyOn(service as any, 'startPersistentQuery');

      // Mock startPersistentQuery to simulate real side effects (subprocess boundary)
      startPersistentQuerySpy.mockImplementation(async (...args: unknown[]) => {
        const [vaultPath, cliPath, , externalContextPaths] = args as [string, string, string?, string[]?];
        (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
        (service as any).currentConfig = (service as any).buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths);
      });

      // First call starts with no external paths (Case 1: not running)
      await service.ensureReady({ externalContextPaths: [] });
      expect(startPersistentQuerySpy).toHaveBeenCalledTimes(1);

      // Second call with different paths triggers restart via real needsRestart
      const result = await service.ensureReady({ externalContextPaths: ['/new/path'] });
      expect(result).toBe(true);
      expect(startPersistentQuerySpy).toHaveBeenCalledTimes(2);
    });

    it('should pass preserveHandlers: true to closePersistentQuery on force restart', async () => {
      const startPersistentQuerySpy = jest.spyOn(service as any, 'startPersistentQuery');
      const closePersistentQuerySpy = jest.spyOn(service, 'closePersistentQuery');

      startPersistentQuerySpy.mockImplementation(async () => {
        (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      });

      // Start the query first
      await service.ensureReady();
      expect(startPersistentQuerySpy).toHaveBeenCalledTimes(1);

      // Force restart with preserveHandlers: true (crash recovery scenario)
      await service.ensureReady({ force: true, preserveHandlers: true });

      expect(closePersistentQuerySpy).toHaveBeenCalledWith('forced restart', { preserveHandlers: true });
      expect(startPersistentQuerySpy).toHaveBeenCalledTimes(2);
    });

    it('should pass preserveHandlers through config change restart', async () => {
      const startPersistentQuerySpy = jest.spyOn(service as any, 'startPersistentQuery');
      const closePersistentQuerySpy = jest.spyOn(service, 'closePersistentQuery');

      // Mock startPersistentQuery to simulate real side effects (subprocess boundary)
      startPersistentQuerySpy.mockImplementation(async (...args: unknown[]) => {
        const [vaultPath, cliPath, , externalContextPaths] = args as [string, string, string?, string[]?];
        (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
        (service as any).currentConfig = (service as any).buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths);
      });

      // Start the query first
      await service.ensureReady({ externalContextPaths: [] });

      // Config change with preserveHandlers: true
      await service.ensureReady({ externalContextPaths: ['/new/path'], preserveHandlers: true });

      expect(closePersistentQuerySpy).toHaveBeenCalledWith('config changed', { preserveHandlers: true });
    });

    it('should return false when CLI unavailable after force close', async () => {
      const startPersistentQuerySpy = jest.spyOn(service as any, 'startPersistentQuery');
      const closePersistentQuerySpy = jest.spyOn(service, 'closePersistentQuery');

      startPersistentQuerySpy.mockImplementation(async () => {
        (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      });

      // Start the query first
      await service.ensureReady();
      expect(startPersistentQuerySpy).toHaveBeenCalledTimes(1);

      // Now make CLI unavailable
      (mockPlugin.getResolvedProviderCliPath as jest.Mock).mockReturnValue(null);

      // Force restart should close but fail to start new one
      const result = await service.ensureReady({ force: true });
      expect(result).toBe(false);
      expect(closePersistentQuerySpy).toHaveBeenCalledWith('forced restart', { preserveHandlers: undefined });
      expect(startPersistentQuerySpy).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should return false when CLI unavailable after config change close', async () => {
      const startPersistentQuerySpy = jest.spyOn(service as any, 'startPersistentQuery');
      const closePersistentQuerySpy = jest.spyOn(service, 'closePersistentQuery');

      // Mock startPersistentQuery to simulate real side effects (subprocess boundary)
      startPersistentQuerySpy.mockImplementation(async (...args: unknown[]) => {
        const [vaultPath, cliPath, , externalContextPaths] = args as [string, string, string?, string[]?];
        (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
        (service as any).currentConfig = (service as any).buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths);
      });

      // Start the query first (Case 1: not running)
      await service.ensureReady({ externalContextPaths: [] });

      // Make CLI unavailable after the config change detection
      // In Case 3, CLI is checked once before needsRestart, then again after close
      let cliCallCount = 0;
      (mockPlugin.getResolvedProviderCliPath as jest.Mock).mockImplementation(() => {
        cliCallCount++;
        // First call (for config check) returns valid path
        // Second call (after close, for restart) returns null
        return cliCallCount === 1 ? '/usr/local/bin/claude' : null;
      });

      // Config change should close but fail to start new one (CLI unavailable)
      const result = await service.ensureReady({ externalContextPaths: ['/new/path'] });
      expect(result).toBe(false);
      expect(closePersistentQuerySpy).toHaveBeenCalledWith('config changed', { preserveHandlers: undefined });
    });

    it('should cleanup resources', () => {
      const closePersistentQuerySpy = jest.spyOn(service, 'closePersistentQuery');
      const cancelSpy = jest.spyOn(service, 'cancel');

      service.cleanup();

      expect(closePersistentQuerySpy).toHaveBeenCalledWith('plugin cleanup');
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('cleanup aborts the query AbortController synchronously within the call frame (onunload contract)', () => {
      // Plugin onunload is synchronous and fire-and-forget. The SDK child is
      // killed by the spawn-side abort listener (customSpawn.ts) which fires
      // synchronously on abort(), so abort() must be reached before cleanup()
      // could suspend — guarded here by asserting in the same call frame.
      (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      const abortSpy = jest.fn();
      (service as any).queryAbortController = { abort: abortSpy };

      service.cleanup();

      expect(abortSpy).toHaveBeenCalledTimes(1);
    });
  });


  describe('closePersistentQuery handler notification', () => {
    it('should call onDone on all handlers when not preserving', () => {
      const onDone1 = jest.fn();
      const onDone2 = jest.fn();
      const handler1 = createResponseHandler({ id: 'h1', onChunk: jest.fn(), onDone: onDone1, onError: jest.fn() });
      const handler2 = createResponseHandler({ id: 'h2', onChunk: jest.fn(), onDone: onDone2, onError: jest.fn() });

      // Set up persistent query state
      (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).responseHandlers = [handler1, handler2];

      service.closePersistentQuery('test');

      expect(onDone1).toHaveBeenCalled();
      expect(onDone2).toHaveBeenCalled();
    });

    it('should NOT call onDone when preserving handlers', () => {
      const onDone = jest.fn();
      const handler = createResponseHandler({ id: 'h1', onChunk: jest.fn(), onDone, onError: jest.fn() });

      (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).responseHandlers = [handler];

      service.closePersistentQuery('test', { preserveHandlers: true });

      expect(onDone).not.toHaveBeenCalled();
    });
  });


  describe('startPersistentQuery guard', () => {
    it('should not start if already running', async () => {
      (service as any).persistentQuery = { interrupt: jest.fn() };
      const buildOptsSpy = jest.spyOn(service as any, 'buildPersistentQueryOptions');

      await (service as any).startPersistentQuery('/vault', '/cli', 'session');

      expect(buildOptsSpy).not.toHaveBeenCalled();
    });

    // Regression: a bound-agent cold-start must fold the bound prompt into the
    // stored currentConfig.systemPromptKey so it matches the key implied by the
    // actual query options. Otherwise needsRestart fires on every subsequent
    // bound-agent turn, force-restarting the persistent query each time.
    it('stores currentConfig whose systemPromptKey includes the bound-agent appendix', async () => {
      const boundPrompt = 'You are a research subagent.';
      (service as any).currentBoundAgentPrompt = boundPrompt;

      await (service as any).startPersistentQuery('/mock/vault/path', '/usr/local/bin/claude');

      const storedConfig = (service as any).currentConfig;
      expect(storedConfig).toBeTruthy();

      // Same bound prompt on the next turn -> no restart.
      const sameBoundConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path', '/usr/local/bin/claude', undefined, undefined, boundPrompt,
      );
      expect((service as any).needsRestart(sameBoundConfig)).toBe(false);

      // No bound prompt -> key differs -> restart (proves the appendix is in the stored key).
      const noBoundConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path', '/usr/local/bin/claude', undefined, undefined, undefined,
      );
      expect(storedConfig.systemPromptKey).not.toBe(noBoundConfig.systemPromptKey);
      expect((service as any).needsRestart(noBoundConfig)).toBe(true);
    });
  });


  describe('attachPersistentQueryStdinErrorHandler', () => {
    it('should attach error handler to stdin', () => {
      const onMock = jest.fn();
      const onceMock = jest.fn();
      const mockQuery = {
        transport: {
          processStdin: {
            on: onMock,
            once: onceMock,
          },
        },
      };

      (service as any).attachPersistentQueryStdinErrorHandler(mockQuery);

      expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
      expect(onceMock).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should handle query without transport', () => {
      const mockQuery = {};

      // Should not throw
      expect(() => (service as any).attachPersistentQueryStdinErrorHandler(mockQuery)).not.toThrow();
    });

    it('should handle query with transport but no processStdin', () => {
      const mockQuery = { transport: {} };

      expect(() => (service as any).attachPersistentQueryStdinErrorHandler(mockQuery)).not.toThrow();
    });

    it('should close persistent query on non-pipe error when not shutting down', () => {
      const closeSpy = jest.spyOn(service, 'closePersistentQuery');
      (service as any).persistentQuery = { interrupt: jest.fn().mockResolvedValue(undefined) };
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).shuttingDown = false;

      let errorHandler: (error: any) => void;
      const mockQuery = {
        transport: {
          processStdin: {
            on: jest.fn((event: string, handler: any) => {
              if (event === 'error') errorHandler = handler;
            }),
            once: jest.fn(),
            removeListener: jest.fn(),
          },
        },
      };

      (service as any).attachPersistentQueryStdinErrorHandler(mockQuery);

      // Trigger non-pipe error
      errorHandler!({ code: 'ECONNRESET', message: 'Connection reset' });

      expect(closeSpy).toHaveBeenCalledWith('stdin error');
    });

    it('should NOT close persistent query on EPIPE error', () => {
      const closeSpy = jest.spyOn(service, 'closePersistentQuery');
      (service as any).shuttingDown = false;

      let errorHandler: (error: any) => void;
      const mockQuery = {
        transport: {
          processStdin: {
            on: jest.fn((event: string, handler: any) => {
              if (event === 'error') errorHandler = handler;
            }),
            once: jest.fn(),
            removeListener: jest.fn(),
          },
        },
      };

      (service as any).attachPersistentQueryStdinErrorHandler(mockQuery);

      // Trigger EPIPE error
      errorHandler!({ code: 'EPIPE' });

      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('should NOT close persistent query when shutting down', () => {
      const closeSpy = jest.spyOn(service, 'closePersistentQuery');
      (service as any).shuttingDown = true;

      let errorHandler: (error: any) => void;
      const mockQuery = {
        transport: {
          processStdin: {
            on: jest.fn((event: string, handler: any) => {
              if (event === 'error') errorHandler = handler;
            }),
            once: jest.fn(),
            removeListener: jest.fn(),
          },
        },
      };

      (service as any).attachPersistentQueryStdinErrorHandler(mockQuery);

      errorHandler!({ code: 'ECONNRESET' });

      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('should remove error handler on close', () => {
      const removeListenerMock = jest.fn();
      let closeHandler: () => void;

      const mockQuery = {
        transport: {
          processStdin: {
            on: jest.fn(),
            once: jest.fn((_event: string, handler: any) => {
              closeHandler = handler;
            }),
            removeListener: removeListenerMock,
          },
        },
      };

      (service as any).attachPersistentQueryStdinErrorHandler(mockQuery);

      // Trigger close
      closeHandler!();

      expect(removeListenerMock).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });


  describe('queryViaPersistent - edge cases', () => {
    it('should fall back to cold-start when persistent query is null', async () => {
      sdkMock.resetMockMessages();
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'fallback-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Fallback' }] } },
      ]);

      // No persistent query set
      (service as any).persistentQuery = null;
      (service as any).messageChannel = null;

      const chunks: any[] = [];
      for await (const chunk of (service as any).queryViaPersistent(
        'test', undefined, '/mock/vault/path', '/usr/local/bin/claude'
      )) {
        chunks.push(chunk);
      }

      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
    });

    it('should set allowedTools from query options', async () => {
      sdkMock.resetMockMessages();
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'allowed-tools-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
      ]);

      // Set up persistent query
      const mockPQ = {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };
      (service as any).persistentQuery = mockPQ;
      const mockChannel = new MessageChannel();
      (service as any).messageChannel = mockChannel;
      (service as any).responseConsumerRunning = true;
      (service as any).vaultPath = '/mock/vault/path';
      (service as any).currentConfig = {
        model: 'claude-3-5-sonnet',
        effortLevel: 'high',
        permissionMode: 'ask',
        systemPromptKey: '',
        disallowedToolsKey: '',
        mcpServersKey: '{}',
        pluginsKey: '',
        externalContextPaths: [],
        settingSources: '',
        claudeCliPath: '/usr/local/bin/claude',
        enableChrome: false,
        enableAutoMode: false,
      };

      // Set up handler to resolve immediately
      const gen = (service as any).queryViaPersistent(
        'test', undefined, '/mock/vault/path', '/usr/local/bin/claude',
        { allowedTools: ['Read', 'Glob'] }
      );

      // The generator will hang waiting for handler.onDone, so we need to
      // trigger it via the response handler
      const iterPromise = gen.next();

      // Wait a tick for the handler to be registered
      await new Promise(resolve => setTimeout(resolve, 10));

      // Find and trigger the handler
      const handlers = (service as any).responseHandlers;
      if (handlers.length > 0) {
        handlers[0].onChunk({ type: 'text', content: 'Hi' });
        handlers[0].onDone();
      }

      await iterPromise;

      // allowedTools should include the specified tools + Skill
      expect((service as any).currentAllowedTools).toEqual(['Read', 'Glob', 'Skill']);

      // Drain the generator
      let next = await gen.next();
      while (!next.done) {
        next = await gen.next();
      }
    });

    it('should fall back to cold-start when consumer is not running', async () => {
      sdkMock.resetMockMessages();
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'consumer-fallback' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Fallback' }] } },
      ]);

      // Persistent query exists but consumer is not running
      (service as any).persistentQuery = {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };
      (service as any).messageChannel = new MessageChannel();
      (service as any).responseConsumerRunning = false;
      (service as any).vaultPath = '/mock/vault/path';
      (service as any).currentConfig = {
        model: 'claude-3-5-sonnet',
        effortLevel: 'high',
        permissionMode: 'ask',
        systemPromptKey: '',
        disallowedToolsKey: '',
        mcpServersKey: '{}',
        pluginsKey: '',
        externalContextPaths: [],
        settingSources: '',
        claudeCliPath: '/usr/local/bin/claude',
        enableChrome: false,
        enableAutoMode: false,
      };

      const chunks: any[] = [];
      for await (const chunk of (service as any).queryViaPersistent(
        'test', undefined, '/mock/vault/path', '/usr/local/bin/claude'
      )) {
        chunks.push(chunk);
      }

      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
    });

    it('should fall back when persistent query lost after applyDynamicUpdates', async () => {
      sdkMock.resetMockMessages();
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'lost-pq' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
      ]);

      // Set up persistent query that will be cleared by applyDynamicUpdates mock
      (service as any).persistentQuery = {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };
      (service as any).messageChannel = new MessageChannel();
      (service as any).responseConsumerRunning = true;
      (service as any).vaultPath = '/mock/vault/path';
      (service as any).currentConfig = {
        model: 'claude-3-5-sonnet',
        effortLevel: 'high',
        permissionMode: 'ask',
        systemPromptKey: '',
        disallowedToolsKey: '',
        mcpServersKey: '{}',
        pluginsKey: '',
        externalContextPaths: [],
        settingSources: '',
        claudeCliPath: '/usr/local/bin/claude',
        enableChrome: false,
        enableAutoMode: false,
      };

      // Mock applyDynamicUpdates to clear persistent query (simulating restart failure)
      jest.spyOn(service as any, 'applyDynamicUpdates').mockImplementation(async () => {
        (service as any).persistentQuery = null;
        (service as any).messageChannel = null;
      });

      const chunks: any[] = [];
      for await (const chunk of (service as any).queryViaPersistent(
        'test', undefined, '/mock/vault/path', '/usr/local/bin/claude'
      )) {
        chunks.push(chunk);
      }

      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
    });

    it('should fall back when channel is closed during enqueue', async () => {
      sdkMock.resetMockMessages();
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'closed-channel' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
      ]);

      const closedChannel = new MessageChannel();
      closedChannel.close();

      (service as any).persistentQuery = {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };
      (service as any).messageChannel = closedChannel;
      (service as any).responseConsumerRunning = true;
      (service as any).vaultPath = '/mock/vault/path';
      (service as any).currentConfig = {
        model: 'claude-3-5-sonnet',
        effortLevel: 'high',
        permissionMode: 'ask',
        systemPromptKey: '',
        disallowedToolsKey: '',
        mcpServersKey: '{}',
        pluginsKey: '',
        externalContextPaths: [],
        settingSources: '',
        claudeCliPath: '/usr/local/bin/claude',
        enableChrome: false,
        enableAutoMode: false,
      };

      const chunks: any[] = [];
      for await (const chunk of (service as any).queryViaPersistent(
        'test', undefined, '/mock/vault/path', '/usr/local/bin/claude'
      )) {
        chunks.push(chunk);
      }

      // Should fall back to cold-start and complete
      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
    });

    it('should handle onError in handler and re-throw session expired', async () => {
      const mockPQ = {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };
      (service as any).persistentQuery = mockPQ;
      const mockChannel = new MessageChannel();
      (service as any).messageChannel = mockChannel;
      (service as any).responseConsumerRunning = true;
      (service as any).vaultPath = '/mock/vault/path';
      (service as any).currentConfig = {
        model: 'claude-3-5-sonnet',
        effortLevel: 'high',
        permissionMode: 'ask',
        systemPromptKey: '',
        disallowedToolsKey: '',
        mcpServersKey: '{}',
        pluginsKey: '',
        externalContextPaths: [],
        settingSources: '',
        claudeCliPath: '/usr/local/bin/claude',
        enableChrome: false,
        enableAutoMode: false,
      };

      // Mock applyDynamicUpdates to avoid side effects
      jest.spyOn(service as any, 'applyDynamicUpdates').mockResolvedValue(undefined);

      const gen = (service as any).queryViaPersistent(
        'test', undefined, '/mock/vault/path', '/usr/local/bin/claude'
      );

      const iterPromise = gen.next();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Trigger onError with session expired
      const handlers = (service as any).responseHandlers;
      expect(handlers.length).toBeGreaterThan(0);
      handlers[0].onError(new Error('session expired'));

      // Session expired should be re-thrown by the generator
      // gen.next() will resolve with the error propagating through the generator
      await expect(iterPromise).rejects.toThrow('session expired');
    });

    it('should handle onError with non-session error', async () => {
      const mockPQ = {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };
      (service as any).persistentQuery = mockPQ;
      const mockChannel = new MessageChannel();
      (service as any).messageChannel = mockChannel;
      (service as any).responseConsumerRunning = true;
      (service as any).vaultPath = '/mock/vault/path';
      (service as any).currentConfig = {
        model: 'claude-3-5-sonnet',
        effortLevel: 'high',
        permissionMode: 'ask',
        systemPromptKey: '',
        disallowedToolsKey: '',
        mcpServersKey: '{}',
        pluginsKey: '',
        externalContextPaths: [],
        settingSources: '',
        claudeCliPath: '/usr/local/bin/claude',
        enableChrome: false,
        enableAutoMode: false,
      };

      // Mock applyDynamicUpdates to avoid side effects
      jest.spyOn(service as any, 'applyDynamicUpdates').mockResolvedValue(undefined);

      const gen = (service as any).queryViaPersistent(
        'test', undefined, '/mock/vault/path', '/usr/local/bin/claude'
      );

      const chunks: any[] = [];
      const iterPromise = gen.next();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Trigger onError with regular error
      const handlers = (service as any).responseHandlers;
      expect(handlers.length).toBeGreaterThan(0);
      handlers[0].onError(new Error('Some internal error'));

      const first = await iterPromise;
      if (!first.done) {
        chunks.push(first.value);
        let next = await gen.next();
        while (!next.done) {
          chunks.push(next.value);
          next = await gen.next();
        }
      }

      const errorChunks = chunks.filter(c => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].content).toContain('Some internal error');
    });

    it('should yield buffered chunks from state.chunks', async () => {
      const mockPQ = {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };
      (service as any).persistentQuery = mockPQ;
      const mockChannel = new MessageChannel();
      (service as any).messageChannel = mockChannel;
      (service as any).responseConsumerRunning = true;
      (service as any).vaultPath = '/mock/vault/path';
      (service as any).currentConfig = {
        model: 'claude-3-5-sonnet',
        effortLevel: 'high',
        permissionMode: 'ask',
        systemPromptKey: '',
        disallowedToolsKey: '',
        mcpServersKey: '{}',
        pluginsKey: '',
        externalContextPaths: [],
        settingSources: '',
        claudeCliPath: '/usr/local/bin/claude',
        enableChrome: false,
        enableAutoMode: false,
      };

      // Mock applyDynamicUpdates to avoid side effects
      jest.spyOn(service as any, 'applyDynamicUpdates').mockResolvedValue(undefined);

      const gen = (service as any).queryViaPersistent(
        'test', undefined, '/mock/vault/path', '/usr/local/bin/claude'
      );

      const iterPromise = gen.next();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Rapidly send multiple chunks then done
      const handlers = (service as any).responseHandlers;
      expect(handlers.length).toBeGreaterThan(0);
      handlers[0].onChunk({ type: 'text', content: 'First' });
      handlers[0].onChunk({ type: 'text', content: 'Second' });
      handlers[0].onDone();

      const chunks: any[] = [];
      const first = await iterPromise;
      if (!first.done) {
        chunks.push(first.value);
        let next = await gen.next();
        while (!next.done) {
          chunks.push(next.value);
          next = await gen.next();
        }
      }

      const textChunks = chunks.filter(c => c.type === 'text');
      expect(textChunks.length).toBe(2);
      expect(textChunks[0].content).toBe('First');
      expect(textChunks[1].content).toBe('Second');
    });
  });


  describe('startResponseConsumer - crash recovery', () => {
    it('should attempt crash recovery when error occurs before any chunks', async () => {
      // Set up persistent query that will throw on iteration
      const crashError = new Error('process crashed');
      let iterationCount = 0;
      const mockPQ = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          iterationCount++;
          if (iterationCount === 1) {
            throw crashError;
          }
          return { done: true, value: undefined };
        },
        async return() { return { done: true, value: undefined }; },
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };

      (service as any).persistentQuery = mockPQ;
      (service as any).messageChannel = { close: jest.fn(), enqueue: jest.fn(), onTurnComplete: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).shuttingDown = false;
      (service as any).coldStartInProgress = false;
      (service as any).crashRecoveryAttempted = false;
      (service as any).responseConsumerRunning = false;

      // Set up a handler that hasn't seen any chunks (sawAnyChunk = false)
      const onError = jest.fn();
      const handler = createResponseHandler({
        id: 'crash-test',
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError,
      });
      (service as any).responseHandlers = [handler];

      // Set lastSentMessage for replay
      (service as any).lastSentMessage = {
        type: 'user',
        message: { role: 'user', content: 'test' },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };

      // Mock ensureReady to succeed
      const ensureReadySpy = jest.spyOn(service, 'ensureReady').mockResolvedValue(true);
      // After ensureReady, messageChannel needs to exist
      jest.spyOn(service as any, 'applyDynamicUpdates').mockResolvedValue(undefined);

      (service as any).startResponseConsumer();

      // Wait for async consumer to process
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ensureReadySpy).toHaveBeenCalledWith(
        expect.objectContaining({ force: true, preserveHandlers: true })
      );
    });

    it('should notify handler and restart when crash recovery already attempted', async () => {
      const crashError = new Error('process crashed again');
      let iterationCount = 0;
      const mockPQ = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          iterationCount++;
          if (iterationCount === 1) throw crashError;
          return { done: true, value: undefined };
        },
        async return() { return { done: true, value: undefined }; },
        interrupt: jest.fn().mockResolvedValue(undefined),
      };

      (service as any).persistentQuery = mockPQ;
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).shuttingDown = false;
      (service as any).coldStartInProgress = false;
      (service as any).crashRecoveryAttempted = true; // Already attempted
      (service as any).responseConsumerRunning = false;

      const onError = jest.fn();
      const handler = createResponseHandler({
        id: 'crash-test-2',
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError,
      });
      // handler hasn't seen chunks
      (service as any).responseHandlers = [handler];

      (service as any).lastSentMessage = {
        type: 'user',
        message: { role: 'user', content: 'test' },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };

      // ensureReady should NOT be called for recovery (already attempted),
      // but should be called for restart-for-next-message
      jest.spyOn(service, 'ensureReady').mockResolvedValue(false);

      (service as any).startResponseConsumer();

      await new Promise(resolve => setTimeout(resolve, 50));

      // Handler should have been notified of error
      expect(onError).toHaveBeenCalledWith(crashError);
    });

    it('should invalidate session when crash recovery restart fails with session expired', async () => {
      const crashError = new Error('process crashed');
      let iterationCount = 0;
      const mockPQ = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          iterationCount++;
          if (iterationCount === 1) throw crashError;
          return { done: true, value: undefined };
        },
        async return() { return { done: true, value: undefined }; },
        interrupt: jest.fn().mockResolvedValue(undefined),
      };

      (service as any).persistentQuery = mockPQ;
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).shuttingDown = false;
      (service as any).coldStartInProgress = false;
      (service as any).crashRecoveryAttempted = false;
      (service as any).responseConsumerRunning = false;

      const onError = jest.fn();
      const handler = createResponseHandler({
        id: 'session-expire-test',
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError,
      });
      (service as any).responseHandlers = [handler];
      (service as any).lastSentMessage = {
        type: 'user',
        message: { role: 'user', content: 'test' },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };

      // Set session directly to avoid ensureReady side effects
      (service as any).sessionManager.setSessionId('my-session', 'claude-3-5-sonnet');

      // ensureReady fails with session expired during crash recovery
      jest.spyOn(service, 'ensureReady').mockRejectedValue(new Error('session expired'));

      (service as any).startResponseConsumer();

      await new Promise(resolve => setTimeout(resolve, 50));

      // Session should be invalidated
      expect(service.consumeSessionInvalidation()).toBe(true);
      // Handler should be notified of the original error
      expect(onError).toHaveBeenCalledWith(crashError);
    });

    it('should skip error handling when consumer is orphaned (replaced)', async () => {
      const crashError = new Error('old consumer error');
      let resolveDelay: () => void;
      const delayPromise = new Promise<void>(resolve => { resolveDelay = resolve; });

      const oldMockPQ = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          // Wait for the swap to happen before throwing
          await delayPromise;
          throw crashError;
        },
        async return() { return { done: true, value: undefined }; },
        interrupt: jest.fn().mockResolvedValue(undefined),
      };

      // This PQ is the "old" one that the consumer will iterate
      (service as any).persistentQuery = oldMockPQ;
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).shuttingDown = false;
      (service as any).coldStartInProgress = false;
      (service as any).responseConsumerRunning = false;

      const onError = jest.fn();
      const handler = createResponseHandler({
        id: 'orphan-test',
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError,
      });
      (service as any).responseHandlers = [handler];

      (service as any).startResponseConsumer();

      // Wait for consumer to start its iteration (awaiting the delay)
      await new Promise(resolve => setTimeout(resolve, 10));

      // Swap to a new PQ before the error fires
      (service as any).persistentQuery = { interrupt: jest.fn() };

      // Now let the old PQ throw
      resolveDelay!();

      await new Promise(resolve => setTimeout(resolve, 50));

      // The orphaned consumer should NOT call onError
      expect(onError).not.toHaveBeenCalled();
    });
  });

});
