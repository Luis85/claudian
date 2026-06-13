import { EventEmitter, Readable, Writable } from 'stream';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'node:child_process';

import { AgentSubprocess, type AgentSubprocessCloseInfo } from '@/core/transport/AgentSubprocess';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

interface MockProc extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable & EventEmitter;
  kill: jest.Mock;
  exitCode: number | null;
  killed: boolean;
}

function makeMockProc(): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} }) as Readable & EventEmitter;
  proc.kill = jest.fn();
  proc.exitCode = null;
  proc.killed = false;
  return proc;
}

const SPEC = { command: 'agent', args: ['--serve'], cwd: '/ws', env: { PATH: '/bin' } };

describe('AgentSubprocess', () => {
  let mockProc: MockProc;

  beforeEach(() => {
    mockProc = makeMockProc();
    mockSpawn.mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('start', () => {
    it('spawns with piped stdio and windowsHide', () => {
      new AgentSubprocess(SPEC).start();
      expect(mockSpawn).toHaveBeenCalledWith('agent', ['--serve'], expect.objectContaining({
        stdio: 'pipe',
        cwd: '/ws',
        env: { PATH: '/bin' },
        windowsHide: true,
      }));
    });

    it('passes windowsVerbatimArguments only when set', () => {
      new AgentSubprocess({ ...SPEC, windowsVerbatimArguments: true }).start();
      expect(mockSpawn.mock.calls[0][2]).toMatchObject({ windowsVerbatimArguments: true });
    });

    it('is idempotent', () => {
      const p = new AgentSubprocess(SPEC);
      p.start();
      p.start();
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
  });

  describe('streams', () => {
    it('exposes the spawned stdio and throws before start', () => {
      const p = new AgentSubprocess(SPEC);
      expect(() => p.stdin).toThrow();
      p.start();
      expect(p.stdin).toBe(mockProc.stdin);
      expect(p.stdout).toBe(mockProc.stdout);
      expect(p.stderr).toBe(mockProc.stderr);
    });
  });

  describe('isAlive', () => {
    it('is true after start, false after exit, false after error', () => {
      const p = new AgentSubprocess(SPEC);
      p.start();
      expect(p.isAlive()).toBe(true);
      mockProc.emit('exit', 0, null);
      expect(p.isAlive()).toBe(false);

      const p2 = new AgentSubprocess(SPEC);
      p2.start();
      mockProc.emit('error', new Error('boom'));
      expect(p2.isAlive()).toBe(false);
    });
  });

  describe('stderr buffering', () => {
    it('snapshots trimmed stderr and bounds the buffer', () => {
      const p = new AgentSubprocess({ ...SPEC, stderrBufferLimit: 10 });
      p.start();
      mockProc.stderr.emit('data', '  hello  ');
      expect(p.getStderrSnapshot()).toBe('hello');
      mockProc.stderr.emit('data', 'ABCDEFGHIJKLMNOP');
      // keeps only the last 10 bytes
      expect(p.getStderrSnapshot()).toBe('GHIJKLMNOP');
    });
  });

  describe('onClose', () => {
    it('fires once with reason "exit" and the exit code/signal', () => {
      const p = new AgentSubprocess(SPEC);
      const seen: AgentSubprocessCloseInfo[] = [];
      p.onClose((info) => seen.push(info));
      p.start();
      mockProc.emit('exit', 1, 'SIGTERM');
      mockProc.emit('exit', 1, 'SIGTERM');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ reason: 'exit', code: 1, signal: 'SIGTERM' });
      expect(seen[0].error).toBeInstanceOf(Error);
    });

    it('reports a clean exit with no error', () => {
      const p = new AgentSubprocess(SPEC);
      let info: AgentSubprocessCloseInfo | undefined;
      p.onClose((i) => { info = i; });
      p.start();
      mockProc.emit('exit', 0, null);
      expect(info).toMatchObject({ reason: 'exit', code: 0, error: undefined });
    });

    it('fires reason "error" on spawn error and suppresses a later exit', () => {
      const p = new AgentSubprocess(SPEC);
      const seen: AgentSubprocessCloseInfo[] = [];
      p.onClose((info) => seen.push(info));
      p.start();
      const err = new Error('ENOENT');
      mockProc.emit('error', err);
      mockProc.emit('exit', null, 'SIGKILL');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ reason: 'error', error: err });
    });

    it('unsubscribes', () => {
      const p = new AgentSubprocess(SPEC);
      const listener = jest.fn();
      const off = p.onClose(listener);
      off();
      p.start();
      mockProc.emit('exit', 0, null);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('issues SIGTERM synchronously within the call frame', async () => {
      const p = new AgentSubprocess(SPEC);
      p.start();
      const done = p.shutdown();
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
      // Resolve the shutdown so its escalation timers are cleared (no leak).
      mockProc.emit('exit', 0, 'SIGTERM');
      await done;
    });

    it('escalates to SIGKILL after the timeout, then resolves on exit', async () => {
      jest.useFakeTimers();
      const p = new AgentSubprocess({ ...SPEC, sigkillTimeoutMs: 1000 });
      p.start();
      const done = p.shutdown();
      expect(mockProc.kill).toHaveBeenLastCalledWith('SIGTERM');
      jest.advanceTimersByTime(1000);
      expect(mockProc.kill).toHaveBeenLastCalledWith('SIGKILL');
      mockProc.emit('exit', null, 'SIGKILL');
      await expect(done).resolves.toBeUndefined();
    });

    it('resolves via the give-up ceiling if exit never fires', async () => {
      jest.useFakeTimers();
      const p = new AgentSubprocess({ ...SPEC, sigkillTimeoutMs: 1000 });
      p.start();
      const done = p.shutdown();
      jest.advanceTimersByTime(2000);
      await expect(done).resolves.toBeUndefined();
    });

    it('is a no-op when never started', async () => {
      await expect(new AgentSubprocess(SPEC).shutdown()).resolves.toBeUndefined();
      expect(mockProc.kill).not.toHaveBeenCalled();
    });
  });
});
