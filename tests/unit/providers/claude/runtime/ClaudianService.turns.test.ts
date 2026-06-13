import { MessageChannel } from '@/providers/claude/runtime/ClaudeMessageChannel';
import { buildHistoryRebuildRequest } from '@/providers/claude/runtime/claudeQueryTurnHelpers';

import {
  collectChunks,
  type MockMcpServerManager,
  sdkMock,
  setupClaudianServiceTest,
} from './claudianServiceTestKit';

describe('ClaudianService', () => {
  const ctx = setupClaudianServiceTest();
  let service: typeof ctx.service;
  let mockPlugin: typeof ctx.mockPlugin;
  let mockMcpManager: MockMcpServerManager;

  beforeEach(() => {
    ({ service, mockPlugin, mockMcpManager } = ctx);
  });

  describe('prepareTurn', () => {
    it('should return PreparedChatTurn with encoded prompt', () => {
      const result = service.prepareTurn({ text: 'hello world' });
      expect(result.request.text).toBe('hello world');
      expect(result.prompt).toBe('hello world');
      expect(result.persistedContent).toBe('hello world');
      expect(result.isCompact).toBe(false);
      expect(result.mcpMentions).toEqual(new Set());
    });

    it('should append current note context', () => {
      const result = service.prepareTurn({
        text: 'explain this',
        currentNotePath: 'notes/test.md',
      });
      expect(result.persistedContent).toContain('<current_note>');
      expect(result.persistedContent).toContain('notes/test.md');
    });

    it('should detect /compact and skip context', () => {
      const result = service.prepareTurn({
        text: '/compact',
        currentNotePath: 'notes/test.md',
      });
      expect(result.isCompact).toBe(true);
      expect(result.persistedContent).toBe('/compact');
    });

    it('should extract MCP mentions', () => {
      (mockMcpManager.extractMentions as jest.Mock).mockReturnValue(new Set(['server-a']));
      const result = service.prepareTurn({ text: '@server-a hello' });
      expect(result.mcpMentions).toEqual(new Set(['server-a']));
    });
  });


  describe('query with PreparedChatTurn', () => {
    it('should stream chunks when called with PreparedChatTurn', async () => {
      sdkMock.setMockMessages([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello!' }] } },
      ]);

      const turn = service.prepareTurn({ text: 'hello' });
      const chunks = await collectChunks(service.query(turn));

      const textChunks = chunks.filter(c => c.type === 'text');
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0].content).toBe('Hello!');
    });

    it('should forward conversation history', async () => {
      sdkMock.setMockMessages([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Response' }] } },
      ]);

      const turn = service.prepareTurn({ text: 'follow up' });
      const history = [
        { id: 'u1', role: 'user' as const, content: 'first', timestamp: 1 },
        { id: 'a1', role: 'assistant' as const, content: 'reply', timestamp: 2 },
      ];

      const chunks = await collectChunks(service.query(turn, history));
      expect(chunks.some(c => c.type === 'text')).toBe(true);
    });
  });


  describe('buildSDKUserMessage', () => {
    it('should build text-only message', () => {
      const message = (service as any).buildSDKUserMessage('Hello Claude');

      expect(message).toEqual({
        type: 'user',
        message: { role: 'user', content: 'Hello Claude' },
        parent_tool_use_id: null,
        session_id: '',
        uuid: expect.any(String),
      });
    });

    it('should include session ID when available', () => {
      service.setSessionId('session-abc');
      const message = (service as any).buildSDKUserMessage('Test');

      expect(message.session_id).toBe('session-abc');
    });

    it('should build message with images', () => {
      const images = [{
        id: 'img1',
        name: 'test.png',
        mediaType: 'image/png',
        data: 'base64data',
        size: 100,
        source: 'file',
      }];

      const message = (service as any).buildSDKUserMessage('Look at this', images);

      expect(message.message.content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } },
        { type: 'text', text: 'Look at this' },
      ]);
    });

    it('should omit text block when prompt is empty with images', () => {
      const images = [{
        id: 'img1',
        name: 'test.png',
        mediaType: 'image/png',
        data: 'base64data',
        size: 100,
        source: 'file',
      }];

      const message = (service as any).buildSDKUserMessage('  ', images);

      expect(message.message.content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } },
      ]);
    });

    it('should handle empty images array as text-only', () => {
      const message = (service as any).buildSDKUserMessage('Hello', []);

      expect(message.message.content).toBe('Hello');
    });
  });


  describe('buildPromptWithImages', () => {
    it('should return plain string when no images', () => {
      const result = (service as any).buildPromptWithImages('Hello');
      expect(result).toBe('Hello');
    });

    it('should return plain string when images is undefined', () => {
      const result = (service as any).buildPromptWithImages('Hello', undefined);
      expect(result).toBe('Hello');
    });

    it('should return plain string when images is empty', () => {
      const result = (service as any).buildPromptWithImages('Hello', []);
      expect(result).toBe('Hello');
    });

    it('should return async generator when images are provided', async () => {
      const images = [{
        id: 'img1',
        name: 'test.png',
        mediaType: 'image/png',
        data: 'base64data',
        size: 100,
        source: 'file',
      }];

      const result = (service as any).buildPromptWithImages('Describe', images);

      // Should be an async generator
      expect(typeof result[Symbol.asyncIterator]).toBe('function');

      const messages: any[] = [];
      for await (const msg of result) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('user');
      expect(messages[0].message.role).toBe('user');
      expect(messages[0].message.content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } },
        { type: 'text', text: 'Describe' },
      ]);
    });

    it('should omit text when prompt is whitespace with images', async () => {
      const images = [{
        id: 'img1',
        name: 'test.png',
        mediaType: 'image/png',
        data: 'base64data',
        size: 100,
        source: 'file',
      }];

      const result = (service as any).buildPromptWithImages('   ', images);

      const messages: any[] = [];
      for await (const msg of result) {
        messages.push(msg);
      }

      expect(messages[0].message.content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } },
      ]);
    });
  });


  describe('query() method', () => {
    beforeEach(() => {
      sdkMock.resetMockMessages();
    });

    afterEach(() => {
      sdkMock.resetMockMessages();
    });

    it('should yield error when vault path is not available', async () => {
      (mockPlugin as any).app.vault.adapter.basePath = undefined;

      const chunks = await collectChunks(service.query('hello'));

      expect(chunks).toEqual([{ type: 'error', content: 'Could not determine vault path' }]);
    });

    it('should yield error when CLI path is not available', async () => {
      (mockPlugin.getResolvedProviderCliPath as jest.Mock).mockReturnValue(null);

      const chunks = await collectChunks(service.query('hello'));

      expect(chunks).toEqual([{ type: 'error', content: expect.stringContaining('Claude CLI not found') }]);
    });

    it('should yield chunks from cold-start query', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'cold-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi!' }] } },
      ]);

      const chunks = await collectChunks(service.query('hello'));

      expect(chunks.length).toBeGreaterThan(0);
      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
    });

    it('should drop unsafe URL-based MCP servers at cold start and warn (SSRF vet)', async () => {
      mockMcpManager.getActiveServers.mockReturnValue({
        metadata: { type: 'http', url: 'http://169.254.169.254/mcp' },
        local: { type: 'sse', url: 'http://127.0.0.1:3845/sse' },
      });
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'vet-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } },
      ]);

      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      expect(sdkMock.getLastOptions()?.mcpServers).toEqual({
        local: { type: 'sse', url: 'http://127.0.0.1:3845/sse' },
      });
      const notice = chunks.find(c => c.type === 'notice');
      expect(notice).toMatchObject({
        level: 'warning',
        content: expect.stringContaining('"metadata"'),
      });
    });

    it('should capture session ID from cold-start response', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'captured-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
      ]);

      await collectChunks(service.query('hello'));

      expect(service.getSessionId()).toBe('captured-session');
    });

    it('should use persistent query when available', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'persistent-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } },
      ]);

      // Start a real persistent query via ensureReady mocking
      const startSpy = jest.spyOn(service as any, 'startPersistentQuery');
      startSpy.mockImplementation(async (...args: unknown[]) => {
        const [vaultPath, cliPath] = args as [string, string];
        const messageChannel = new MessageChannel();
        (service as any).messageChannel = messageChannel;
        (service as any).persistentQuery = sdkMock.query({ prompt: messageChannel, options: { cwd: vaultPath, pathToClaudeCodeExecutable: cliPath } as any });
        (service as any).currentConfig = (service as any).buildPersistentQueryConfig(vaultPath, cliPath, []);
        (service as any).startResponseConsumer();
      });

      await service.ensureReady();

      const chunks = await collectChunks(service.query('hello'));

      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
    });

    it('should rebuild history context when no session but has history', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'new-session' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
      ]);

      const history: any[] = [
        { id: '1', role: 'user', content: 'First question', timestamp: 1000 },
        { id: '2', role: 'assistant', content: 'First answer', timestamp: 1001 },
      ];

      // No session set, but has history → should force cold start
      const chunks = await collectChunks(service.query('follow up', undefined, history));

      const doneChunks = chunks.filter(c => c.type === 'done');
      expect(doneChunks).toHaveLength(1);
    });

    it('should handle errors in cold-start query', async () => {
      // Provide at least one message so the iterator runs and crash triggers
      sdkMock.setMockMessages([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } },
      ]);

      // Crash on first iteration (before emitting any message)
      sdkMock.simulateCrash(0);

      // Force cold-start to test the cold-start error handling path
      const chunks = await collectChunks(
        service.query('hello', undefined, undefined, { forceColdStart: true })
      );

      const errorChunks = chunks.filter(c => c.type === 'error');
      expect(errorChunks).toHaveLength(1);
      expect(errorChunks[0].content).toContain('Simulated consumer crash');
    });
  });


  describe('buildHistoryRebuildRequest', () => {
    it('should build request with history context', () => {
      const history: any[] = [
        { id: '1', role: 'user', content: 'Tell me about X', timestamp: 1000 },
        { id: '2', role: 'assistant', content: 'X is great', timestamp: 1001 },
      ];

      const result = buildHistoryRebuildRequest('New question', history);

      expect(result.prompt).toContain('Tell me about X');
      expect(result.prompt).toContain('X is great');
    });

    it('should include images from last user message', () => {
      const images = [{ id: 'img1', mediaType: 'image/png', data: 'abc', name: 'test.png', size: 100, source: 'file' }];
      const history: any[] = [
        { id: '1', role: 'user', content: 'Look', timestamp: 1000, images },
      ];

      const result = buildHistoryRebuildRequest('Follow up', history);

      expect(result.images).toEqual(images);
    });

    it('should return undefined images when last user message has no images', () => {
      const history: any[] = [
        { id: '1', role: 'user', content: 'No images', timestamp: 1000 },
      ];

      const result = buildHistoryRebuildRequest('Follow up', history);

      expect(result.images).toBeUndefined();
    });
  });


  describe('buildSDKUserMessage uuid', () => {
    it('assigns a uuid to text-only messages', () => {
      const message = (service as any).buildSDKUserMessage('Hello');
      expect(message.uuid).toBeDefined();
      expect(typeof message.uuid).toBe('string');
      expect(message.uuid.length).toBeGreaterThan(0);
    });

    it('assigns a uuid to image messages', () => {
      const images = [{ id: 'img1', name: 'test.png', mediaType: 'image/png', data: 'b64', size: 10, source: 'file' }];
      const message = (service as any).buildSDKUserMessage('Look', images);
      expect(message.uuid).toBeDefined();
      expect(typeof message.uuid).toBe('string');
    });

    it('assigns unique uuids to different messages', () => {
      const msg1 = (service as any).buildSDKUserMessage('Hello');
      const msg2 = (service as any).buildSDKUserMessage('World');
      expect(msg1.uuid).not.toBe(msg2.uuid);
    });
  });


  describe('normalizeTurnInvocation', () => {
    it('should route PreparedChatTurn with chatMessages as conversationHistory', () => {
      const turn = service.prepareTurn({ text: 'hello' });
      const chatMessages = [
        { id: 'u1', role: 'user' as const, content: 'first', timestamp: 1 },
        { id: 'a1', role: 'assistant' as const, content: 'reply', timestamp: 2 },
      ];

      const result = (service as any).normalizeTurnInvocation(turn, chatMessages);

      expect(result.encodedTurn).toBe(turn);
      expect(result.request).toBe(turn.request);
      expect(result.conversationHistory).toBe(chatMessages);
    });

    it('should route PreparedChatTurn with chatMessages and queryOptions', () => {
      const turn = service.prepareTurn({ text: 'hello' });
      const chatMessages = [
        { id: 'u1', role: 'user' as const, content: 'first', timestamp: 1 },
        { id: 'a1', role: 'assistant' as const, content: 'reply', timestamp: 2 },
      ];
      const queryOptions = { model: 'claude-3-opus' };

      const result = (service as any).normalizeTurnInvocation(turn, chatMessages, queryOptions);

      expect(result.encodedTurn).toBe(turn);
      expect(result.conversationHistory).toBe(chatMessages);
      expect(result.queryOptions?.model).toBe('claude-3-opus');
    });

    it('should route string with images, chatMessages, and queryOptions', () => {
      const images = [{ id: 'img1', name: 'test.png', mediaType: 'image/png', data: 'b64', size: 10, source: 'file' }];
      const chatMessages = [
        { id: 'u1', role: 'user' as const, content: 'first', timestamp: 1 },
        { id: 'a1', role: 'assistant' as const, content: 'reply', timestamp: 2 },
      ];
      const queryOptions = { forceColdStart: true };

      const result = (service as any).normalizeTurnInvocation('describe', images, chatMessages, queryOptions);

      expect(result.request.text).toBe('describe');
      expect(result.request.images).toBe(images);
      expect(result.conversationHistory).toBe(chatMessages);
      expect(result.queryOptions?.forceColdStart).toBe(true);
    });

    it('should route empty array as undefined conversationHistory', () => {
      const turn = service.prepareTurn({ text: 'hello' });

      const result = (service as any).normalizeTurnInvocation(turn, []);

      expect(result.conversationHistory).toBeUndefined();
    });
  });

});
