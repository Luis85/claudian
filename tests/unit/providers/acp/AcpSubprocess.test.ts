import { EventEmitter } from 'events';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'node:child_process';

import { AcpSubprocess } from '@/providers/acp/AcpSubprocess';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
    exitCode: number | null;
    killed: boolean;
  };
  proc.stdin = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = Object.assign(new EventEmitter(), {});
  proc.kill = jest.fn().mockReturnValue(true);
  proc.exitCode = null;
  proc.killed = false;
  return proc;
}

function createLaunchSpec() {
  return {
    command: '/usr/local/bin/opencode',
    args: ['acp'],
    cwd: '/test/vault',
    env: {},
  };
}

describe('AcpSubprocess.shutdown', () => {
  let proc: ReturnType<typeof createMockProc>;

  beforeEach(() => {
    jest.clearAllMocks();
    proc = createMockProc();
    mockSpawn.mockReturnValue(proc as never);
  });

  it('issues SIGTERM synchronously within the shutdown() call frame (onunload contract)', async () => {
    const subprocess = new AcpSubprocess(createLaunchSpec());
    subprocess.start();

    const shutdownPromise = subprocess.shutdown();
    // Plugin onunload is synchronous and fire-and-forget: the SIGTERM must be
    // initiated before shutdown() first suspends, or the child can be orphaned.
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    proc.emit('exit', 0, null);
    await shutdownPromise;
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    jest.useFakeTimers();
    try {
      const subprocess = new AcpSubprocess(createLaunchSpec());
      subprocess.start();

      const shutdownPromise = subprocess.shutdown();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      jest.advanceTimersByTime(3_000);
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

      proc.emit('exit', 137, 'SIGKILL');
      await shutdownPromise;
    } finally {
      jest.useRealTimers();
    }
  });

  it('resolves via the give-up ceiling if exit never fires', async () => {
    jest.useFakeTimers();
    try {
      const subprocess = new AcpSubprocess(createLaunchSpec());
      subprocess.start();

      const shutdownPromise = subprocess.shutdown();
      jest.advanceTimersByTime(10_000);
      await expect(shutdownPromise).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('resolves immediately when the process already exited', async () => {
    const subprocess = new AcpSubprocess(createLaunchSpec());
    subprocess.start();
    proc.exitCode = 0;

    await expect(subprocess.shutdown()).resolves.toBeUndefined();
    expect(proc.kill).not.toHaveBeenCalled();
  });
});
