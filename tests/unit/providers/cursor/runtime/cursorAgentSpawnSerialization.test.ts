import '@/providers';

import { EventEmitter } from 'events';

import { CursorAuxCliRunner } from '@/providers/cursor/runtime/CursorAuxCliRunner';
import { refreshCursorModelCatalog } from '@/providers/cursor/runtime/cursorModelCatalog';

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
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

function createMockPlugin(): any {
  return {
    app: {},
    settings: {
      permissionMode: 'normal',
      providers: {
        cursor: { model: 'auto' },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/bin/cursor-agent'),
  };
}

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
};

function trackConcurrentSpawns() {
  let activeSpawns = 0;
  let maxConcurrentSpawns = 0;

  return {
    getMaxConcurrentSpawns: () => maxConcurrentSpawns,
    queueChild: (onSpawn: () => MockChild) => {
      mockSpawn.mockImplementationOnce(() => {
        activeSpawns += 1;
        maxConcurrentSpawns = Math.max(maxConcurrentSpawns, activeSpawns);

        const child = onSpawn();
        const baseOn = child.on.bind(child);
        child.on = (event: string | symbol, listener: (...args: unknown[]) => void) => {
          const subscription = baseOn(event, listener);
          if (event === 'close') {
            queueMicrotask(() => {
              activeSpawns -= 1;
              child.emit('close', 0);
            });
          }
          return subscription;
        };
        return child;
      });
    },
  };
}

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

describe('cursor agent spawn serialization (EPERM regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serializes concurrent CursorAuxCliRunner spawns', async () => {
    const tracker = trackConcurrentSpawns();
    const successJson = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'ok',
      is_error: false,
    });

    tracker.queueChild(() => {
      const child = createMockChild();
      queueMicrotask(() => child.stdout.emit('data', Buffer.from(successJson)));
      return child;
    });
    tracker.queueChild(() => {
      const child = createMockChild();
      queueMicrotask(() => child.stdout.emit('data', Buffer.from(successJson)));
      return child;
    });

    const runner = new CursorAuxCliRunner(createMockPlugin());
    await Promise.all([
      runner.query({ systemPrompt: 'title' }, 'first'),
      runner.query({ systemPrompt: 'title' }, 'second'),
    ]);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(tracker.getMaxConcurrentSpawns()).toBe(1);
  });

  it('serializes CursorAuxCliRunner and model catalog refresh spawns', async () => {
    const tracker = trackConcurrentSpawns();
    const successJson = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'ok',
      is_error: false,
    });

    tracker.queueChild(() => {
      const child = createMockChild();
      queueMicrotask(() => child.stdout.emit('data', Buffer.from(successJson)));
      return child;
    });
    tracker.queueChild(() => {
      const child = createMockChild();
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('auto\ncomposer-2')));
      return child;
    });

    const runner = new CursorAuxCliRunner(createMockPlugin());
    await Promise.all([
      runner.query({ systemPrompt: 'title' }, 'hello'),
      refreshCursorModelCatalog('/usr/bin/cursor-agent', {}, '/test/vault'),
    ]);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(tracker.getMaxConcurrentSpawns()).toBe(1);
  });
});
