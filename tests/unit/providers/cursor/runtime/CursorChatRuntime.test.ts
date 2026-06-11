import '@/providers';

import { createMockRuntimeHost } from '@test/helpers/runtimeHost';
import { EventEmitter } from 'events';

import type { PreparedChatTurn } from '@/core/runtime/types';
import type { ChatMessage, StreamChunk } from '@/core/types';
import { CURSOR_ASK_ANSWER_FOLLOWUP_NOTE } from '@/providers/cursor/runtime/cursorAskUserQuestion';
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
  // Real ChildProcess exposes exitCode === null while running; terminateChild
  // relies on that to distinguish a live child from an already-exited one.
  (child as unknown as { exitCode: number | null }).exitCode = null;
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
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
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

  it('does not spawn cursor-agent at construction or passive session sync (load-time contract)', () => {
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
    runtime.syncConversationState({
      sessionId: 'sess-1',
      providerId: 'cursor',
      providerState: { chatSessionId: 'cursor-sess-99' },
      messages: [],
    } as any);

    // Plugin onload / view restore only constructs runtimes and syncs state;
    // the CLI process must spawn on the first query(), not at load time.
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('cancel kills the child and aborts the ask-user controller', () => {
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
    const child = setupMockChild();
    (runtime as any).child = child;
    (runtime as any).askUserQuestionAbortController = new AbortController();
    const abortSpy = jest.spyOn((runtime as any).askUserQuestionAbortController, 'abort');

    runtime.cancel();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(abortSpy).toHaveBeenCalled();
    expect((runtime as any).child).toBeNull();
  });

  it('cancel escalates to SIGKILL when the child ignores SIGTERM (posix)', () => {
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    jest.useFakeTimers();
    try {
      const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
      const child = setupMockChild();
      (child as any).exitCode = null;
      (child as any).signalCode = null;
      (runtime as any).child = child;

      runtime.cancel();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Child never emits exit → escalate after the timeout.
      jest.advanceTimersByTime(3_000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      jest.useRealTimers();
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    }
  });

  it('escalates to a taskkill tree-kill on win32 when the child ignores the initial signal', () => {
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    jest.useFakeTimers();
    try {
      const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
      const child = setupMockChild();
      (child as any).exitCode = null;
      (child as any).signalCode = null;
      (child as any).pid = 4242;
      (runtime as any).child = child;

      runtime.cancel();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      jest.advanceTimersByTime(3_000);
      // On Windows SIGKILL is unreliable and orphans bash/git descendants, so
      // teardown reaps the whole tree with taskkill /T /F instead.
      const treeKill = mockSpawn.mock.calls.find(
        (call) => call[0] === 'taskkill',
      );
      expect(treeKill).toBeDefined();
      expect(treeKill?.[1]).toEqual(
        expect.arrayContaining(['/PID', '4242', '/T', '/F']),
      );
    } finally {
      jest.useRealTimers();
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    }
  });

  it('cancel does not SIGKILL a child that already exited', () => {
    jest.useFakeTimers();
    try {
      const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
      const child = setupMockChild();
      (child as any).exitCode = 0;
      (child as any).signalCode = null;
      (runtime as any).child = child;

      runtime.cancel();
      jest.advanceTimersByTime(3_000);
      expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    } finally {
      jest.useRealTimers();
    }
  });

  it('cleanup issues SIGTERM synchronously within the cleanup() call frame (onunload contract)', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
    const child = setupMockChild();
    (runtime as any).child = child;

    const cleanupPromise = runtime.cleanup();
    // Plugin onunload is synchronous and fire-and-forget: the SIGTERM must be
    // initiated before cleanup() first suspends, or cursor-agent can be orphaned.
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    child.emit('exit', 0);
    await cleanupPromise;
  });

  it('cleanup resolves once the child emits exit', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
    const child = setupMockChild();
    (runtime as any).child = child;

    let resolved = false;
    const cleanupPromise = runtime.cleanup().then(() => {
      resolved = true;
    });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    // cleanup must not resolve until the child actually exits.
    await Promise.resolve();
    expect(resolved).toBe(false);

    child.emit('exit', 0);
    await cleanupPromise;
    expect(resolved).toBe(true);
    expect((runtime as any).child).toBeNull();
  });

  it('cleanup escalates to SIGKILL and then resolves on the give-up ceiling', async () => {
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    jest.useFakeTimers();
    try {
      const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
      const child = setupMockChild();
      (child as any).exitCode = null;
      (child as any).signalCode = null;
      (runtime as any).child = child;

      let resolved = false;
      const cleanupPromise = runtime.cleanup().then(() => {
        resolved = true;
      });

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Child ignores SIGTERM → escalate to SIGKILL after the timeout.
      jest.advanceTimersByTime(3_000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      // Still no exit → the hard give-up ceiling resolves so teardown can't hang.
      expect(resolved).toBe(false);
      jest.advanceTimersByTime(3_000);
      await Promise.resolve();
      await cleanupPromise;
      expect(resolved).toBe(true);
    } finally {
      jest.useRealTimers();
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    }
  });

  it('cleanup resolves immediately when there is no live child', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
    await expect(runtime.cleanup()).resolves.toBeUndefined();
  });

  it('cleanup after cancel awaits the in-flight termination (no switch overlap)', async () => {
    // cancel() starts terminateChild() and nulls this.child; a following cleanup()
    // (e.g. immediate provider switch) must await that in-flight kill rather than
    // resolving early while cursor-agent is still alive.
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
    const child = setupMockChild();
    (child as any).exitCode = null;
    (runtime as any).child = child;

    runtime.cancel();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect((runtime as any).child).toBeNull();

    let resolved = false;
    const cleanupPromise = runtime.cleanup().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false); // still waiting on the cancel-initiated exit

    child.emit('exit', 0);
    await cleanupPromise;
    expect(resolved).toBe(true);
  });

  it('consumeTurnMetadata returns planCompleted after a plan turn', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin({
      settings: { permissionMode: 'plan' },
    }), createMockRuntimeHost());

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

  it('consumeTurnMetadata carries an answer follow-up after AskUserQuestion is answered', async () => {
    // The inline widget keys answers by question id; the follow-up must resolve
    // that id back to the displayed prompt text.
    const runtime = new CursorChatRuntime(
      createMockPlugin(),
      createMockRuntimeHost({ askUser: jest.fn().mockResolvedValue({ focus: 'A' }) }),
    );

    readlineLines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ask-sess' }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'ask-1',
        tool_call: {
          askQuestionToolCall: {
            args: { questions: [{ id: 'focus', question: 'Pick a focus', options: [{ id: 'a', label: 'A' }] }] },
          },
        },
      }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'ask-1',
        tool_call: {
          askQuestionToolCall: {
            args: { questions: [{ id: 'focus', question: 'Pick a focus' }] },
            result: { rejected: { reason: 'Questions skipped by user' } },
          },
        },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
    ];
    setupMockChild();

    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(createPreparedTurn('ask the user'))) {
      chunks.push(chunk);
    }

    // The tool result is a neutral marker, not the answer (delivered as follow-up).
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      id: 'ask-1',
      content: CURSOR_ASK_ANSWER_FOLLOWUP_NOTE,
    }));
    const metadata = runtime.consumeTurnMetadata();
    expect(metadata.autoFollowUpText).toContain('Pick a focus: A');
  });

  it('omits the answer follow-up when the turn is canceled', async () => {
    const runtime = new CursorChatRuntime(
      createMockPlugin(),
      createMockRuntimeHost({ askUser: jest.fn().mockResolvedValue({ 'Pick a focus': 'A' }) }),
    );

    readlineLines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ask-sess' }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'ask-1',
        tool_call: {
          askQuestionToolCall: {
            args: { questions: [{ id: 'focus', question: 'Pick a focus', options: [{ id: 'a', label: 'A' }] }] },
          },
        },
      }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'ask-1',
        tool_call: {
          askQuestionToolCall: {
            args: { questions: [{ id: 'focus', question: 'Pick a focus' }] },
            result: { rejected: { reason: 'Questions skipped by user' } },
          },
        },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
    ];
    setupMockChild();

    const gen = runtime.query(createPreparedTurn('ask the user'));
    await gen.next();
    runtime.cancel();
    for await (const chunk of gen) {
      void chunk;
    }

    expect(runtime.consumeTurnMetadata().autoFollowUpText).toBeUndefined();
  });

  it('yields an error and terminates when the child fails to spawn (never emits close)', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
    readlineLines = [];

    // A child that emits 'error' (spawn ENOENT/EINVAL) and never emits 'close'.
    // Without an 'error' handler the query's close-promise would hang forever.
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: jest.Mock;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    (child as unknown as { exitCode: number | null }).exitCode = null;
    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    });

    const chunks = [];
    for await (const chunk of runtime.query(createPreparedTurn())) {
      chunks.push(chunk);
    }

    expect(chunks.some(c => c.type === 'error' && /spawn ENOENT/.test((c as { content: string }).content))).toBe(true);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('yields stderr error when CLI exits non-zero without a result event', async () => {
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
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
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
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
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
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
    const runtime = new CursorChatRuntime(createMockPlugin(), createMockRuntimeHost());
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
