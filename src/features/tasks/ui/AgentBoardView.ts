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
import { getLaneForStatus, loadBoardConfig, writeBoardQueuePaused } from '../config/BoardConfigStore';
import type { BoardConfig, ResolvedBoardLayout } from '../config/boardConfigTypes';
import { resolveBoardLayout } from '../config/resolveBoardLayout';
import { sharedRunRegistry } from '../execution/activeRunRegistry';
import { QueueRunner } from '../execution/QueueRunner';
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
  private runner: QueueRunner | null = null;
  // One coordinator for the view, shared by manual runs and the queue runner.
  // Built in the constructor so paused runs stay reachable from the card
  // reply/approve/reject handlers via the shared run registry.
  private readonly coordinator: TaskRunCoordinator;
  private elapsedTimer: number | null = null;
  private readonly pauseState = new Map<string, AgentBoardPauseState>();
  // Last status written per task, so a failed/canceled run can report the
  // terminal status on `task:run-finished` without re-reading the note.
  private readonly lastRunStatus = new Map<string, TaskStatus>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ClaudianPlugin,
    private readonly executionSurface: TaskExecutionSurface,
  ) {
    super(leaf);
    // One coordinator shared by manual runs and the queue runner so a single
    // in-flight set (`isActive`) prevents a card from running twice. Its deps
    // key off the task passed to `run()`, never a closure, so any task is safe.
    this.coordinator = new TaskRunCoordinator({
      executionSurface: this.executionSurface,
      events: this.plugin.events,
      now: () => new Date().toISOString(),
      isProviderEnabled: (providerId) => this.isProviderEnabled(providerId),
      ownsModel: (providerId, model) => this.ownsModel(providerId, model),
      // Live sessions are held in a process-shared registry so a paused run is
      // reachable for reply/approve/reject/stop even from a reopened board.
      runRegistry: sharedRunRegistry,
      // Shared across every open board so a manual run here is visible to other
      // panes' queue runners and the same card never launches twice.
      activeRuns: this.plugin.taskActiveRuns,
      // Shared chat-tab reservations so a launch in one pane is counted by every
      // pane's free-tab gate before the async tab creation lands.
      reservations: this.plugin.chatTabReservations,
      // RunSession owns the task:status-changed emit (on pause/resume/terminal),
      // so this just persists the write and records the last status.
      writeTaskStatus: async (task, options) => {
        await this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, options));
        this.lastRunStatus.set(task.frontmatter.id, options.status);
      },
      // RunSession batches ledger lines and flushes them together.
      flushLedger: (task, entries) =>
        this.applyNoteChange(task.path, (content) =>
          entries.reduce((acc, entry) => this.noteStore.appendLedger(acc, entry), content),
        ),
      writeHandoff: (task, markdown) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.writeHandoff(content, markdown)),
      renderPrompt: (task) =>
        renderTaskPrompt(task, getLaneForStatus(this.config, task.frontmatter.status) ?? undefined),
    });
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
    // A freed chat tab can unblock the queue (it gates launches on tab
    // availability), so re-render the slot count and nudge the runner.
    this.register(this.plugin.events.on('chat:tabs-changed', () => {
      this.refreshSlots();
      this.runner?.tick();
    }));
    this.register(this.plugin.events.on('task:board-config-changed', () => void this.refresh()));

    // Live-run visibility: patch cards in place from run events without a full
    // re-render, and tick the elapsed timer every second.
    this.register(this.plugin.events.on('task:attempt-started', (p) => this.patchCard(p.taskId)));
    this.register(this.plugin.events.on('task:ledger-appended', (p) => this.patchLiveStrip(p.taskId, p.entry.message)));
    this.register(this.plugin.events.on('task:heartbeat', (p) => this.patchLiveStrip(p.taskId)));
    this.register(this.plugin.events.on('task:needs-input', (p) => this.onPauseRequested('needs_input', p)));
    this.register(this.plugin.events.on('task:needs-approval', (p) => this.onPauseRequested('needs_approval', p)));
    this.register(this.plugin.events.on('task:resumed', (p) => {
      this.pauseState.delete(p.taskId);
      this.patchCard(p.taskId);
    }));

    // Any status change (manual or queue, this pane or another) can free a slot
    // or change eligibility. Patch the in-memory model first so the runner does
    // not re-pick a card whose terminal status hasn't been re-indexed yet and the
    // card UI repaints against the new status, then nudge the runner.
    this.register(this.plugin.events.on('task:status-changed', (payload) => {
      this.patchModelStatus(payload.taskId, payload.status);
      this.onStatusChanged(payload);
      this.runner?.tick();
    }));
    this.register(this.plugin.events.on('task:run-finished', () => this.runner?.tick()));
    this.register(this.plugin.events.on('task:queue-cap-changed', () => this.onQueueCapChanged()));
    // Pause/halt live in the shared control state, so by the time these fire the
    // runner state is already global; the boards only need to repaint chrome.
    this.register(this.plugin.events.on('task:queue-paused', () => this.render()));
    this.register(this.plugin.events.on('task:queue-resumed', () => this.render()));
    this.register(this.plugin.events.on('task:queue-halted', () => this.render()));
    this.register(this.plugin.events.on('task:queue-tick', () => this.render()));
    this.register(this.plugin.events.on('task:queue-skipped', () => this.render()));

    this.elapsedTimer = window.setInterval(() => this.tickElapsed(), 1000);
    this.register(() => {
      if (this.elapsedTimer !== null) window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    });

    await this.refresh();
    await this.recoverOrphanedRuns();
  }

  async onClose(): Promise<void> {
    this.runner?.dispose();
    this.runner = null;
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
    this.syncRunner();
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

    this.contentEl.empty();
    const toolbarHost = this.contentEl.createDiv({ cls: 'claudian-agent-board-toolbar-host' });
    const bannerHost = this.contentEl.createDiv({ cls: 'claudian-agent-board-banner-host' });
    const boardHost = this.contentEl.createDiv({ cls: 'claudian-agent-board-host' });

    this.renderQueueChrome(toolbarHost, bannerHost);

    this.renderer.render(
      boardHost,
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
        getSkipReason: (task) => this.runner?.getSkipReason(task.frontmatter.id) ?? null,
        onAckSkip: (task) => {
          this.runner?.clearSkipReason(task.frontmatter.id);
          this.render();
        },
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

  private renderQueueChrome(toolbarHost: HTMLElement, bannerHost: HTMLElement): void {
    this.renderer.renderToolbar(toolbarHost, {
      paused: this.runner?.isPaused() ?? false,
      halted: this.runner?.isHalted() ?? false,
      slotOccupied: this.plugin.queueSlotTracker.occupied(),
      slotCapacity: this.plugin.queueSlotTracker.capacity(),
      consecutiveFailures: this.runner?.getConsecutiveFailures() ?? 0,
      onToggle: () => void this.onToggleQueue(),
    });
    this.renderer.renderHaltBanner(bannerHost, {
      reason: this.runner?.getHaltReason() ?? null,
      onResume: () => this.onResumeQueue(),
      onOpenFailed: () => this.onOpenFailedCards(),
    });
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
    // Prefer cancelling the live RunSession via the shared registry (works even
    // for a run started by a previous view instance); fall back to the optional
    // surface hook for other surfaces.
    const session = sharedRunRegistry.getSession(task.frontmatter.id);
    if (session) {
      session.cancel();
    } else {
      this.executionSurface.cancelTaskRun?.(task.frontmatter.run_id ?? '');
    }
    new Notice(t('tasks.board.stopRequested', { title: task.frontmatter.title }));
  }

  private async saveTaskFields(task: TaskSpec, fields: WorkOrderFieldUpdate): Promise<void> {
    await this.applyNoteChange(task.path, (content) => this.noteStore.writeFields(content, fields));
    await this.refresh();
  }

  private computeSlots(): { used: number; max: number } {
    // Delegate to the activator so the queue's slot gate and the manual
    // new-tab guard (canCreateNewTab) share one tab-accounting source. With no
    // chat view mounted this reports the persisted tab count — the set the next
    // run restores — instead of 0, so the queue can't over-launch past the
    // restored cap and fail ready cards on the tab limit.
    return this.plugin.getTabSlotUsage();
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

    this.plugin.events.emit('task:run-started', { taskId: latest.frontmatter.id, path: task.path });
    const result = await this.coordinator.run(latest);
    const finishedStatus = result.ok
      ? result.status
      : this.lastRunStatus.get(latest.frontmatter.id) ?? latest.frontmatter.status;
    this.lastRunStatus.delete(latest.frontmatter.id);
    this.plugin.events.emit('task:run-finished', {
      taskId: latest.frontmatter.id,
      path: task.path,
      status: finishedStatus,
    });
    if (!result.ok) {
      new Notice(t('tasks.board.runFailed', { error: result.error }));
    }
    await this.refresh();
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

  // Reply/approve/reject route into the live RunSession via the shared registry,
  // so a board reopened mid-run can still drive a run owned by a previous view.
  // If no session is active (the run just ended), the next refresh removes the
  // reply surface, so a stray click is a safe no-op.
  private async onReply(taskId: string, content: string): Promise<void> {
    await sharedRunRegistry.getSession(taskId)?.resume({ kind: 'reply', content });
  }

  private async onApprove(taskId: string): Promise<void> {
    await sharedRunRegistry.getSession(taskId)?.resume({ kind: 'approve' });
  }

  private async onReject(taskId: string, reason: string): Promise<void> {
    await sharedRunRegistry.getSession(taskId)?.resume({ kind: 'reject', reason });
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
      // Skip work orders a run is still driving anywhere in this process (e.g. a
      // previous view instance that was closed and reopened) — only genuinely
      // orphaned runs (no live session, e.g. after a plugin reload) are failed.
      if (sharedRunRegistry.has(task.frontmatter.id)) continue;
      try {
        // Write the failed status first: it only rewrites frontmatter, so a note
        // missing the generated run-ledger markers (hand-edited or older) is
        // still recovered. The ledger append is best-effort and must not abort
        // this note's recovery or the rest of the loop.
        await this.applyNoteChange(task.path, (content) =>
          this.noteStore.writeStatus(content, { status: 'failed', timestamp: now }),
        );
        try {
          await this.applyNoteChange(task.path, (content) =>
            this.noteStore.appendLedger(content, { timestamp: now, status: 'failed', message: 'orphaned by plugin reload' }),
          );
        } catch {
          // The note lacks the generated ledger region; the failed status above
          // is what un-stalls the card, so proceed without the ledger line.
        }
        this.pauseState.delete(task.frontmatter.id);
        this.plugin.events.emit('task:status-changed', { taskId: task.frontmatter.id, path: task.path, status: 'failed' });
        recovered = true;
      } catch {
        // Couldn't even mark this note failed (e.g. a transient write failure);
        // skip it so the remaining orphaned notes are still recovered, and let
        // the next board open retry it.
      }
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

  private isProviderEnabled(providerId: string): boolean {
    const settings = asSettingsBag(this.plugin.settings);
    return (
      ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
      ProviderRegistry.isEnabled(providerId as ProviderId, settings)
    );
  }

  private ownsModel(providerId: string, model: string): boolean {
    const settings = asSettingsBag(this.plugin.settings);
    return (
      ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
      ProviderRegistry.getChatUIConfig(providerId as ProviderId).ownsModel(model, settings)
    );
  }

  private patchModelStatus(taskId: string, status: TaskStatus): void {
    const spec = this.model.tasks.find((task) => task.frontmatter.id === taskId);
    if (spec) spec.frontmatter.status = status;
  }

  // Reads a work order fresh for the queue's pre-launch staleness check, and
  // keeps the in-memory model honest so a changed or removed card isn't re-picked
  // on the next tick. Returns null when the note is gone or unparseable.
  private async reloadTaskFromVault(task: TaskSpec): Promise<TaskSpec | null> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      this.model.tasks = this.model.tasks.filter((t) => t.frontmatter.id !== task.frontmatter.id);
      return null;
    }
    try {
      const fresh = this.noteStore.parse(task.path, await this.plugin.app.vault.read(file)).task;
      // Replace the whole cached entry (status, provider, model, priority) so the
      // next selection re-evaluates against reality and won't re-pick a card the
      // reload just found stale or ineligible.
      const index = this.model.tasks.findIndex((t) => t.frontmatter.id === fresh.frontmatter.id);
      if (index !== -1) this.model.tasks[index] = fresh;
      return fresh;
    } catch {
      return null;
    }
  }

  private syncRunner(): void {
    this.plugin.queueSlotTracker.setCap(this.plugin.settings.agentBoardQueueCap);
    if (!this.runner) {
      this.runner = new QueueRunner({
        slot: this.plugin.queueSlotTracker,
        getTasks: () => this.model.tasks,
        eligibility: {
          isProviderEnabled: (id) => this.isProviderEnabled(id),
          ownsModel: (id, model) => this.ownsModel(id, model),
          isActive: (id) => this.coordinator.isActive(id),
        },
        coordinator: this.coordinator,
        appendLedger: (task, entry) =>
          this.applyNoteChange(task.path, (content) => this.noteStore.appendLedger(content, entry)),
        events: this.plugin.events,
        haltAfterFailures: this.plugin.settings.agentBoardQueueHaltAfter,
        // One shared control state across every board, so pause/halt/failure-count
        // are global — no per-pane propagation needed.
        control: this.plugin.queueControl,
        now: () => Date.now(),
        getFreeExecutionSlots: () => this.freeExecutionSlots(),
        // Re-read each card just before launch so the queue never runs a stale
        // cached spec (e.g. completed/edited since the last index), mirroring the
        // manual run path.
        reloadTask: (task) => this.reloadTaskFromVault(task),
        // Reserve the chat tab synchronously at launch (before the async reload)
        // so a second pane can't double-book the same free tab.
        reservations: this.plugin.chatTabReservations,
      });
    } else {
      this.runner.setHaltAfterFailures(this.plugin.settings.agentBoardQueueHaltAfter);
    }
    // Align the shared control with the persisted pause flag: restores pause on
    // first mount and tracks an external settings edit. Because the control is
    // shared, this takes effect on every open board's runner at once.
    const paused = this.config.queue?.paused ?? false;
    if (this.runner.isPaused() !== paused) this.runner.setPaused(paused);
    this.runner.tick();
  }

  // Free chat tabs a queue run can open right now. A run that can't get a tab
  // fails in the runtime and would mark a ready card failed, so the queue gates
  // launches on this and waits for a tab to free up.
  private freeExecutionSlots(): number {
    const { used, max } = this.computeSlots();
    return Math.max(0, max - used);
  }

  // saveSettings() emits task:queue-cap-changed on any settings change. The
  // global concurrency cap is applied by the plugin already, but the halt
  // threshold is per-runner, so apply the live value here before draining —
  // otherwise a changed limit only takes effect on the next board refresh.
  // (Deliberately not a full syncRunner(): that reconciles pause from the cached
  // config, which would revert a pause just toggled from a board.)
  private onQueueCapChanged(): void {
    this.runner?.setHaltAfterFailures(this.plugin.settings.agentBoardQueueHaltAfter);
    this.runner?.tick();
  }

  private async onToggleQueue(): Promise<void> {
    if (!this.runner) return;
    // The toggle reads as ▶ when paused or halted; either way the intent is to
    // (re)start the queue. Otherwise it reads as ⏸ and pauses.
    const shouldRun = this.runner.isPaused() || this.runner.isHalted();
    const nextPaused = !shouldRun;
    if (this.runner.isHalted()) this.runner.clearHalt();
    // Apply the paused state before persisting: saveSettings() emits a queue wake
    // that ticks every board's runner, so flipping the shared control first means
    // a pause can't be undercut by a card auto-launching during the save.
    this.runner.setPaused(nextPaused);
    try {
      writeBoardQueuePaused(asSettingsBag(this.plugin.settings), nextPaused);
      await this.plugin.saveSettings();
      void this.refresh();
    } catch (error) {
      new Notice(t('tasks.board.updateFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private onResumeQueue(): void {
    this.runner?.clearHalt();
    this.runner?.setPaused(false);
    void this.refresh();
  }

  private onOpenFailedCards(): void {
    // Placeholder until a dedicated filter exists: a refresh resurfaces the
    // current board state, including any failed/needs-fix cards.
    void this.refresh();
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
