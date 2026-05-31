import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

const SIGKILL_TIMEOUT_MS = 3_000;
const STDERR_BUFFER_LIMIT = 8_000;

export interface AcpSubprocessLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

type CloseListener = (error?: Error) => void;

export class AcpSubprocess {
  private closeError: Error | null = null;
  private readonly closeListeners = new Set<CloseListener>();
  private notifiedClose = false;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stderrBuffer = '';

  constructor(private readonly launchSpec: AcpSubprocessLaunchSpec) {}

  get stdin(): Writable {
    return this.requireProc().stdin;
  }

  get stdout(): Readable {
    return this.requireProc().stdout;
  }

  get stderr(): Readable {
    return this.requireProc().stderr;
  }

  private requireProc(): ChildProcessWithoutNullStreams {
    if (!this.proc) {
      throw new Error('ACP subprocess is not started');
    }
    return this.proc;
  }

  start(): void {
    if (this.proc) {
      return;
    }

    const proc = spawn(this.launchSpec.command, this.launchSpec.args, {
      cwd: this.launchSpec.cwd,
      env: this.launchSpec.env,
      stdio: 'pipe',
      windowsHide: true,
    });

    proc.stderr.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-STDERR_BUFFER_LIMIT);
    });

    proc.on('error', (error) => {
      this.closeError = error;
      this.notifyClose(error);
    });

    proc.on('exit', (code, signal) => {
      const exitError = this.closeError ?? (
        code === 0 && signal === null
          ? undefined
          : new Error(`ACP subprocess exited (${formatExit(code, signal)})`)
      );
      this.notifyClose(exitError);
    });

    this.proc = proc;
  }

  isAlive(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  getStderrSnapshot(): string {
    return this.stderrBuffer.trim();
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async shutdown(): Promise<void> {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(killTimer);
        window.clearTimeout(giveUpTimer);
        proc.off('exit', onClose);
        resolve();
      };
      const onClose = () => finish();
      const killTimer = window.setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // already exited / not killable — the give-up timer will resolve
        }
      }, SIGKILL_TIMEOUT_MS);
      // Hard ceiling: never let teardown hang if 'exit' never fires.
      const giveUpTimer = window.setTimeout(finish, SIGKILL_TIMEOUT_MS * 2);

      proc.once('exit', onClose);
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process already gone between the guard and the kill — nothing to await.
        finish();
      }
    });
  }

  private notifyClose(error?: Error): void {
    if (this.notifiedClose) {
      return;
    }

    this.notifiedClose = true;
    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch {
        // Best-effort cleanup notification.
      }
    }
  }
}

function formatExit(code: number | null, signal: string | null): string {
  if (signal) {
    return `signal ${signal}`;
  }
  if (code === null) {
    return 'unknown';
  }
  return `code ${code}`;
}
