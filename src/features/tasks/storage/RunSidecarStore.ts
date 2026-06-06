import type { DataAdapter } from 'obsidian';

import type { TaskLedgerEntry, TaskStatus } from '../model/taskTypes';

export interface RunSidecarHeartbeat {
  at: string;
  status: TaskStatus;
  pauseReason?: string | null;
}

export class RunSidecarStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly baseDir: string,
  ) {}

  private runDir(runId: string): string { return `${this.baseDir}/${runId}`; }
  private heartbeatPath(runId: string): string { return `${this.runDir(runId)}/heartbeat.json`; }
  private ledgerPath(runId: string): string { return `${this.runDir(runId)}/ledger.jsonl`; }

  async writeHeartbeat(runId: string, heartbeat: RunSidecarHeartbeat): Promise<void> {
    await this.ensureRunDir(runId);
    await this.adapter.write(this.heartbeatPath(runId), JSON.stringify(heartbeat, null, 2));
  }

  async readHeartbeat(runId: string): Promise<RunSidecarHeartbeat | null> {
    if (!(await this.adapter.exists(this.heartbeatPath(runId)))) return null;
    const raw = await this.adapter.read(this.heartbeatPath(runId));
    return JSON.parse(raw) as RunSidecarHeartbeat;
  }

  async appendLedger(runId: string, entry: TaskLedgerEntry): Promise<void> {
    await this.ensureRunDir(runId);
    const line = `${JSON.stringify(entry)}\n`;
    await this.adapter.append(this.ledgerPath(runId), line);
  }

  async readLedger(runId: string): Promise<TaskLedgerEntry[]> {
    if (!(await this.adapter.exists(this.ledgerPath(runId)))) return [];
    const raw = await this.adapter.read(this.ledgerPath(runId));
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as TaskLedgerEntry);
  }

  async snapshotLedgerAsMarkdown(_runId: string): Promise<string> {
    throw new Error('not implemented');
  }

  private async ensureRunDir(runId: string): Promise<void> {
    if (!(await this.adapter.exists(this.runDir(runId)))) {
      await this.adapter.mkdir(this.runDir(runId));
    }
  }
}
