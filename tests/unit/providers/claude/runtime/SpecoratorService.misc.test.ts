import * as sdkModule from '@anthropic-ai/claude-agent-sdk';

import * as envUtils from '@/utils/env';
import * as sessionUtils from '@/utils/session';

import {
  collectChunks,
  type MockMcpServerManager,
  sdkMock,
  setupSpecoratorServiceTest,
} from './specoratorServiceTestKit';

describe('SpecoratorService', () => {
  const ctx = setupSpecoratorServiceTest();
  let service: typeof ctx.service;
  let mockPlugin: typeof ctx.mockPlugin;
  let mockMcpManager: MockMcpServerManager;

  beforeEach(() => {
    ({ service, mockPlugin, mockMcpManager } = ctx);
  });

  describe('MCP Server Management', () => {
    it('should reload MCP servers', async () => {
      await service.reloadMcpServers();

      expect(mockMcpManager.loadServers).toHaveBeenCalled();
    });
  });


  describe('SDK Skills (Supported Commands)', () => {
    it('should report not ready when no persistent query exists', () => {
      expect(service.isReady()).toBe(false);
    });

    it('should report ready when persistent query is active', () => {
      // Simulate active persistent query
      (service as any).persistentQuery = {};
      (service as any).shuttingDown = false;

      expect(service.isReady()).toBe(true);
    });

    it('should report not ready when shutting down', () => {
      (service as any).persistentQuery = {};
      (service as any).shuttingDown = true;

      expect(service.isReady()).toBe(false);
    });

    it('should return empty array when no persistent query', async () => {
      const commands = await service.getSupportedCommands();
      expect(commands).toEqual([]);
    });

    it('should convert SDK skills to SlashCommand format', async () => {
      const mockSdkCommands = [
        { name: 'commit', description: 'Create a git commit', argumentHint: '' },
        { name: 'pr', description: 'Create a pull request', argumentHint: '<title>' },
      ];

      const mockQuery = {
        supportedCommands: jest.fn().mockResolvedValue(mockSdkCommands),
      };
      (service as any).persistentQuery = mockQuery;

      const commands = await service.getSupportedCommands();

      expect(mockQuery.supportedCommands).toHaveBeenCalled();
      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual({
        id: 'sdk:commit',
        name: 'commit',
        description: 'Create a git commit',
        argumentHint: '',
        content: '',
        source: 'sdk',
      });
      expect(commands[1]).toEqual({
        id: 'sdk:pr',
        name: 'pr',
        description: 'Create a pull request',
        argumentHint: '<title>',
        content: '',
        source: 'sdk',
      });
    });

    it('should return empty array on SDK error', async () => {
      const mockQuery = {
        supportedCommands: jest.fn().mockRejectedValue(new Error('SDK error')),
      };
      (service as any).persistentQuery = mockQuery;

      const commands = await service.getSupportedCommands();

      expect(commands).toEqual([]);
    });

    it('should ignore late supportedCommands results from a stale query', async () => {
      let resolveStaleCommands: (commands: Array<{ name: string; description: string; argumentHint: string }>) => void;
      const staleCommandsPromise = new Promise<Array<{ name: string; description: string; argumentHint: string }>>((resolve) => {
        resolveStaleCommands = resolve;
      });

      const staleQuery = {
        supportedCommands: jest.fn().mockReturnValue(staleCommandsPromise),
      };
      const activeQuery = {
        supportedCommands: jest.fn().mockResolvedValue([
          { name: 'review', description: 'Review code', argumentHint: '' },
        ]),
      };

      (service as any).persistentQuery = staleQuery;
      const staleFetch = (service as any).fetchAndCacheCommands(staleQuery);

      (service as any).persistentQuery = activeQuery;
      const activeCommands = await (service as any).fetchAndCacheCommands(activeQuery);

      resolveStaleCommands!([
        { name: 'commit', description: 'Create a commit', argumentHint: '' },
      ]);
      const staleCommands = await staleFetch;

      expect(activeCommands).toEqual([{
        id: 'sdk:review',
        name: 'review',
        description: 'Review code',
        argumentHint: '',
        content: '',
        source: 'sdk',
      }]);
      expect(staleCommands).toEqual(activeCommands);
      expect((service as any).cachedSdkCommands).toEqual(activeCommands);
    });
  });


  describe('isPipeError', () => {
    it('should return true for EPIPE code', () => {
      const error = { code: 'EPIPE' };
      expect((service as any).isPipeError(error)).toBe(true);
    });

    it('should return true for EPIPE in message', () => {
      const error = { message: 'write EPIPE to stdin' };
      expect((service as any).isPipeError(error)).toBe(true);
    });

    it('should return false for other errors', () => {
      const error = { code: 'ENOENT', message: 'file not found' };
      expect((service as any).isPipeError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect((service as any).isPipeError(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect((service as any).isPipeError('string')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect((service as any).isPipeError(undefined)).toBe(false);
    });
  });


  describe('applyDynamicUpdates', () => {
    let mockPersistentQuery: any;

    beforeEach(async () => {
      sdkMock.resetMockMessages();

      // Start a persistent query via ensureReady
      const startSpy = jest.spyOn(service as any, 'startPersistentQuery');
      startSpy.mockImplementation(async (...args: unknown[]) => {
        const [vaultPath, cliPath, , externalContextPaths] = args as [string, string, string?, string[]?];
        mockPersistentQuery = {
          interrupt: jest.fn().mockResolvedValue(undefined),
          setModel: jest.fn().mockResolvedValue(undefined),
          setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
          setPermissionMode: jest.fn().mockResolvedValue(undefined),
          applyFlagSettings: jest.fn().mockResolvedValue(undefined),
          setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
        };
        (service as any).persistentQuery = mockPersistentQuery;
        (service as any).vaultPath = vaultPath;
        (service as any).currentConfig = (service as any).buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths);
      });

      await service.ensureReady({ externalContextPaths: [] });
    });

    it('should update model when changed', async () => {
      (mockPlugin as any).settings.model = 'claude-3-opus';

      await (service as any).applyDynamicUpdates({ model: 'claude-3-opus' });

      expect(mockPersistentQuery.setModel).toHaveBeenCalled();
    });

    it('should not update model when unchanged', async () => {
      await (service as any).applyDynamicUpdates({ model: 'claude-3-5-sonnet' });

      expect(mockPersistentQuery.setModel).not.toHaveBeenCalled();
    });

    it('should ignore legacy thinking budget changes', async () => {
      (mockPlugin as any).settings.model = 'custom-model';
      (service as any).currentConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path',
        '/usr/local/bin/claude',
        [],
      );
      (mockPlugin as any).settings.thinkingBudget = 'high';
      const ensureReadySpy = jest.spyOn(service, 'ensureReady').mockResolvedValue(true);

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.setMaxThinkingTokens).not.toHaveBeenCalled();
      expect(ensureReadySpy).not.toHaveBeenCalled();
    });

    it('should update effort level when changed for adaptive models', async () => {
      (mockPlugin as any).settings.model = 'sonnet';
      (mockPlugin as any).settings.effortLevel = 'max';

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'max' });
      expect((service as any).currentConfig.effortLevel).toBe('max');
    });

    it('should update effort level for custom model ids', async () => {
      (mockPlugin as any).settings.model = 'custom-model';
      (mockPlugin as any).settings.effortLevel = 'max';

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'max' });
    });

    it('should keep effort active when switching from custom to built-in model ids', async () => {
      (mockPlugin as any).settings.model = 'custom-model';
      (mockPlugin as any).settings.thinkingBudget = 'high';
      (service as any).currentConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path',
        '/usr/local/bin/claude',
        [],
      );

      mockPersistentQuery.setModel.mockClear();
      mockPersistentQuery.setMaxThinkingTokens.mockClear();
      mockPersistentQuery.applyFlagSettings.mockClear();

      (mockPlugin as any).settings.model = 'sonnet';
      (mockPlugin as any).settings.effortLevel = 'max';

      const previousQuery = mockPersistentQuery;
      await (service as any).applyDynamicUpdates({});

      expect(previousQuery.setMaxThinkingTokens).not.toHaveBeenCalled();
      expect((service as any).currentConfig.effortLevel).toBe('max');
    });

    it('should keep effort active when switching from built-in to custom model ids', async () => {
      (mockPlugin as any).settings.model = 'sonnet';
      (mockPlugin as any).settings.thinkingBudget = 'high';
      (mockPlugin as any).settings.effortLevel = 'max';
      (service as any).currentConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path',
        '/usr/local/bin/claude',
        [],
      );

      mockPersistentQuery.setModel.mockClear();
      mockPersistentQuery.setMaxThinkingTokens.mockClear();
      mockPersistentQuery.applyFlagSettings.mockClear();

      (mockPlugin as any).settings.model = 'custom-model';

      const previousQuery = mockPersistentQuery;
      await (service as any).applyDynamicUpdates({});

      expect(previousQuery.setMaxThinkingTokens).not.toHaveBeenCalled();
      expect((service as any).currentConfig.effortLevel).toBe('max');
    });

    it('should update permission mode when changed', async () => {
      (mockPlugin as any).settings.permissionMode = 'yolo';

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.setPermissionMode).toHaveBeenCalledWith('bypassPermissions');
    });

    it('should update permission mode when claudeSafeMode changes within normal mode', async () => {
      (mockPlugin as any).settings.permissionMode = 'normal';
      (mockPlugin as any).settings.claudeSafeMode = 'acceptEdits';
      (service as any).currentConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path',
        '/usr/local/bin/claude',
        [],
      );

      mockPersistentQuery.setPermissionMode.mockClear();
      (mockPlugin as any).settings.claudeSafeMode = 'default';

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.setPermissionMode).toHaveBeenCalledWith('default');
      expect((service as any).currentConfig.permissionMode).toBe('normal');
      expect((service as any).currentConfig.sdkPermissionMode).toBe('default');
    });

    it('should update permission mode when claudeSafeMode switches back to acceptEdits', async () => {
      (mockPlugin as any).settings.permissionMode = 'normal';
      (mockPlugin as any).settings.claudeSafeMode = 'default';
      (service as any).currentConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path',
        '/usr/local/bin/claude',
        [],
      );

      mockPersistentQuery.setPermissionMode.mockClear();
      (mockPlugin as any).settings.claudeSafeMode = 'acceptEdits';

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
      expect((service as any).currentConfig.permissionMode).toBe('normal');
      expect((service as any).currentConfig.sdkPermissionMode).toBe('acceptEdits');
    });

    it('should restart before applying auto mode when auto opt-in was not enabled', async () => {
      (mockPlugin as any).settings.permissionMode = 'normal';
      (mockPlugin as any).settings.claudeSafeMode = 'acceptEdits';
      (service as any).currentConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path',
        '/usr/local/bin/claude',
        [],
      );

      mockPersistentQuery.setPermissionMode.mockClear();
      (service as any).startPersistentQuery.mockClear();
      (mockPlugin as any).settings.claudeSafeMode = 'auto';

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.setPermissionMode).not.toHaveBeenCalled();
      expect((service as any).startPersistentQuery).toHaveBeenCalledTimes(1);
      expect((service as any).currentConfig.permissionMode).toBe('normal');
      expect((service as any).currentConfig.sdkPermissionMode).toBe('auto');
      expect((service as any).currentConfig.enableAutoMode).toBe(true);
    });

    it('should update permission mode to auto dynamically when auto opt-in is already enabled', async () => {
      (mockPlugin as any).settings.permissionMode = 'yolo';
      (mockPlugin as any).settings.claudeSafeMode = 'auto';
      (service as any).currentConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path',
        '/usr/local/bin/claude',
        [],
      );

      mockPersistentQuery.setPermissionMode.mockClear();
      (service as any).startPersistentQuery.mockClear();
      (mockPlugin as any).settings.permissionMode = 'normal';

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.setPermissionMode).toHaveBeenCalledWith('auto');
      expect((service as any).startPersistentQuery).not.toHaveBeenCalled();
      expect((service as any).currentConfig.permissionMode).toBe('normal');
      expect((service as any).currentConfig.sdkPermissionMode).toBe('auto');
      expect((service as any).currentConfig.enableAutoMode).toBe(true);
    });

    it('should update MCP servers when changed', async () => {
      mockMcpManager.getActiveServers.mockReturnValue({
        'test-server': { command: 'test', args: [] },
      });

      await (service as any).applyDynamicUpdates({
        mcpMentions: new Set(['test-server']),
      });

      expect(mockPersistentQuery.setMcpServers).toHaveBeenCalled();
    });

    it('should not restart when allowRestart is false', async () => {
      // Change something that would trigger restart
      (mockPlugin.getResolvedProviderCliPath as jest.Mock).mockReturnValue('/new/path/to/claude');

      const ensureReadySpy = jest.spyOn(service, 'ensureReady');

      await (service as any).applyDynamicUpdates({}, undefined, false);

      // ensureReady should NOT be called for restart when allowRestart is false
      expect(ensureReadySpy).not.toHaveBeenCalled();
    });

    it('should return early when no persistent query', async () => {
      (service as any).persistentQuery = null;

      // Should not throw
      await expect((service as any).applyDynamicUpdates({})).resolves.toBeUndefined();
    });

    it('should return early when no vault path', async () => {
      (service as any).vaultPath = null;

      await (service as any).applyDynamicUpdates({});

      expect(mockPersistentQuery.setModel).not.toHaveBeenCalled();
    });

    it('should silently handle model update error', async () => {
      (mockPlugin as any).settings.model = 'claude-3-opus';
      mockPersistentQuery.setModel.mockRejectedValueOnce(new Error('Model error'));

      await expect((service as any).applyDynamicUpdates({ model: 'claude-3-opus' })).resolves.toBeUndefined();
    });

    it('should not dynamically update legacy thinking budget', async () => {
      (mockPlugin as any).settings.model = 'custom-model';
      (service as any).currentConfig = (service as any).buildPersistentQueryConfig(
        '/mock/vault/path',
        '/usr/local/bin/claude',
        [],
      );
      (mockPlugin as any).settings.thinkingBudget = 'high';
      const ensureReadySpy = jest.spyOn(service, 'ensureReady').mockResolvedValue(true);

      await expect((service as any).applyDynamicUpdates({})).resolves.toBeUndefined();
      expect(mockPersistentQuery.setMaxThinkingTokens).not.toHaveBeenCalled();
      expect(ensureReadySpy).not.toHaveBeenCalled();
    });

    it('should silently handle permission mode update error', async () => {
      (mockPlugin as any).settings.permissionMode = 'yolo';
      mockPersistentQuery.setPermissionMode.mockRejectedValueOnce(new Error('Permission error'));

      await expect((service as any).applyDynamicUpdates({})).resolves.toBeUndefined();
    });

    it('should silently handle effort level update error', async () => {
      (mockPlugin as any).settings.model = 'sonnet';
      (mockPlugin as any).settings.effortLevel = 'max';
      mockPersistentQuery.applyFlagSettings.mockRejectedValueOnce(new Error('Effort error'));

      await expect((service as any).applyDynamicUpdates({})).resolves.toBeUndefined();
    });

    it('should silently handle MCP servers update error', async () => {
      mockMcpManager.getActiveServers.mockReturnValue({ 'server-1': { command: 'cmd' } });
      mockPersistentQuery.setMcpServers.mockRejectedValueOnce(new Error('MCP error'));

      await expect((service as any).applyDynamicUpdates({ mcpMentions: new Set(['server-1']) })).resolves.toBeUndefined();
    });

    it('should drop unsafe URL-based MCP servers before setMcpServers (SSRF vet)', async () => {
      mockMcpManager.getActiveServers.mockReturnValue({
        metadata: { type: 'http', url: 'http://169.254.169.254/mcp' },
        ok: { command: 'cmd' },
        local: { type: 'sse', url: 'http://127.0.0.1:3845/sse' },
      });

      await (service as any).applyDynamicUpdates({ mcpMentions: new Set(['metadata', 'ok', 'local']) });

      expect(mockPersistentQuery.setMcpServers).toHaveBeenCalledWith({
        ok: { command: 'cmd' },
        local: { type: 'sse', url: 'http://127.0.0.1:3845/sse' },
      });
    });
  });


  describe('query() - missing node error', () => {
    beforeEach(() => {
      sdkMock.resetMockMessages();
    });

    afterEach(() => {
      sdkMock.resetMockMessages();
      jest.restoreAllMocks();
    });


    it('should yield error when Node.js is missing', async () => {
      jest.spyOn(envUtils, 'getMissingNodeError').mockReturnValueOnce(
        'Claude Code CLI requires Node.js, but Node was not found'
      );

      const chunks = await collectChunks(service.query('hello'));

      const errorChunks = chunks.filter(c => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].content).toContain('Node.js');
    });
  });


  describe('query() - interrupted flag and history rebuild', () => {
    beforeEach(() => {
      sdkMock.resetMockMessages();
    });

    afterEach(() => {
      sdkMock.resetMockMessages();
    });


    it('should clear interrupted flag before query', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'session-1' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
      ]);

      // Set interrupted state
      (service as any).sessionManager.markInterrupted();
      expect((service as any).sessionManager.wasInterrupted()).toBe(true);

      await collectChunks(service.query('hello'));

      expect((service as any).sessionManager.wasInterrupted()).toBe(false);
    });

    it('should rebuild history on session mismatch', async () => {
      // Use same session_id as the one we set to avoid captureSession re-setting the flag
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'old-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
      ]);

      // Set up session mismatch state: capture a session, then directly set the flag
      service.setSessionId('old-session');
      (service as any).sessionManager.state.needsHistoryRebuild = true;

      const history: any[] = [
        { id: '1', role: 'user', content: 'Previous question', timestamp: 1000 },
        { id: '2', role: 'assistant', content: 'Previous answer', timestamp: 1001 },
      ];

      // Spy on buildPromptWithHistoryContext to verify it's called
      const buildSpy = jest.spyOn(sessionUtils, 'buildPromptWithHistoryContext');

      const chunks = await collectChunks(service.query('follow up', undefined, history));

      // Should complete successfully
      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
      // History rebuild function should have been called
      expect(buildSpy).toHaveBeenCalled();
    });
  });


  describe('applyDynamicUpdates - cliPath null', () => {
    it('should return early when cliPath is null', async () => {
      (service as any).persistentQuery = { setModel: jest.fn() };
      (service as any).vaultPath = '/vault';
      (mockPlugin.getResolvedProviderCliPath as jest.Mock).mockReturnValue(null);

      const setModelSpy = (service as any).persistentQuery.setModel;

      await (service as any).applyDynamicUpdates({});

      expect(setModelSpy).not.toHaveBeenCalled();
    });
  });


  describe('applyDynamicUpdates - restart needed', () => {
    it('should restart and re-apply when config changes require restart', async () => {
      sdkMock.resetMockMessages();
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'restart-session' },
      ]);

      // Set up mock persistent query
      const mockPQ = {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setMcpServers: jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} }),
      };
      (service as any).persistentQuery = mockPQ;
      (service as any).vaultPath = '/mock/vault/path';
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
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

      // Change CLI path to trigger restart
      (mockPlugin.getResolvedProviderCliPath as jest.Mock).mockReturnValue('/new/path/to/claude');

      // Mock ensureReady to return true (restarted)
      const ensureReadySpy = jest.spyOn(service, 'ensureReady').mockResolvedValue(true);

      await (service as any).applyDynamicUpdates({});

      expect(ensureReadySpy).toHaveBeenCalledWith(
        expect.objectContaining({ force: true })
      );
    });
  });


  describe('query() - non-session-expired cold-start error', () => {
    beforeEach(() => {
      sdkMock.resetMockMessages();
    });

    afterEach(() => {
      sdkMock.resetMockMessages();
      jest.restoreAllMocks();
    });


    it('should yield error chunk for non-session-expired errors in cold-start path', async () => {
      jest.spyOn(sdkModule, 'query' as any).mockImplementation(() => {
        // eslint-disable-next-line require-yield
        const gen = (async function* () {
          throw new Error('connection timeout');
        })() as any;
        gen.interrupt = jest.fn();
        gen.setModel = jest.fn();
        gen.setMaxThinkingTokens = jest.fn();
        gen.setPermissionMode = jest.fn();
        gen.setMcpServers = jest.fn();
        return gen;
      });

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const errorChunks = chunks.filter(c => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].content).toBe('connection timeout');
    });

    it('should handle non-Error thrown values in cold-start path', async () => {
      jest.spyOn(sdkModule, 'query' as any).mockImplementation(() => {
        // eslint-disable-next-line require-yield
        const gen = (async function* () {
          throw 'string error';
        })() as any;
        gen.interrupt = jest.fn();
        gen.setModel = jest.fn();
        gen.setMaxThinkingTokens = jest.fn();
        gen.setPermissionMode = jest.fn();
        gen.setMcpServers = jest.fn();
        return gen;
      });

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const errorChunks = chunks.filter(c => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].content).toBe('Unknown error');
    });
  });


  describe('queryViaSDK - abort signal handling', () => {
    beforeEach(() => {
      sdkMock.resetMockMessages();
    });

    afterEach(() => {
      sdkMock.resetMockMessages();
      jest.restoreAllMocks();
    });

    it('should interrupt response when abort signal is triggered during iteration', async () => {
      const abortController = new AbortController();
      (service as any).abortController = abortController;

      let interruptCalled = false;
      // Set up messages that allow us to abort mid-stream
      jest.spyOn(sdkModule, 'query' as any).mockImplementation(() => {
        const messages = [
          { type: 'system', subtype: 'init', session_id: 'abort-session' },
          { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
          // Third message won't be yielded because we abort after the second
          { type: 'assistant', message: { content: [{ type: 'text', text: 'World' }] } },
        ];

        let index = 0;
        const gen = {
          [Symbol.asyncIterator]() { return this; },
          async next() {
            if (index >= messages.length) return { done: true, value: undefined };
            const msg = messages[index++];
            // Abort after yielding the second message
            if (index === 2) {
              abortController.abort();
            }
            return { done: false, value: msg };
          },
          async return() { return { done: true, value: undefined }; },
          interrupt: jest.fn().mockImplementation(async () => { interruptCalled = true; }),
          setModel: jest.fn(),
          setMaxThinkingTokens: jest.fn(),
          setPermissionMode: jest.fn(),
          setMcpServers: jest.fn(),
        };
        return gen;
      });

      const chunks: any[] = [];
      for await (const chunk of (service as any).queryViaSDK(
        'hello', '/mock/vault/path', '/usr/local/bin/claude', undefined, { forceColdStart: true }
      )) {
        chunks.push(chunk);
      }

      // interrupt should have been called
      expect(interruptCalled).toBe(true);
    });
  });


  describe('queryViaSDK - stream content dedup and allowedTools', () => {
    beforeEach(() => {
      sdkMock.resetMockMessages();
    });

    afterEach(() => {
      sdkMock.resetMockMessages();
      jest.restoreAllMocks();
    });


    it('should set allowedTools in cold-start query', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'allowed-cs' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } },
      ]);

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, {
          forceColdStart: true,
          allowedTools: ['Read', 'Write'],
        })
      );

      expect(chunks.some(c => c.type === 'done')).toBe(true);
    });

    it('should handle visible stream text events and skip duplicate assistant text', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'stream-dedup' },
        { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: 'Hello' } } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
      ], { appendResult: true });

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const textChunks = chunks.filter(c => c.type === 'text');
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0].content).toBe('Hello');
      expect(chunks.some(c => c.type === 'done')).toBe(true);
    });

    it('should keep assistant text when text deltas were empty', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'empty-text-delta' },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } },
        },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
      ], { appendResult: true });

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const textChunks = chunks.filter(c => c.type === 'text');
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0].content).toBe('Hello');
    });

    it('should skip duplicate assistant thinking after visible stream thinking', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'thinking-dedup' },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'thinking', thinking: 'Reasoning...' },
          },
        },
        {
          type: 'assistant',
          message: { content: [{ type: 'thinking', thinking: 'Reasoning...' }] },
        },
      ], { appendResult: true });

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const thinkingChunks = chunks.filter(c => c.type === 'thinking');
      expect(thinkingChunks).toHaveLength(1);
      expect(thinkingChunks[0].content).toBe('Reasoning...');
    });

    it('should keep assistant thinking when thinking deltas were empty', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'empty-thinking-delta' },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } },
        },
        {
          type: 'assistant',
          message: { content: [{ type: 'thinking', thinking: 'Reasoning...' }] },
        },
      ], { appendResult: true });

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const thinkingChunks = chunks.filter(c => c.type === 'thinking');
      expect(thinkingChunks).toHaveLength(1);
      expect(thinkingChunks[0].content).toBe('Reasoning...');
    });

    it('should stream cumulative tool input updates during cold-start query', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'stream-tool-input' },
        {
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
        },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'input_json_delta',
              partial_json: '{"file_path":"notes.md"',
            },
          },
        },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'input_json_delta',
              partial_json: ',"content":"Hello"',
            },
          },
        },
      ], { appendResult: true });

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const toolChunks = chunks.filter(c => c.type === 'tool_use');
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
        {
          type: 'tool_use',
          id: 'stream-tool-1',
          name: 'Write',
          input: { file_path: 'notes.md', content: 'Hello' },
        },
      ]);
      expect(chunks.some(c => c.type === 'done')).toBe(true);
    });

    it('should yield usage chunks with sessionId', async () => {
      service.setSessionId('usage-cold-session');
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'usage-cold-session' },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hi' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 20,
            },
          },
        },
      ], { appendResult: true });

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const usageChunks = chunks.filter(c => c.type === 'usage');
      expect(usageChunks.length).toBeGreaterThan(0);
      expect(usageChunks[0].sessionId).toBe('usage-cold-session');
      expect(chunks.some(c => c.type === 'done')).toBe(true);
    });
  });


  describe('rewindFiles', () => {
    it('throws when no persistentQuery', async () => {
      (service as any).persistentQuery = null;
      await expect(service.rewindFiles('uuid')).rejects.toThrow('No active query');
    });

    it('throws when shuttingDown', async () => {
      (service as any).persistentQuery = { rewindFiles: jest.fn() };
      (service as any).shuttingDown = true;
      await expect(service.rewindFiles('uuid')).rejects.toThrow('Service is shutting down');
      (service as any).shuttingDown = false;
    });

    it('calls persistentQuery.rewindFiles with correct args', async () => {
      const mockRewindFiles = jest.fn().mockResolvedValue({ canRewind: true, filesChanged: ['a.txt'] });
      (service as any).persistentQuery = { rewindFiles: mockRewindFiles };
      (service as any).shuttingDown = false;

      const result = await service.rewindFiles('test-uuid', true);

      expect(mockRewindFiles).toHaveBeenCalledWith('test-uuid', { dryRun: true });
      expect(result).toEqual({ canRewind: true, filesChanged: ['a.txt'] });
    });
  });


  describe('rewind', () => {
    it('conversation-only mode skips SDK file rewind and prepares resume checkpoint', async () => {
      const mockRewindFiles = jest.fn();
      const mockInterrupt = jest.fn().mockResolvedValue(undefined);
      (service as any).persistentQuery = { rewindFiles: mockRewindFiles, interrupt: mockInterrupt };
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).shuttingDown = false;

      const result = await service.rewind('user-uuid', 'assistant-uuid', 'conversation');

      expect(mockRewindFiles).not.toHaveBeenCalled();
      expect(result).toEqual({ canRewind: true, filesChanged: [] });
      expect((service as any).pendingResumeAt).toBe('assistant-uuid');
      expect((service as any).persistentQuery).toBeNull();
    });

    it('dry-runs first to capture filesChanged, then performs actual rewind', async () => {
      // SDK only returns filesChanged on dry run, not on actual rewind
      const mockRewindFiles = jest.fn()
        .mockResolvedValueOnce({ canRewind: true, filesChanged: ['a.txt'], insertions: 5, deletions: 3 })
        .mockResolvedValueOnce({ canRewind: true });
      const mockInterrupt = jest.fn().mockResolvedValue(undefined);
      (service as any).persistentQuery = { rewindFiles: mockRewindFiles, interrupt: mockInterrupt };
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).shuttingDown = false;

      const result = await service.rewind('user-uuid', 'assistant-uuid');

      expect(mockRewindFiles).toHaveBeenCalledTimes(2);
      expect(mockRewindFiles).toHaveBeenNthCalledWith(1, 'user-uuid', { dryRun: true });
      expect(mockRewindFiles).toHaveBeenNthCalledWith(2, 'user-uuid', { dryRun: undefined });
      expect(result.canRewind).toBe(true);
      expect(result.filesChanged).toEqual(['a.txt']);
      expect(result.insertions).toBe(5);
      expect(result.deletions).toBe(3);
      expect((service as any).pendingResumeAt).toBe('assistant-uuid');
      expect((service as any).persistentQuery).toBeNull();
    });

    it('returns error without closing query when dry-run canRewind is false', async () => {
      const mockRewindFiles = jest.fn().mockResolvedValue({ canRewind: false, error: 'No checkpoint' });
      (service as any).persistentQuery = { rewindFiles: mockRewindFiles };
      (service as any).shuttingDown = false;

      const result = await service.rewind('user-uuid', 'assistant-uuid');

      expect(result.canRewind).toBe(false);
      expect(result.error).toBe('No checkpoint');
      // Only dry run should have been called
      expect(mockRewindFiles).toHaveBeenCalledTimes(1);
      // Query should NOT be closed
      expect((service as any).persistentQuery).not.toBeNull();
    });

    it('closes the query when actual rewind canRewind is false', async () => {
      const mockRewindFiles = jest.fn()
        .mockResolvedValueOnce({ canRewind: true, filesChanged: ['a.txt'] })
        .mockResolvedValueOnce({ canRewind: false, error: 'Unexpected error' });
      const mockInterrupt = jest.fn().mockResolvedValue(undefined);
      (service as any).persistentQuery = { rewindFiles: mockRewindFiles, interrupt: mockInterrupt };
      (service as any).messageChannel = { close: jest.fn() };
      (service as any).queryAbortController = { abort: jest.fn() };
      (service as any).shuttingDown = false;

      const result = await service.rewind('user-uuid', 'assistant-uuid');

      expect(result.canRewind).toBe(false);
      expect(result.error).toBe('Unexpected error');
      expect((service as any).pendingResumeAt).toBeUndefined();
      expect((service as any).persistentQuery).toBeNull();
    });
  });

});
