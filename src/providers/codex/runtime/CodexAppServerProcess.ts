import { type ChildProcess,spawn } from 'child_process';
import type { Readable, Writable } from 'stream';

import type { CodexLaunchSpec } from './codexLaunchTypes';

const SIGKILL_TIMEOUT_MS = 3_000;
const WINDOWS_CMD_ARGUMENT_CHARS = /[\s"&<>|{}^=;!'+,`~()%@]/u;

function requiresWindowsShellQuoting(value: string): boolean {
  return WINDOWS_CMD_ARGUMENT_CHARS.test(value)
    || value.includes('[')
    || value.includes(']');
}

function quoteWindowsShellArgument(value: string): string {
  if (!value.length) {
    return '""';
  }

  if (!requiresWindowsShellQuoting(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function resolveWindowsSpawnSpec(launchSpec: Pick<CodexLaunchSpec, 'command' | 'args' | 'spawnCwd' | 'env'>) {
  const command = launchSpec.command.trim();
  const lowerCommand = command.toLowerCase();

  if (!command || process.platform !== 'win32') {
    return {
      command: launchSpec.command,
      args: launchSpec.args,
      env: launchSpec.env,
    };
  }

  if (lowerCommand.endsWith('.cmd')) {
    const shellCommand = [command, ...launchSpec.args]
      .map(value => quoteWindowsShellArgument(value))
      .join(' ');

    return {
      command: process.env.ComSpec || process.env.comspec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${shellCommand}"`],
      env: launchSpec.env,
      windowsVerbatimArguments: true,
    };
  }

  return {
    command: launchSpec.command,
    args: launchSpec.args,
    env: launchSpec.env,
  };
}

type ExitCallback = (code: number | null, signal: string | null) => void;

export class CodexAppServerProcess {
  private proc: ChildProcess | null = null;
  private alive = false;
  private exitCallbacks: ExitCallback[] = [];

  constructor(
    private readonly launchSpec: Pick<CodexLaunchSpec, 'command' | 'args' | 'spawnCwd' | 'env'>,
  ) {}

  start(): void {
    const resolvedSpawnSpec = resolveWindowsSpawnSpec(this.launchSpec);

    this.proc = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.launchSpec.spawnCwd,
      env: resolvedSpawnSpec.env,
      windowsHide: true,
      ...(resolvedSpawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });

    this.alive = true;

    this.proc.on('exit', (code, signal) => {
      this.alive = false;
      for (const cb of this.exitCallbacks) {
        cb(code, signal);
      }
    });

    this.proc.on('error', () => {
      this.alive = false;
    });
  }

  get stdin(): Writable {
    if (!this.proc?.stdin) throw new Error('Process not started');
    return this.proc.stdin;
  }

  get stdout(): Readable {
    if (!this.proc?.stdout) throw new Error('Process not started');
    return this.proc.stdout;
  }

  get stderr(): Readable {
    if (!this.proc?.stderr) throw new Error('Process not started');
    return this.proc.stderr;
  }

  isAlive(): boolean {
    return this.alive;
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.push(callback);
  }

  offExit(callback: ExitCallback): void {
    const idx = this.exitCallbacks.indexOf(callback);
    if (idx !== -1) this.exitCallbacks.splice(idx, 1);
  }

  async shutdown(): Promise<void> {
    const proc = this.proc;
    if (!proc || !this.alive) return;

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(killTimer);
        window.clearTimeout(giveUpTimer);
        proc.off('exit', onExit);
        resolve();
      };
      const onExit = () => finish();
      const killTimer = window.setTimeout(() => {
        try {
          if (this.alive) {
            proc.kill('SIGKILL');
          }
        } catch {
          // already exited — the give-up timer will resolve
        }
      }, SIGKILL_TIMEOUT_MS);
      // Hard ceiling: never let teardown hang if 'exit' never fires.
      const giveUpTimer = window.setTimeout(finish, SIGKILL_TIMEOUT_MS * 2);

      proc.once('exit', onExit);
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process already gone between the guard and the kill.
        finish();
      }
    });
  }
}
