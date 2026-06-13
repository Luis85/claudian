import type { Readable, Writable } from 'node:stream';

import { AgentSubprocess } from '../../../core/transport/AgentSubprocess';
import { wrapWindowsCmdShim } from '../../../utils/windowsSpawn';
import type { CodexLaunchSpec } from './codexLaunchTypes';

interface ResolvedCodexSpawnSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  windowsVerbatimArguments?: boolean;
}

function resolveWindowsSpawnSpec(
  launchSpec: Pick<CodexLaunchSpec, 'command' | 'args' | 'spawnCwd' | 'env'>,
): ResolvedCodexSpawnSpec {
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
    return {
      ...wrapWindowsCmdShim(command, launchSpec.args),
      env: launchSpec.env,
    };
  }

  return {
    command: launchSpec.command,
    args: launchSpec.args,
    env: launchSpec.env,
  };
}

type ExitCallback = (code: number | null, signal: string | null) => void;

/**
 * Codex `app-server` stdio subprocess. A thin adapter over the shared
 * `core/transport/AgentSubprocess` (ADR-0001 Move 2): the Windows `.cmd`-shim
 * resolution stays here (Codex-launch-spec specific), and the shared close event
 * is mapped onto Codex's `onExit(code, signal)` contract.
 */
export class CodexAppServerProcess {
  private proc: AgentSubprocess | null = null;
  private readonly exitCallbacks: ExitCallback[] = [];

  constructor(
    private readonly launchSpec: Pick<CodexLaunchSpec, 'command' | 'args' | 'spawnCwd' | 'env'>,
  ) {}

  start(): void {
    if (this.proc) {
      return;
    }

    const resolved = resolveWindowsSpawnSpec(this.launchSpec);
    this.proc = new AgentSubprocess({
      command: resolved.command,
      args: resolved.args,
      cwd: this.launchSpec.spawnCwd,
      env: resolved.env,
      windowsVerbatimArguments: resolved.windowsVerbatimArguments,
    });

    // Codex notifies only on a real process exit (not on a spawn error).
    this.proc.onClose((info) => {
      if (info.reason !== 'exit') {
        return;
      }
      for (const cb of [...this.exitCallbacks]) {
        cb(info.code, info.signal);
      }
    });

    this.proc.start();
  }

  get stdin(): Writable {
    return this.requireProc().stdin;
  }

  get stdout(): Readable {
    return this.requireProc().stdout;
  }

  get stderr(): Readable {
    return this.requireProc().stderr;
  }

  isAlive(): boolean {
    return this.proc?.isAlive() ?? false;
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.push(callback);
  }

  offExit(callback: ExitCallback): void {
    const idx = this.exitCallbacks.indexOf(callback);
    if (idx !== -1) this.exitCallbacks.splice(idx, 1);
  }

  shutdown(): Promise<void> {
    return this.proc?.shutdown() ?? Promise.resolve();
  }

  private requireProc(): AgentSubprocess {
    if (!this.proc) {
      throw new Error('Process not started');
    }
    return this.proc;
  }
}
