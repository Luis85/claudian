import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

const DEFAULT_SIGKILL_TIMEOUT_MS = 3_000;
const DEFAULT_STDERR_BUFFER_LIMIT = 8_000;

export interface AgentSubprocessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /**
   * cmd.exe verbatim-args flag, set by the caller when it has resolved a Windows
   * `.cmd`/`.bat` batch shim (the resolution itself stays provider-side).
   */
  windowsVerbatimArguments?: boolean;
  /** Stderr ring-buffer byte cap (default 8000). */
  stderrBufferLimit?: number;
  /** SIGTERM→SIGKILL escalation delay in ms (default 3000). */
  sigkillTimeoutMs?: number;
}

export interface AgentSubprocessCloseInfo {
  /** Whether the process `exit`ed or failed to spawn (`error`). */
  reason: 'exit' | 'error';
  code: number | null;
  signal: NodeJS.Signals | null;
  /** A spawn error, or a synthetic error describing a non-clean exit. */
  error?: Error;
}

type CloseListener = (info: AgentSubprocessCloseInfo) => void;

/**
 * Shared subprocess lifecycle for the stdio CLI providers (ADR-0001 Move 2):
 * spawn, a bounded stderr ring buffer, liveness tracking, a single normalized
 * close notification, and a hardened SIGTERM→SIGKILL→give-up shutdown so teardown
 * can never hang (the CON-2 fix, now owned in one place and tested).
 *
 * Provider-native launch details (e.g. Codex's Windows `.cmd`-shim resolution)
 * stay in the adapters, which pass a resolved spec in and map `onClose` onto
 * their own public contract.
 */
export class AgentSubprocess {
  private proc: ChildProcess | null = null;
  private alive = false;
  private stderrBuffer = '';
  private closeError: Error | null = null;
  private notifiedClose = false;
  private readonly closeListeners = new Set<CloseListener>();
  private readonly stderrLimit: number;
  private readonly sigkillTimeoutMs: number;

  constructor(private readonly spec: AgentSubprocessSpec) {
    this.stderrLimit = spec.stderrBufferLimit ?? DEFAULT_STDERR_BUFFER_LIMIT;
    this.sigkillTimeoutMs = spec.sigkillTimeoutMs ?? DEFAULT_SIGKILL_TIMEOUT_MS;
  }

  start(): void {
    if (this.proc) {
      return;
    }

    const proc = spawn(this.spec.command, this.spec.args, {
      stdio: 'pipe',
      cwd: this.spec.cwd,
      env: this.spec.env,
      windowsHide: true,
      ...(this.spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    this.proc = proc;
    this.alive = true;

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-this.stderrLimit);
    });

    proc.on('error', (error) => {
      this.alive = false;
      this.closeError = error;
      this.notifyClose({ reason: 'error', code: null, signal: null, error });
    });

    proc.on('exit', (code, signal) => {
      this.alive = false;
      const error = this.closeError ?? (
        code === 0 && signal === null
          ? undefined
          : new Error(`agent subprocess exited (${formatExit(code, signal)})`)
      );
      this.notifyClose({ reason: 'exit', code, signal, error });
    });
  }

  get stdin(): Writable {
    return this.requireProc().stdin as Writable;
  }

  get stdout(): Readable {
    return this.requireProc().stdout as Readable;
  }

  get stderr(): Readable {
    return this.requireProc().stderr as Readable;
  }

  isAlive(): boolean {
    // `alive` flips on the exit/error event; the `exitCode` check also catches a
    // process that exited without us seeing the event (a numeric code means dead).
    return this.alive && this.proc !== null && typeof this.proc.exitCode !== 'number';
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
    if (!proc || typeof proc.exitCode === 'number' || !this.alive) {
      return;
    }

    await new Promise<void>((resolve) => {
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
          // already exited / not killable — the give-up timer will resolve
        }
      }, this.sigkillTimeoutMs);
      // Hard ceiling: never let teardown hang if 'exit' never fires.
      const giveUpTimer = window.setTimeout(finish, this.sigkillTimeoutMs * 2);

      proc.once('exit', onExit);
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process already gone between the guard and the kill — nothing to await.
        finish();
      }
    });
  }

  private requireProc(): ChildProcess {
    if (!this.proc) {
      throw new Error('Agent subprocess is not started');
    }
    return this.proc;
  }

  private notifyClose(info: AgentSubprocessCloseInfo): void {
    if (this.notifiedClose) {
      return;
    }

    this.notifiedClose = true;
    for (const listener of this.closeListeners) {
      try {
        listener(info);
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
