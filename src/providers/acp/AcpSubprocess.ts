import type { Readable, Writable } from 'node:stream';

import { AgentSubprocess } from '../../core/transport/AgentSubprocess';

export interface AcpSubprocessLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

type CloseListener = (error?: Error) => void;

/**
 * Opencode's stdio subprocess. A thin adapter over the shared
 * `core/transport/AgentSubprocess` (ADR-0001 Move 2) that keeps Opencode's
 * close-listener contract (`onClose(error?)`).
 */
export class AcpSubprocess {
  private readonly proc: AgentSubprocess;

  constructor(launchSpec: AcpSubprocessLaunchSpec) {
    this.proc = new AgentSubprocess(launchSpec);
  }

  get stdin(): Writable {
    return this.proc.stdin;
  }

  get stdout(): Readable {
    return this.proc.stdout;
  }

  get stderr(): Readable {
    return this.proc.stderr;
  }

  start(): void {
    this.proc.start();
  }

  isAlive(): boolean {
    return this.proc.isAlive();
  }

  getStderrSnapshot(): string {
    return this.proc.getStderrSnapshot();
  }

  onClose(listener: CloseListener): () => void {
    return this.proc.onClose((info) => listener(info.error));
  }

  shutdown(): Promise<void> {
    return this.proc.shutdown();
  }
}
