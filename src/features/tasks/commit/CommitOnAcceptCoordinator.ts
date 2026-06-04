import type { EventBus } from '../../../core/events/EventBus';
import type { TaskEventMap } from '../events';
import type { TaskSpec } from '../model/taskTypes';
import { buildScopedCommitPrompt } from './scopedCommitPrompt';

export interface CoordinatorLogger {
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface CommitOnAcceptDeps {
  events: EventBus<TaskEventMap>;
  loadTaskSpec(path: string): Promise<TaskSpec>;
  getGitStatus(): Promise<{ isRepo: boolean; dirtyCount: number }>;
  isProviderGitEnabled(providerId: string): boolean;
  openModal(opts: { taskTitle: string; dirtyCount: number }): Promise<{ confirmed: boolean; dontAskAgain: boolean }>;
  surface: { requestCommitTurn?(task: TaskSpec, prompt: string): Promise<void> };
  readSettings(): { promptCommitOnAccept?: boolean };
  saveSettings(): Promise<void>;
  logger: CoordinatorLogger;
  showNotice(message: string): void;
}

export class CommitOnAcceptCoordinator {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: CommitOnAcceptDeps) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.events.on('task:status-changed', (payload) => {
      void this.handle(payload);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async handle(payload: TaskEventMap['task:status-changed']): Promise<void> {
    if (payload.status !== 'done') return;

    const settings = this.deps.readSettings();
    if (settings.promptCommitOnAccept === false) {
      this.deps.logger.debug('commitOnAccept skip: toggleOff');
      return;
    }

    let task: TaskSpec;
    try {
      task = await this.deps.loadTaskSpec(payload.path);
    } catch (error) {
      this.deps.logger.warn('commitOnAccept skip: parse failed', error);
      return;
    }

    const provider = task.frontmatter.provider;
    if (provider && !this.deps.isProviderGitEnabled(provider)) {
      this.deps.logger.debug('commitOnAccept skip: providerOptOut');
      return;
    }

    let status: { isRepo: boolean; dirtyCount: number };
    try {
      status = await this.deps.getGitStatus();
    } catch {
      this.deps.logger.debug('commitOnAccept skip: gitStatus failed');
      return;
    }
    if (!status.isRepo) {
      this.deps.logger.debug('commitOnAccept skip: notRepo');
      return;
    }
    if (status.dirtyCount === 0) {
      this.deps.logger.debug('commitOnAccept skip: clean');
      return;
    }

    // Modal + surface dispatch — implemented in Task 8.
    void task;
    void buildScopedCommitPrompt;
  }
}
