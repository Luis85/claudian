import '@/providers';

import { EventEmitter } from 'events';

import { CursorAuxCliRunner } from '@/providers/cursor/runtime/CursorAuxCliRunner';

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

jest.mock('@/providers/cursor/runtime/cursorLaunch', () => ({
  resolveCursorLaunch: jest.fn((cli: string, args: string[]) => ({ command: cli, args })),
}));

jest.mock('@/providers/cursor/runtime/cursorAgentEnv', () => ({
  buildCursorAgentEnvironment: jest.fn().mockReturnValue({}),
}));

function createMockPlugin(): any {
  return {
    app: {},
    settings: {
      permissionMode: 'normal',
      providers: { cursor: { model: 'auto' } },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/bin/cursor-agent'),
  };
}

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

function queueReply(json: string): void {
  mockSpawn.mockImplementationOnce(() => {
    const child = createMockChild();
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(json));
      queueMicrotask(() => child.emit('close', 0, null));
    });
    return child;
  });
}

describe('CursorAuxCliRunner shared-runner contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the final text once through onTextChunk', async () => {
    queueReply(JSON.stringify({
      type: 'result',
      result: 'refined text',
      session_id: 's1',
      is_error: false,
    }));

    const onTextChunk = jest.fn();
    const runner = new CursorAuxCliRunner(createMockPlugin());
    const text = await runner.query({ systemPrompt: 'sys', onTextChunk }, 'prompt');

    expect(text).toBe('refined text');
    expect(onTextChunk).toHaveBeenCalledTimes(1);
    expect(onTextChunk).toHaveBeenCalledWith('refined text');
  });

  it('resumes the captured session id on the next call and reset() clears it', async () => {
    queueReply(JSON.stringify({ type: 'result', result: 'a', session_id: 'sess-1', is_error: false }));
    const runner = new CursorAuxCliRunner(createMockPlugin());
    await runner.query({ systemPrompt: 'sys' }, 'first');

    queueReply(JSON.stringify({ type: 'result', result: 'b', session_id: 'sess-1', is_error: false }));
    await runner.query({ systemPrompt: 'sys' }, 'second');

    const resumeArgs = mockSpawn.mock.calls[1][1] as string[];
    expect(resumeArgs.join(' ')).toContain('sess-1');

    runner.reset();
    queueReply(JSON.stringify({ type: 'result', result: 'c', session_id: 'sess-2', is_error: false }));
    await runner.query({ systemPrompt: 'sys' }, 'third');

    const freshArgs = mockSpawn.mock.calls[2][1] as string[];
    expect(freshArgs.join(' ')).not.toContain('sess-1');
  });

  it('throws when the CLI reports an error', async () => {
    queueReply(JSON.stringify({ type: 'result', result: 'boom', is_error: true }));
    const runner = new CursorAuxCliRunner(createMockPlugin());

    await expect(runner.query({ systemPrompt: 'sys' }, 'prompt')).rejects.toThrow('boom');
  });

  it('pins a read-only posture (ask mode, no force) regardless of chat mode', async () => {
    queueReply(JSON.stringify({ type: 'result', result: 'ok', is_error: false }));
    const plugin = createMockPlugin();
    plugin.settings.permissionMode = 'yolo';
    const runner = new CursorAuxCliRunner(plugin);

    await runner.query({ systemPrompt: 'sys' }, 'prompt');

    const args = (mockSpawn.mock.calls[0][1] as string[]).join(' ');
    expect(args).toContain('--mode ask');
    expect(args).not.toContain('--force');
  });

  it('escalates an aborted aux query to a taskkill tree-kill on win32', async () => {
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      // A child that never emits close: the abort path must reap it instead of
      // hanging or leaving an orphaned cursor-agent behind.
      const child = createMockChild();
      (child as any).exitCode = null;
      (child as any).signalCode = null;
      (child as any).pid = 9911;
      mockSpawn.mockImplementationOnce(() => child);

      const controller = new AbortController();
      const runner = new CursorAuxCliRunner(createMockPlugin());
      // Fire-and-forget; we assert on the kill escalation, not the rejection.
      const pending = runner
        .query({ systemPrompt: 'sys', abortController: controller }, 'prompt')
        .catch(() => undefined);

      // Let the spawn lock + spawnOnce attach its listeners before aborting.
      await Promise.resolve();
      await Promise.resolve();

      jest.useFakeTimers();
      controller.abort();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      jest.advanceTimersByTime(3_000);
      const treeKill = mockSpawn.mock.calls.find((call) => call[0] === 'taskkill');
      expect(treeKill).toBeDefined();
      expect(treeKill?.[1]).toEqual(
        expect.arrayContaining(['/PID', '9911', '/T', '/F']),
      );

      jest.useRealTimers();
      // Release the never-closing child so the pending promise settles.
      child.emit('close', null, 'SIGKILL');
      await pending;
    } finally {
      jest.useRealTimers();
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    }
  });
});
