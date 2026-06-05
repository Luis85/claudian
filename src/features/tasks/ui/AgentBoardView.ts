import type { TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { VIEW_TYPE_CLAUDIAN_AGENT_BOARD } from '../../../core/types/chat';
import { asSettingsBag } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { confirm } from '../../../shared/modals/ConfirmModal';
import { promptReason } from '../../../shared/modals/PromptModal';
import { archiveWorkOrder } from '../commands/taskCommands';
import { getLaneForStatus, loadBoardConfig } from '../config/BoardConfigStore';
import type { BoardConfig, ResolvedBoardLayout } from '../config/boardConfigTypes';
import { resolveBoardLayout } from '../config/resolveBoardLayout';
import { selectNextReadyTask } from '../execution/selectNextReadyTask';
import type { TaskExecutionSurface } from '../execution/TaskExecutionSurface';
import { TaskRunCoordinator } from '../execution/TaskRunCoordinator';
import { TaskIndexer } from '../indexing/TaskIndexer';
import { canTransitionTaskStatus, isRunnableTaskStatus } from '../model/taskStateMachine';
import type { TaskBoardModel, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { type AgentBoardPauseState,AgentBoardRenderer } from './AgentBoardRenderer';
import { createWorkOrderInteractive } from './createWorkOrderInteractive';
import { showWorkOrderContextMenu } from './WorkOrderContextMenu';
import { buildWorkOrderConversationBindings } from './workOrderConversationBindings';
import { WorkOrderDetailModal, type WorkOrderFieldUpdate } from './WorkOrderDetailModal';

export class AgentBoardView extends ItemView {
  private readonly noteStore = new TaskNoteStore();
  private readonly indexer = new TaskIndexer(this.noteStore);
  private readonly renderer = new AgentBoardRenderer();
  private model: TaskBoardModel = { tasks: [], invalidNotes: [] };
  private config: BoardConfig = loadBoardConfig({}).config;
  private layout: ResolvedBoardLayout = { lanes: [], errors: [] };
  private refreshTimer: number | null = null;
  // One coordinator for the view, kept across runs so paused runs are reachable
  // from the card reply/approve/reject handlers via getActiveRun(taskId).
  private coordinator: TaskRunCoordinator | null = null;
  private elapsedTimer: number | null = null;
  private readonly pauseState = new Map<string, AgentBoardPauseState>();
  private readonly lastRunStatus = new Map<string, TaskStatus>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ClaudianPlugin,
    private readonly executionSurface: TaskExecutionSurface,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN_AGENT_BOARD;
  }

  getDisplayText(): string {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    return 'Agent Board';
  }

  getIcon(): string {
    return 'kanban-square';
  }

  async onOpen(): Promise<void> {
    const { vault } = this.plugin.app;
    this.registerEvent(vault.on('create', (file) => this.onVaultChange(file)));
    this.registerEvent(vault.on('modify', (file) => this.onVaultChange(file)));
    this.registerEvent(vault.on('delete', (file) => this.onVaultChange(file)));
    this.registerEvent(vault.on('rename', (file) => this.onVaultChange(file)));
    this.register(this.plugin.events.on('chat:tabs-changed', () => this.refreshSlots()));
    this.register(this.plugin.events.on('task:board-config-changed', () => void this.refresh()));

    // Live-run visibility: patch cards in place from run events without a full
    // re-render, and tick the elapsed timer every second.
    this.register(this.plugin.events.on('task:attempt-started', (p) => this.patchCard(p.taskId)));
    this.register(this.plugin.events.on('task:status-changed', (p) => this.onStatusChanged(p)));
    this.register(this.plugin.events.on('task:ledger-appended', (p) => this.patchLiveStrip(p.taskId, p.entry.message)));
    this.register(this.plugin.events.on('task:heartbeat', (p) => this.patchLiveStrip(p.taskId)));
    this.register(this.plugin.events.on('task:needs-input', (p) => this.onPauseRequested('needs_input', p)));
    this.register(this.plugin.events.on('task:needs-approval', (p) => this.onPauseRequested('needs_approval', p)));
    this.register(this.plugin.events.on('task:resumed', (p) => {
      this.pauseState.delete(p.taskId);
      this.patchCard(p.taskId);
    }));

    this.elapsedTimer = window.setInterval(() => this.tickElapsed(), 1000);
    this.register(() => {
      if (this.elapsedTimer !== null) window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    });

    await this.refresh();
    await this.recoverOrphanedRuns();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async refresh(): Promise<void> {
    const settings = asSettingsBag(this.plugin.settings);
    this.model = await this.indexer.indexVaultFolder(this.plugin.app.vault, this.folder);
    const { config, errors } = loadBoardConfig(settings);
    this.config = config;
    const layout = resolveBoardLayout(config, this.model);
    this.layout = { ...layout, errors: [...errors, ...layout.errors] };
    this.render();
  }

  private get folder(): string {
    return (this.plugin.settings.agentBoardWorkOrderFolder || 'Agent Board/tasks').replace(/^\/+|\/+$/g, '');
  }

  private onVaultChange(file: TAbstractFile): void {
    if (!file.path.startsWith(`${this.folder}/`)) return;
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 100);
  }

  // Light re-render that recomputes chat-tab slot capacity without re-indexing
  // the vault. Called when chat tabs open/close.
  refreshSlots(): void {
    this.render();
  }

  private render(): void {
    // Preserve lane scroll position across full re-renders so interacting with a
    // card (which triggers refresh) doesn't jump the board back to the left.
    const lanesSelector = '.claudian-agent-board-lanes';
    const previousLanes = this.contentEl.querySelector(lanesSelector) as HTMLElement | null;
    const scrollLeft = previousLanes?.scrollLeft ?? 0;
    const scrollTop = previousLanes?.scrollTop ?? 0;

    this.renderer.render(
      this.contentEl,
      { layout: this.layout, invalidNotes: this.model.invalidNotes, slots: this.computeSlots() },
      {
        onOpenDetail: (task) => this.openDetail(task),
        onRun: (task) => void this.runTask(task),
        onStop: (task) => this.stopTask(task),
        onAccept: (task) => void this.transitionTask(task, 'done', 'Accepted from review.'),
        onRework: (task) => void this.reworkTask(task),
        onMarkReady: (task) => void this.transitionTask(task, 'ready', 'Marked ready.'),
        onReopen: (task) => void this.transitionTask(task, 'inbox', 'Reopened.'),
        onAddWorkOrder: () => void this.addWorkOrderFromBoard(),
        onRunNextReady: () => void this.runNextReady(),
        onContextMenu: (task, event) => showWorkOrderContextMenu(task, event, {
          plugin: this.plugin,
          onOpenNote: (target) => void this.openTask(target),
          ...buildWorkOrderConversationBindings(this.plugin),
        }),
        onReply: (task, content) => void this.onReply(task.frontmatter.id, content),
        onApprove: (task) => void this.onApprove(task.frontmatter.id),
        onReject: (task, reason) => void this.onReject(task.frontmatter.id, reason),
        onCancelPaused: (task) => this.stopTask(task),
        onSendToReview: (task) => void this.transitionTask(task, 'review', 'Sent to review without a structured handoff.'),
        onMarkFailed: (task) => void this.transitionTask(task, 'failed', 'Marked failed: run produced no structured handoff.'),
      },
    );

    // A full render rebuilds card refs, so re-apply any active pause payloads
    // (question/default/risk from the run events) over the note-seeded reply.
    for (const taskId of this.pauseState.keys()) {
      this.patchCard(taskId);
    }

    const nextLanes = this.contentEl.querySelector(lanesSelector) as HTMLElement | null;
    if (nextLanes) {
      nextLanes.scrollLeft = scrollLeft;
      nextLanes.scrollTop = scrollTop;
    }
  }

  private openDetail(task: TaskSpec): void {
    const settings = asSettingsBag(this.plugin.settings);
    new WorkOrderDetailModal(this.plugin.app, task, {
      onOpenNote: (target) => void this.openTask(target),
      ...buildWorkOrderConversationBindings(this.plugin),
      onRun: (target) => void this.runTask(target),
      onStop: (target) => this.stopTask(target),
      onAccept: (target) => void this.transitionTask(target, 'done', 'Accepted from review.'),
      onRework: (target) => void this.reworkTask(target),
      onMarkReady: (target) => void this.transitionTask(target, 'ready', 'Marked ready.'),
      onReopen: (target) => void this.transitionTask(target, 'inbox', 'Reopened.'),
      onSendToReview: (target) => void this.transitionTask(target, 'review', 'Sent to review without a structured handoff.'),
      onMarkFailed: (target) => void this.transitionTask(target, 'failed', 'Marked failed: run produced no structured handoff.'),
      onArchive: (target) => void this.archiveTask(target),
      onSaveFields: (target, fields) => this.saveTaskFields(target, fields),
      getProviderOptions: () =>
        ProviderRegistry.getEnabledProviderIds(settings).map((id) => ({ value: id, label: id })),
      getModelOptions: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId)
          ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
          : [],
    }).open();
  }

  private async openTask(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) {
      await this.plugin.app.workspace.getLeaf('tab').openFile(file);
    }
  }

  private stopTask(task: TaskSpec): void {
    this.executionSurface.cancelTaskRun?.(task.frontmatter.run_id ?? '');
    new Notice(t('tasks.board.stopRequested', { title: task.frontmatter.title }));
  }

  private async saveTaskFields(task: TaskSpec, fields: WorkOrderFieldUpdate): Promise<void> {
    await this.applyNoteChange(task.path, (content) => this.noteStore.writeFields(content, fields));
    await this.refresh();
  }

  private computeSlots(): { used: number; max: number } {
    const max = this.plugin.settings.maxTabs;
    const used = this.plugin.getView()?.getTabManager()?.getTabCount() ?? 0;
    return { used, max };
  }

  private async archiveTask(task: TaskSpec): Promise<void> {
    const ok = await confirm(
      this.plugin.app,
      `Archive work order "${task.frontmatter.title}"? The note will be moved to the archive folder.`,
      'Archive',
    );
    if (!ok) return;
    const destination = await archiveWorkOrder(this.plugin, task);
    if (destination) {
      new Notice(t('tasks.board.archived', { title: task.frontmatter.title }));
    }
    await this.refresh();
  }

  private async addWorkOrderFromBoard(): Promise<void> {
    const created = await createWorkOrderInteractive(this.plugin, null, { status: 'inbox', reveal: 'none' });
    if (!created) return;
    await this.refresh();
    try {
      const content = await this.plugin.app.vault.read(created);
      const { task } = this.noteStore.parse(created.path, content);
      this.openDetail(task);
    } catch {
      // Best-effort: ignore a vault read or parse failure; the board already refreshed.
    }
  }

  private async transitionTask(task: TaskSpec, to: TaskStatus, message: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      new Notice(t('tasks.board.fileNotFound'));
      await this.refresh();
      return;
    }

    let latest: TaskSpec;
    try {
      const content = await this.plugin.app.vault.read(file);
      latest = this.noteStore.parse(task.path, content).task;
    } catch (error) {
      new Notice(t('tasks.board.updateFailed', { error: error instanceof Error ? error.message : String(error) }));
      await this.refresh();
      return;
    }

    if (!canTransitionTaskStatus(latest.frontmatter.status, to)) {
      new Notice(t('tasks.board.transitionInvalid', {
        title: latest.frontmatter.title,
        from: latest.frontmatter.status,
        to,
      }));
      await this.refresh();
      return;
    }

    const timestamp = new Date().toISOString();
    await this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, { status: to, timestamp }));
    await this.applyNoteChange(task.path, (content) =>
      this.noteStore.appendLedger(content, { timestamp, status: to, message }),
    );
    this.plugin.events.emit('task:status-changed', { taskId: latest.frontmatter.id, path: task.path, status: to });
    await this.refresh();
  }

  private async runTask(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      new Notice(t('tasks.board.fileNotFound'));
      await this.refresh();
      return;
    }

    let latest: TaskSpec;
    try {
      const content = await this.plugin.app.vault.read(file);
      latest = this.noteStore.parse(task.path, content).task;
    } catch (error) {
      new Notice(t('tasks.board.runParseFailed', { error: error instanceof Error ? error.message : String(error) }));
      await this.refresh();
      return;
    }

    const coordinator = this.getCoordinator();
    this.plugin.events.emit('task:run-started', { taskId: latest.frontmatter.id, path: task.path });
    const result = await coordinator.run(latest);
    this.plugin.events.emit('task:run-finished', {
      taskId: latest.frontmatter.id,
      path: task.path,
      status: result.ok ? result.status : (this.lastRunStatus.get(latest.frontmatter.id) ?? latest.frontmatter.status),
    });
    if (!result.ok) {
      new Notice(t('tasks.board.runFailed', { error: result.error }));
    }
    await this.refresh();
  }

  private getCoordinator(): TaskRunCoordinator {
    if (this.coordinator) return this.coordinator;
    this.coordinator = new TaskRunCoordinator({
      executionSurface: this.executionSurface,
      events: this.plugin.events,
      now: () => new Date().toISOString(),
      isProviderEnabled: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
        ProviderRegistry.isEnabled(providerId as ProviderId, asSettingsBag(this.plugin.settings)),
      ownsModel: (providerId, model) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
        ProviderRegistry.getChatUIConfig(providerId as ProviderId).ownsModel(model, asSettingsBag(this.plugin.settings)),
      writeTaskStatus: async (target, options) => {
        await this.applyNoteChange(target.path, (content) => this.noteStore.writeStatus(content, options));
        this.lastRunStatus.set(target.frontmatter.id, options.status);
      },
      flushLedger: (target, entries) =>
        this.applyNoteChange(target.path, (content) =>
          entries.reduce((acc, entry) => this.noteStore.appendLedger(acc, entry), content),
        ),
      writeHandoff: (target, markdown) =>
        this.applyNoteChange(target.path, (content) => this.noteStore.writeHandoff(content, markdown)),
      renderPrompt: (target) =>
        renderTaskPrompt(target, getLaneForStatus(this.config, target.frontmatter.status) ?? undefined),
    });
    return this.coordinator;
  }

  private patchCard(taskId: string): void {
    const task = this.model.tasks.find((entry) => entry.frontmatter.id === taskId);
    if (!task) return;
    this.renderer.patchCard(taskId, task, this.pauseState.get(taskId) ?? null);
  }

  private patchLiveStrip(taskId: string, lastLedger?: string): void {
    const task = this.model.tasks.find((entry) => entry.frontmatter.id === taskId);
    if (!task) return;
    const now = Date.now();
    const startedAt = task.frontmatter.started ? Date.parse(task.frontmatter.started) : now;
    const heartbeatAt = task.frontmatter.heartbeat ? Date.parse(task.frontmatter.heartbeat) : now;
    const ledger = lastLedger ?? task.sections.ledger.split('\n').filter((line) => line.trim().length > 0).pop();
    this.renderer.patchLiveStrip(taskId, {
      lastLedger: ledger,
      elapsedMs: Math.max(0, now - startedAt),
      attemptNumber: task.frontmatter.attempts,
      heartbeatAgeMs: Math.max(0, now - heartbeatAt),
    });
  }

  private onStatusChanged(p: { taskId: string; status: TaskStatus }): void {
    if (p.status !== 'needs_input' && p.status !== 'needs_approval') {
      this.pauseState.delete(p.taskId);
    }
    this.patchCard(p.taskId);
  }

  private onPauseRequested(
    kind: 'needs_input' | 'needs_approval',
    p: { taskId: string; runId: string; question?: string; action?: string; risk?: string; default?: string; reversible?: boolean },
  ): void {
    this.pauseState.set(p.taskId, {
      question: kind === 'needs_input' ? p.question : undefined,
      action: kind === 'needs_approval' ? p.action : undefined,
      risk: p.risk,
      defaultValue: p.default,
      reversible: p.reversible,
      runId: p.runId,
    });
    this.patchCard(p.taskId);
  }

  private tickElapsed(): void {
    for (const task of this.model.tasks) {
      const status = task.frontmatter.status;
      if (status === 'running' || status === 'needs_input' || status === 'needs_approval') {
        this.patchLiveStrip(task.frontmatter.id);
      }
    }
  }

  // Reply/approve/reject route into the live RunSession. If no session is active
  // (the run just ended or was orphaned), the next refresh removes the reply
  // surface, so a stray click is a safe no-op.
  private async onReply(taskId: string, content: string): Promise<void> {
    await this.coordinator?.getActiveRun(taskId)?.resume({ kind: 'reply', content });
  }

  private async onApprove(taskId: string): Promise<void> {
    await this.coordinator?.getActiveRun(taskId)?.resume({ kind: 'approve' });
  }

  private async onReject(taskId: string, reason: string): Promise<void> {
    await this.coordinator?.getActiveRun(taskId)?.resume({ kind: 'reject', reason });
  }

  /**
   * Marks any work order persisted as running/needs_input/needs_approval but with
   * no live session (e.g. a plugin reload mid-run) as failed, so the board never
   * shows a permanently "active" card that nothing is driving.
   */
  private async recoverOrphanedRuns(): Promise<void> {
    const now = new Date().toISOString();
    let recovered = false;
    for (const task of this.model.tasks) {
      const status = task.frontmatter.status;
      if (status !== 'running' && status !== 'needs_input' && status !== 'needs_approval') continue;
      if (this.coordinator?.getActiveRun(task.frontmatter.id)) continue;
      await this.applyNoteChange(task.path, (content) =>
        this.noteStore.appendLedger(content, { timestamp: now, status: 'failed', message: 'orphaned by plugin reload' }),
      );
      await this.applyNoteChange(task.path, (content) =>
        this.noteStore.writeStatus(content, { status: 'failed', timestamp: now }),
      );
      this.pauseState.delete(task.frontmatter.id);
      this.plugin.events.emit('task:status-changed', { taskId: task.frontmatter.id, path: task.path, status: 'failed' });
      recovered = true;
    }
    if (recovered) await this.refresh();
  }

  async runNextReady(): Promise<void> {
    await this.refresh();
    const next = selectNextReadyTask(this.model.tasks, isRunnableTaskStatus);
    if (!next) {
      new Notice(t('tasks.board.noReady'));
      return;
    }
    await this.runTask(next);
  }

  private async reworkTask(task: TaskSpec): Promise<void> {
    const reason = await promptReason(
      this.plugin.app,
      'Rework reason',
      'Describe what the agent should fix…',
    );
    await this.transitionTask(task, 'needs_fix', reason ?? 'Sent back for rework.');
  }

  private async applyNoteChange(path: string, transform: (content: string) => string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    // vault.process is an atomic read-transform-write: Obsidian serializes
    // concurrent processors so multi-agent runs cannot clobber each other's
    // edits to the same work-order note. The previous read+modify pair was
    // a TOCTOU race under the Agent Board's parallel run coordinator.
    await this.plugin.app.vault.process(file, transform);
  }
}
