import '@/providers';

import { EventEmitter } from 'events';

import type { PreparedChatTurn } from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import { CursorChatRuntime } from '@/providers/cursor/runtime/CursorChatRuntime';
import { CURSOR_CLI_INLINE_PROMPT_MAX_CHARS } from '@/providers/cursor/runtime/cursorCliPrompt';

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

let readlineLines: string[] = [];

jest.mock('readline', () => ({
  createInterface: () => {
    const lines = [...readlineLines];
    const iface = new EventEmitter() as EventEmitter & {
      close: () => void;
      [Symbol.asyncIterator]: () => AsyncGenerator<string>;
    };
    iface.close = () => {
      iface.emit('close');
    };
    iface[Symbol.asyncIterator] = async function* () {
      for (const line of lines) {
        yield line;
      }
    };
    return iface;
  },
}));

jest.mock('@/providers/cursor/runtime/cursorLaunch', () => ({
  resolveCursorLaunch: jest.fn((cli: string, args: string[]) => ({
    command: cli,
    args,
  })),
}));

jest.mock('@/providers/cursor/runtime/cursorAgentEnv', () => ({
  buildCursorAgentEnvironment: jest.fn().mockReturnValue({}),
}));

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    app: {},
    settings: {
      permissionMode: 'normal',
      orchestratorSystemPrompt: '',
      ...((overrides.settings as object) ?? {}),
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/bin/cursor-agent'),
    ...overrides,
  };
}

function createPreparedTurn(content = 'hello'): PreparedChatTurn {
  return {
    request: { text: content },
    persistedContent: content,
    prompt: content,
    isCompact: false,
    mcpMentions: new Set(),
  };
}

function setupMockChild(exitCode = 0): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: jest.Mock } {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
    on: EventEmitter['on'];
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  const baseOn = child.on.bind(child);
  child.on = (event: string | symbol, listener: (...args: unknown[]) => void) => {
    const subscription = baseOn(event, listener);
    if (event === 'close') {
      queueMicrotask(() => child.emit('close', exitCode));
    }
    return subscription;
  };
  mockSpawn.mockImplementation(() => child);
  return child;
}

describe('CursorChatRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readlineLines = [];
  });

  it('syncConversationState sets active resume id from provider state', () => {
    const runtime = new CursorChatRuntime(createMockPlugin());
    runtime.syncConversationState({
      sessionId: 'sess-1',
      providerId: 'cursor',
      providerState: { chatSessionId: 'cursor-sess-99' },
      messages: [],
    } as any);

    readlineLines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cursor-sess-99' }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
    ];
    setupMockChild();

    return (async () => {
      const turn = createPreparedTurn();
      const gen = runtime.query(turn);
      const chunks = [];
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
      expect(runtime.getSessionId()).toBe('cursor-sess-99');
    })();
  });

  it('cancel kills the child and aborts the ask-user controller', () => {
    const runtime = new CursorChatRuntime(createMockPlugin());
    const child = setupMockChild();
    (runtime as any).child = child;
    (runtime as any).askUserQuestionAbortController = new AbortController();
    const abortSpy = jest.spyOn((runtime as any).askUserQuestionAbortController, 'abort');

    runtime.cancel();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(abortSpy).toHaveBeenCalled();
    expect((runtime as any).child).toBeNull();
  });

  it('consumeTurnMetadata returns planCompleted after a plan turn', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin({
      settings: { permissionMode: 'plan' },
    }));

    readlineLines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'plan-sess' }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'plan-1',
        tool_call: { createPlanToolCall: { args: { title: 'Plan' } } },
      }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'plan-1',
        tool_call: {
          createPlanToolCall: {
            args: { title: 'Plan' },
            result: { success: { message: 'ok' } },
          },
        },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
    ];
    setupMockChild();

    const gen = runtime.query(createPreparedTurn('plan please'));
    for await (const chunk of gen) {
      void chunk;
    }

    expect(runtime.consumeTurnMetadata()).toEqual({ planCompleted: true });
  });

  it('yields stderr error when CLI exits non-zero without a result event', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin());
    readlineLines = [];
    setupMockChild(2);

    const chunks = [];
    for await (const chunk of runtime.query(createPreparedTurn())) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ type: 'error', content: 'Cursor Agent exited with code 2' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('spills oversized prompts to @file argv (ENAMETOOLONG regression)', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin());
    const longPrompt = 'x'.repeat(CURSOR_CLI_INLINE_PROMPT_MAX_CHARS + 1);
    readlineLines = [
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
    ];
    setupMockChild();

    const gen = runtime.query(createPreparedTurn(longPrompt));
    for await (const chunk of gen) {
      void chunk;
    }

    const launchArgs = mockSpawn.mock.calls[0]?.[1] as string[] | undefined;
    expect(launchArgs).toBeDefined();
    const promptArg = launchArgs?.[launchArgs.length - 1];
    expect(promptArg?.startsWith('@')).toBe(true);
    expect(promptArg?.length).toBeLessThan(200);
  });

  it('rebuilds conversation history into the prompt when resume is unavailable', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin());
    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'first question', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'first answer', timestamp: 2 },
    ];

    readlineLines = [
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
    ];
    setupMockChild();

    const gen = runtime.query(createPreparedTurn('second question'), history);
    for await (const chunk of gen) {
      void chunk;
    }

    const launchArgs = mockSpawn.mock.calls[0]?.[1] as string[] | undefined;
    const promptArg = launchArgs?.[launchArgs.length - 1];
    expect(promptArg).toContain('first question');
    expect(promptArg).toContain('first answer');
    expect(promptArg).toContain('second question');
    expect(launchArgs).not.toContain('--resume');
  });

  it('buildSessionUpdates persists session id on the conversation', () => {
    const runtime = new CursorChatRuntime(createMockPlugin());
    (runtime as any).lastSessionId = 'stored-session';

    const updates = runtime.buildSessionUpdates({
      conversation: {
        id: 'c1',
        providerId: 'cursor',
        providerState: {},
      } as any,
      sessionInvalidated: false,
    });

    expect(updates.updates.sessionId).toBe('stored-session');
    expect(updates.updates.providerState).toMatchObject({ chatSessionId: 'stored-session' });
  });
});
