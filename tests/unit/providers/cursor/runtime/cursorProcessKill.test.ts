import type { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { forceKillCursorProcessTree } from '@/providers/cursor/runtime/cursorProcessKill';

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

type SpawnedChild = ReturnType<typeof spawn>;
type MockChild = EventEmitter & { kill: jest.Mock; pid?: number };

function createMockChild(pid?: number): MockChild {
  const child = new EventEmitter() as MockChild;
  child.kill = jest.fn();
  child.pid = pid;
  return child;
}

function asSpawned(child: MockChild): SpawnedChild {
  return child as unknown as SpawnedChild;
}

describe('forceKillCursorProcessTree', () => {
  const realPlatform = process.platform;

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  it('reaps the whole tree with taskkill /T /F on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockSpawn.mockImplementation(() => createMockChild());
    const child = createMockChild(1234);

    forceKillCursorProcessTree(asSpawned(child));

    const call = mockSpawn.mock.calls.find((c) => c[0] === 'taskkill');
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual(['/PID', '1234', '/T', '/F']);
    // The parent SIGKILL is reserved for the taskkill-error fallback only.
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('falls back to a direct SIGKILL when taskkill cannot spawn on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const killer = createMockChild();
    mockSpawn.mockImplementation(() => killer);
    const child = createMockChild(1234);

    forceKillCursorProcessTree(asSpawned(child));
    killer.emit('error', new Error('taskkill missing'));

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('uses SIGKILL on win32 when the child has no pid', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const child = createMockChild(undefined);

    forceKillCursorProcessTree(asSpawned(child));

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('uses SIGKILL on posix platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const child = createMockChild(1234);

    forceKillCursorProcessTree(asSpawned(child));

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
