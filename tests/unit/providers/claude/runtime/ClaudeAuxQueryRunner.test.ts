import '@/providers';

// eslint-disable-next-line jest/no-mocks-import
import {
  getLastOptions,
  resetMockMessages,
  setMockMessages,
} from '@test/__mocks__/claude-agent-sdk';

import { ClaudeAuxQueryRunner } from '@/providers/claude/runtime/ClaudeAuxQueryRunner';

function createMockPlugin(settings = {}): any {
  return {
    settings: {
      model: 'sonnet',
      thinkingBudget: 'off',
      ...settings,
    },
    app: {
      vault: { adapter: { basePath: '/test/vault/path' } },
    },
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/fake/claude'),
  };
}

function mockAssistantReply(text: string, sessionId = 'session-1'): void {
  setMockMessages([
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'assistant', message: { content: [{ type: 'text', text }] } },
    { type: 'result' },
  ]);
}

describe('ClaudeAuxQueryRunner', () => {
  let plugin: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockMessages();
    plugin = createMockPlugin();
  });

  it('passes configured tools and resolved model through to the cold-start query', async () => {
    mockAssistantReply('hello');
    const runner = new ClaudeAuxQueryRunner(plugin, {
      tools: [],
      resolveModel: () => 'haiku-custom',
    });

    const text = await runner.query({ systemPrompt: 'sys' }, 'do the thing');

    expect(text).toBe('hello');
    const options = getLastOptions();
    expect(options?.tools).toEqual([]);
    expect(options?.model).toBe('haiku-custom');
    expect(options?.systemPrompt).toBe('sys');
  });

  it('disables thinking and skips session persistence when configured', async () => {
    mockAssistantReply('title');
    const runner = new ClaudeAuxQueryRunner(plugin, {
      disableThinking: true,
      persistSession: false,
    });

    await runner.query({ systemPrompt: 'sys' }, 'prompt');

    const options = getLastOptions();
    expect(options?.thinking).toBeUndefined();
    expect(options?.persistSession).toBe(false);
  });

  it('resumes the captured session id across calls (conversation continuity)', async () => {
    mockAssistantReply('first', 'session-abc');
    const runner = new ClaudeAuxQueryRunner(plugin);

    await runner.query({ systemPrompt: 'sys' }, 'first');
    expect(getLastOptions()?.resume).toBeUndefined();

    mockAssistantReply('second', 'session-abc');
    await runner.query({ systemPrompt: 'sys' }, 'second');
    expect(getLastOptions()?.resume).toBe('session-abc');
  });

  it('reset() ends the conversation so the next call starts fresh', async () => {
    mockAssistantReply('first', 'session-abc');
    const runner = new ClaudeAuxQueryRunner(plugin);

    await runner.query({ systemPrompt: 'sys' }, 'first');
    runner.reset();

    mockAssistantReply('second', 'session-def');
    await runner.query({ systemPrompt: 'sys' }, 'second');
    expect(getLastOptions()?.resume).toBeUndefined();
  });

  it('prefers the per-query model override when no resolveModel is provided', async () => {
    mockAssistantReply('ok');
    const runner = new ClaudeAuxQueryRunner(plugin, { tools: [] });

    await runner.query({ systemPrompt: 'sys', model: 'opus' }, 'prompt');
    expect(getLastOptions()?.model).toBe('opus');
  });
});
