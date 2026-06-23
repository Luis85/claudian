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
import { buildPersonaResolverFromAgents, type PersonaResolver } from '../../agents/personaRegistry';
import type { RosterAgent } from '../../agents/roster/rosterTypes';
import { archiveWorkOrder, deleteWorkOrder } from '../commands/taskCommands';
import {
  getLaneForStatus,
  loadBoardConfig,
  writeBoardQueuePaused,
  writeLaneCollapsed,
} from '../config/BoardConfigStore';
import type { BoardConfig, ResolvedBoardLayout } from '../config/boardConfigTypes';
import { resolveBoardLayout } from '../config/resolveBoardLayout';
import { sharedRunRegistry } from '../execution/activeRunRegistry';
import { QueueRunner } from '../execution/QueueRunner';
import { DEFAULT_STALE_THRESHOLD_MS } from '../execution/RunSession';
import { selectNextReadyTask } from '../execution/selectNextReadyTask';
import type { TaskExecutionSurface } from '../execution/TaskExecutionSurface';
import { TaskRunCoordinator } from '../execution/TaskRunCoordinator';
import { TaskIndexer } from '../indexing/TaskIndexer';
import { LoopCatalog } from '../loops/LoopCatalog';
import { canTransitionTaskStatus, isRunnableTaskStatus } from '../model/taskStateMachine';
import type { TaskBoardModel, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { type AgentBoardPauseState, AgentBoardRenderer } from './AgentBoardRenderer';
import { createWorkOrderInteractive } from './createWorkOrderInteractive';
import { loadLatestTaskSpec } from './loadLatestTaskSpec';
import { chooseLoop } from './LoopPickerModal';
import { showWorkOrderContextMenu } from './WorkOrderContextMenu';
import { buildWorkOrderConversationBindings } from './workOrderConversationBindings';
import { WorkOrderDetailModal, type WorkOrderFieldUpdate } from './WorkOrderDetailModal';
import { buildWorkOrderFieldOptions } from './workOrderFieldOptions';

// Orphan recovery uses the same stale window as RunSession's own stale check,
// so a sidecar heartbeat newer than this is treated as a still-live writer.
const ORPHAN_STALE_THRESHOLD_MS = DEFAULT_STALE_THRESHOLD_MS;
// Periodic orphan recheck cadence. The onOpen sweep catches stale cards after a
// reload; this cadence catches a mid-session crash that strands a card while
// the board stays open. Coarse (60s) on purpose — recovery is cheap but the
// stale window itself is 5 minutes, so faster polling adds no real signal.
const ORPHAN_RECHECK_INTERVAL_MS = 60_000;

export class AgentBoardView extends ItemView {
  private readonly noteStore = new TaskNoteStore();
  private readonly indexer = new TaskIndexer(this.noteStore);
  private readonly renderer = new AgentBoardRenderer();
  // Resolves loop slugs attached to work orders via frontmatter `loop` field.
  // Initialized in the constructor (after plugin is bound) because field
  // initializers run before parameter properties are assigned.
  private readonly loopCatalog: LoopCatalog;
  // Slug → display-name cache populated on each refresh so the properties panel
  // can resolve loop names synchronously without an async vault read per open.
  private loopNameCache = new Map<string, string>();
  // Preloaded persona resolver for roster-agent avatars. Rebuilt lazily and
  // invalidated on `roster:changed` so renamed/recolored agents repaint.
  // Reloaded synchronously in refresh() so avatars are correct on first paint.
  private rosterAgents: RosterAgent[] = [];
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
  // Periodic re-check for orphaned runs: the onOpen sweep catches a board that
  // was reopened after a reload, but a mid-session crash can strand cards while
  // the board is already open. recoverOrphanedRuns is idempotent (skips cards
  // with a live registry entry or a fresh sidecar heartbeat) so running on a
  // cadence here is safe.
  private orphanRecheckTimer: number | null = null;
  // Reentry guard for `recoverOrphanedRuns`. Called from onOpen, the periodic
  // timer, and (potentially) other paths; a second pass entering while the
  // first is mid-await would scan the same model and double-write `failed`
  // for the same orphan. The guard collapses overlapping calls into a single
  // pass; subsequent invocations no-op cleanly.
  private recoveringOrphans = false;
  private readonly pauseState = new Map<string, AgentBoardPauseState>();
  // Last status written per task, so a failed/canceled run can report the
  // terminal status on `task:run-finished` without re-reading the note.
  private readonly lastRunStatus = new Map<string, TaskStatus>();
  // Most recent heartbeat event timestamp per task. The note frontmatter only
  // updates the heartbeat at start/pause/resume, so reading it for the live
  // strip would freeze the age display between transitions; this map holds the
  // sidecar tick's `at` value so the rendered age stays fresh second-by-second.
  private readonly liveHeartbeats = new Map<string, string>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ClaudianPlugin,
    private readonly executionSurface: TaskExecutionSurface,
  ) {
    super(leaf);
    // Reads the folder live via a getter so a settings change is picked up without
    // reinstantiating. Must be set before the coordinator closure captures `this`.
    this.loopCatalog = new LoopCatalog(
      this.plugin.app.vault,
      () => this.plugin.settings.agentBoardLoopFolder || 'Agent Board/loops',
    );
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
      writeHeartbeat: (runId, hb) =>
        // Stamp the current plugin's runtimeId so orphan recovery can detect a
        // sidecar written by a previous plugin load immediately, instead of
        // waiting for the 5-minute stale-`at` window to age out.
        this.plugin.runSidecarStore.writeHeartbeat(runId, { ...hb, runtimeId: this.plugin.runtimeId }),
      appendLedger: (_task, runId, entry) =>
        this.plugin.runSidecarStore.appendLedger(runId, entry),
      finalizeLedgerToNote: (task, runId) => this.finalizeLedgerToNote(task, runId),
      writeHandoff: (task, markdown) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.writeHandoff(content, markdown)),
      renderPrompt: async (task) =>
        renderTaskPrompt(
          task,
          getLaneForStatus(this.config, task.frontmatter.status) ?? undefined,
          (await this.loopCatalog.resolveLoop(task.frontmatter.loop)) ?? undefined,
        ),
      resolveAgentRunTarget: (agentId) => this.plugin.resolveAgentRunTarget(agentId),
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
    // A vault delete never emits a terminal status change, so the in-memory
    // pause + heartbeat maps would otherwise leak when a paused card is
    // deleted from disk. Evict before scheduling the refresh.
    this.registerEvent(vault.on('delete', (file) => {
      this.evictInMemoryStateForPath(file.path);
      this.onVaultChange(file);
    }));
    this.registerEvent(vault.on('rename', (file) => this.onVaultChange(file)));
    // A freed chat tab can unblock the queue (it gates launches on tab
    // availability), so re-render the slot count and nudge the runner.
    this.register(this.plugin.events.on('chat:tabs-changed', () => {
      this.refreshSlots();
      this.runner?.tick();
    }));
    this.register(this.plugin.events.on('task:board-config-changed', () => void this.refresh()));
    this.register(this.plugin.events.on('roster:changed', () => void this.refresh()));

    // Live-run visibility: patch cards in place from run events without a full
    // re-render, and tick the elapsed timer every second.
    this.register(this.plugin.events.on('task:attempt-started', (p) => this.patchCard(p.taskId)));
    this.register(this.plugin.events.on('task:ledger-appended', (p) => this.patchLiveStrip(p.taskId, p.entry.message)));
    this.register(this.plugin.events.on('task:heartbeat', (p) => {
      this.liveHeartbeats.set(p.taskId, p.at);
      this.patchLiveStrip(p.taskId);
    }));
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
    this.register(this.plugin.events.on('task:queue-state-changed', () => this.render()));

    this.elapsedTimer = window.setInterval(() => this.tickElapsed(), 1000);
    this.register(() => {
      if (this.elapsedTimer !== null) window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    });

    // Run orphan recovery once after the initial index, then on a slow cadence
    // for as long as the board is open. recoverOrphanedRuns is idempotent — it
    // only acts on cards whose status looks live but have no driver and no fresh
    // sidecar tick — so a periodic re-check costs almost nothing and catches a
    // mid-session crash that strands cards while a board is already open.
    await this.refresh();
    await this.sweepStaleSidecars();
    await this.recoverOrphanedRuns();
    this.orphanRecheckTimer = window.setInterval(
      () => { void this.recoverOrphanedRuns(); },
      ORPHAN_RECHECK_INTERVAL_MS,
    );
    this.register(() => {
      if (this.orphanRecheckTimer !== null) window.clearInterval(this.orphanRecheckTimer);
      this.orphanRecheckTimer = null;
    });
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
    // Preload roster agents so the persona resolver paints correct avatars on
    // the synchronous render below (no async resolver race on first paint).
    this.rosterAgents = (await this.plugin.agentRosterStore?.list()) ?? [];
    this.model = await this.indexer.indexVaultFolder(this.plugin.app.vault, this.folder);
    const { config, errors } = loadBoardConfig(settings);
    this.config = config;
    const layout = resolveBoardLayout(config, this.model);
    this.layout = { ...layout, errors: [...errors, ...layout.errors] };
    // Rebuild the slug→name cache so the modal's properties panel can resolve
    // loop display names synchronously when opened (no async read at open time).
    const loops = await this.loopCatalog.listLoops();
    this.loopNameCache = new Map(loops.map((loop) => [loop.id, loop.name]));
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

  /**
   * Drop in-memory pause + live heartbeat entries for a work-order path. Called
   * on `vault.on('delete')` because a deleted file never emits a terminal
   * status change — without this, paused cards leak their pause payload until
   * the plugin reloads. Lookup is by path → task id from the current model,
   * since the deleted file is already gone from the vault.
   */
  private evictInMemoryStateForPath(path: string): void {
    if (!path.startsWith(`${this.folder}/`)) return;
    const task = this.model.tasks.find((entry) => entry.path === path);
    if (!task) return;
    const id = task.frontmatter.id;
    this.pauseState.delete(id);
    this.liveHeartbeats.delete(id);
    this.lastRunStatus.delete(id);
    this.renderer.removeCard(id);
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

  // Synchronous persona resolver built from the roster list preloaded in
  // refresh() — no async race, so avatars are correct on the first paint.
  private getPersonaResolver(): PersonaResolver {
    return buildPersonaResolverFromAgents(this.rosterAgents);
  }

  private render(): void {
    // Preserve lane scroll position across full re-renders so interacting with a
    // card (which triggers refresh) doesn't jump the board back to the left.
    const lanesSelector = '.claudian-agent-board-lanes';
    const previousLanes = this.contentEl.querySelector(lanesSelector) as HTMLElement | null;
    const scrollLeft = previousLanes?.scrollLeft ?? 0;
    const scrollTop = previousLanes?.scrollTop ?? 0;

    this.contentEl.empty();
    const boardHost = this.contentEl.createDiv({ cls: 'claudian-agent-board-host' });

    this.renderer.render(
      boardHost,
      {
        layout: this.layout,
        invalidNotes: this.model.invalidNotes,
        slots: this.computeSlots(),
        queue: this.getQueueToolbarState(),
      },
      {
        onOpenDetail: (task) => void this.openDetail(task),
        onRun: (task) => void this.runTask(task),
        onStop: (task) => this.stopTask(task),
        onAccept: (task) => void this.transitionTask(task, 'done', 'Accepted from review.'),
        onRework: (task) => void this.reworkTask(task),
        onMarkReady: (task) => void this.transitionTask(task, 'ready', 'Marked ready.'),
        onReopen: (task) => void this.transitionTask(task, 'inbox', 'Reopened.'),
        onMoveToInbox: (task) => void this.transitionTask(task, 'inbox', 'Moved back to inbox.'),
        onAddWorkOrder: () => void this.addWorkOrderFromBoard(),
        onRunNextReady: () => void this.runNextReady(),
        getSkipReason: (task) => this.runner?.getSkipReason(task.frontmatter.id) ?? null,
        onAckSkip: (task) => {
          this.runner?.clearSkipReason(task.frontmatter.id);
          this.render();
        },
        onToggleLaneCollapse: (laneId) => {
          void this.handleToggleLaneCollapse(laneId);
        },
        onContextMenu: (task, event) => showWorkOrderContextMenu(task, event, {
          plugin: this.plugin,
          onOpenNote: (target) => void this.openTask(target),
          ...buildWorkOrderConversationBindings(this.plugin),
          onArchive: (target) => void this.archiveTask(target),
          onDelete: (target) => void this.deleteTask(target),
        }),
        // Hover action cluster ⋯ menu items reuse the same view methods the
        // right-click context menu uses, so both surfaces stay in lockstep.
        onArchive: (task) => void this.archiveTask(task),
        onOpenNote: (task) => void this.openTask(task),
        // Spread gives both onOpenConversation and canOpenConversation so the ⋯
        // menu gates "Open conversation" the same way the modal/right-click do.
        ...buildWorkOrderConversationBindings(this.plugin),
        onReply: (task, content) => void this.onReply(task.frontmatter.id, content),
        onApprove: (task) => void this.onApprove(task.frontmatter.id),
        onReject: (task, reason) => void this.onReject(task.frontmatter.id, reason),
        onCancelPaused: (task) => this.stopTask(task),
        onSendToReview: (task) => void this.transitionTask(task, 'review', 'Sent to review without a structured handoff.'),
        onMarkFailed: (task) => void this.transitionTask(task, 'failed', 'Marked failed: run produced no structured handoff.'),
        resolvePersona: this.getPersonaResolver(),
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

  private getQueueToolbarState() {
    return {
      paused: this.runner?.isPaused() ?? true,
      halted: this.runner?.isHalted() ?? false,
      haltReason: this.runner?.getHaltReason() ?? null,
      slotOccupied: this.plugin.queueSlotTracker.occupied(),
      slotCapacity: this.plugin.queueSlotTracker.capacity(),
      consecutiveFailures: this.runner?.getConsecutiveFailures() ?? 0,
      onToggle: () => void this.onToggleQueue(),
    };
  }

  private async openDetail(task: TaskSpec): Promise<void> {
    const settings = asSettingsBag(this.plugin.settings);
    // Preload the roster so the agent picker is populated on first render; an
    // async preload would leave roster agents missing when the modal opens.
    const agents = (await this.plugin.agentRosterStore?.list()) ?? [];
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
      ...buildWorkOrderFieldOptions(settings, agents),
      getLoopName: (loopId) => (loopId ? this.loopNameCache.get(loopId) : undefined),
      onPickLoop: (target) => this.pickLoopForTask(target),
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
    // No explicit refresh: applyNoteChange goes through vault.process, which
    // emits a `modify` event the onOpen handler already wires to a 100ms
    // debounced refresh. Three field edits in quick succession (title +
    // provider + model) collapse to one re-index instead of three.
    await this.applyNoteChange(task.path, (content) => this.noteStore.writeFields(content, fields));
  }

  private async pickLoopForTask(task: TaskSpec): Promise<string | undefined> {
    const result = await chooseLoop(this.plugin, task.frontmatter.loop);
    // An empty loopId detaches the loop (handled by TaskNoteStore.writeFields).
    if (result.cancelled || result.loopId === undefined) return undefined;
    await this.saveTaskFields(task, { loop: result.loopId });
    return result.loopId;
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

  // Deletes the WO note via Obsidian's trash flow (system trash or vault
  // `.trash/`, depending on the user's setting). Only offered from `inbox`
  // because that's where triage captures land — past triage the safer escape
  // hatch is Archive.
  private async deleteTask(task: TaskSpec): Promise<void> {
    const ok = await confirm(
      this.plugin.app,
      `Delete work order "${task.frontmatter.title}"? The note will be moved to the trash.`,
      'Delete',
    );
    if (!ok) return;
    const trashed = await deleteWorkOrder(this.plugin, task);
    if (trashed) {
      new Notice(t('tasks.board.deleted', { title: task.frontmatter.title }));
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
      void this.openDetail(task);
    } catch {
      // Best-effort: ignore a vault read or parse failure; the board already refreshed.
    }
  }

  private async transitionTask(task: TaskSpec, to: TaskStatus, message: string): Promise<void> {
    const latest = await loadLatestTaskSpec(
      this.plugin.app, this.noteStore, task.path, 'tasks.board.updateFailed',
    );
    if (!latest) {
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
    const latest = await loadLatestTaskSpec(
      this.plugin.app, this.noteStore, task.path, 'tasks.board.runParseFailed',
    );
    if (!latest) {
      await this.refresh();
      return;
    }

    // Only ready/needs_fix may run. Guard here so no entry point (menus, future
    // callers) can start a run from an untriaged or terminal status.
    if (!isRunnableTaskStatus(latest.frontmatter.status)) {
      new Notice(t('tasks.board.notRunnable', { title: latest.frontmatter.title }));
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
    // Prefer the live heartbeat captured from the run event — frontmatter only
    // updates at transitions, so the rendered age would otherwise freeze between
    // start and the next pause/resume even though the run is still ticking.
    const liveHeartbeat = this.liveHeartbeats.get(taskId);
    const heartbeatSource = liveHeartbeat ?? task.frontmatter.heartbeat;
    const heartbeatAt = heartbeatSource ? Date.parse(heartbeatSource) : now;
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
    // Drop the live heartbeat at terminal so a re-launched card doesn't show
    // the previous run's stale tick before the new run's first heartbeat lands.
    // `needs_handoff` is also terminal here — the run ended without a parseable
    // handoff and only a re-run can restart heartbeats.
    if (
      p.status === 'review'
      || p.status === 'done'
      || p.status === 'failed'
      || p.status === 'canceled'
      || p.status === 'needs_handoff'
    ) {
      this.liveHeartbeats.delete(p.taskId);
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
   * Replace the work-order note's run-ledger region with the sidecar snapshot
   * at terminal, then GC the sidecar. Failure is surfaced (event) and the
   * sidecar is intentionally KEPT so the ledger isn't lost — a hand-edited
   * note missing the `<!-- claudian:run-ledger-* -->` markers can be recovered
   * by reading `.claudian/runs/<runId>/ledger.jsonl` directly. Called from the
   * coordinator wiring; extracted as a method so tests can pin the
   * snapshot/emit/cleanup contract without driving a full RunSession.
   */
  private async finalizeLedgerToNote(task: TaskSpec, runId: string): Promise<void> {
    const snapshot = await this.plugin.runSidecarStore.snapshotLedgerAsMarkdown(runId);
    if (snapshot) {
      try {
        await this.applyNoteChange(task.path, (content) => this.noteStore.writeLedgerSnapshot(content, snapshot));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.plugin.logger.scope('tasks.finalizeLedger').warn(
          `failed to write run-ledger snapshot for ${task.path} (run ${runId}): ${message}`,
        );
        this.plugin.events.emit('task:ledger-finalize-failed', {
          taskId: task.frontmatter.id,
          path: task.path,
          runId,
          error: message,
        });
        // Keep the sidecar so the ledger stays recoverable; the next board
        // open's sweep won't touch it either (the task is still terminal-ish
        // here, so the sweep won't match a "no active task" predicate either —
        // by design, leave it for human triage).
        return;
      }
    }
    // Snapshot landed (or the ledger was empty), so the sidecar's job for
    // this run is over. Cleanup is best-effort — a leftover sidecar dir is
    // harmless and orphan recovery treats a stale heartbeat as dead.
    await this.plugin.runSidecarStore.cleanupRun(runId);
  }

  /**
   * Deletes sidecar dirs under `.claudian/runs/` whose owning work order is
   * gone or no longer in a live status. Runs at board open after `refresh()`
   * so `this.model.tasks` reflects the on-disk truth. A sidecar dir whose
   * run_id matches an active (running/needs_input/needs_approval) task is
   * preserved — recoverOrphanedRuns may still need its heartbeat to decide
   * the card's fate. Everything else (cards that finished before the
   * post-snapshot cleanup landed, or crashed mid-flight without a matching
   * card) is removed silently.
   */
  private async sweepStaleSidecars(): Promise<void> {
    const runIds = await this.plugin.runSidecarStore.listRuns();
    if (runIds.length === 0) return;
    const activeRunIds = new Set<string>();
    for (const task of this.model.tasks) {
      const status = task.frontmatter.status;
      if (status === 'running' || status === 'needs_input' || status === 'needs_approval') {
        const id = task.frontmatter.run_id;
        if (id) activeRunIds.add(id);
      }
    }
    await Promise.all(
      runIds
        .filter((id) => !activeRunIds.has(id))
        .map((id) => this.plugin.runSidecarStore.cleanupRun(id)),
    );
  }

  /**
   * Marks any work order persisted as running/needs_input/needs_approval but with
   * no live session (e.g. a plugin reload mid-run) as failed, so the board never
   * shows a permanently "active" card that nothing is driving.
   */
  private async recoverOrphanedRuns(): Promise<void> {
    if (this.recoveringOrphans) return;
    this.recoveringOrphans = true;
    try {
      await this.recoverOrphanedRunsInner();
    } finally {
      this.recoveringOrphans = false;
    }
  }

  private async recoverOrphanedRunsInner(): Promise<void> {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    let recovered = false;
    for (const task of this.model.tasks) {
      const status = task.frontmatter.status;
      if (status !== 'running' && status !== 'needs_input' && status !== 'needs_approval') continue;
      // Skip work orders a run is still driving anywhere in this process (e.g. a
      // previous view instance that was closed and reopened) — only genuinely
      // orphaned runs (no live session, e.g. after a plugin reload) are failed.
      if (sharedRunRegistry.has(task.frontmatter.id)) continue;
      const runId = task.frontmatter.run_id;
      if (runId && await this.hasFreshSidecarHeartbeat(runId, nowMs)) continue;
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

  /**
   * Sidecar heartbeat safety net: a sidecar timestamp newer than the stale
   * threshold means a writer was alive very recently (e.g. a fast hot-reload
   * window), so skip recovery. After a true plugin reload nothing keeps
   * writing, so on the next pass the check ages out and recovery succeeds.
   */
  private async hasFreshSidecarHeartbeat(runId: string, nowMs: number): Promise<boolean> {
    try {
      const sidecar = await this.plugin.runSidecarStore.readHeartbeat(runId);
      if (!sidecar) return false;
      // RuntimeId mismatch = the previous plugin load wrote this and is now
      // gone — recover immediately regardless of `at` freshness, so a mid-run
      // reload doesn't strand the card for the full stale window. A legacy
      // sidecar without runtimeId falls back to the `at` check below, so
      // upgrading the plugin must not strand existing sidecars.
      if (sidecar.runtimeId && sidecar.runtimeId !== this.plugin.runtimeId) return false;
      const sidecarMs = Date.parse(sidecar.at);
      return Number.isFinite(sidecarMs) && nowMs - sidecarMs < ORPHAN_STALE_THRESHOLD_MS;
    } catch {
      // Corrupt or unreadable sidecar must not strand the card — recover so
      // the run doesn't sit "running" forever.
      return false;
    }
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
    // Startup safety: every plugin session starts paused even if the last saved
    // board config says the queue was running. A saved `false` is honored only
    // after the user explicitly starts the queue in this session; saved `true`
    // can always pause it.
    const paused = this.config.queue?.paused ?? false;
    if (paused) {
      if (!this.runner.isPaused()) this.runner.setPaused(true);
    } else if (this.plugin.queueControl.sessionActivated && this.runner.isPaused()) {
      this.runner.setPaused(false);
    }
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
  //
  // Also re-render the board chrome: the toolbar's "Work-order tabs N/M" badge
  // reads `state.slots.max` from `computeSlots()`, which derives from the queue
  // cap. Without a render here the badge stays stale until the next status/run
  // event ticks the board, even though the cap is already live.
  private onQueueCapChanged(): void {
    this.runner?.setHaltAfterFailures(this.plugin.settings.agentBoardQueueHaltAfter);
    this.runner?.tick();
    this.render();
  }

  private async handleToggleLaneCollapse(laneId: string): Promise<void> {
    const settings = asSettingsBag(this.plugin.settings);
    const lane = this.config.lanes.find((candidate) => candidate.id === laneId);
    // No-op for an unknown lane id (race vs editor delete/reorder) and for a
    // non-collapsible lane; `writeLaneCollapsed` enforces the same invariant
    // on disk, but bailing early avoids a needless saveSettings round-trip.
    if (!lane || !lane.collapsible) return;
    writeLaneCollapsed(settings, laneId, !lane.collapsed);
    try {
      await this.plugin.saveSettings();
      // Other open Agent Board panes refresh their cached `config`/`layout`
      // only on this event (see `onOpen` registration); without it a second
      // pane keeps showing the stale expanded/collapsed state until an
      // unrelated refresh. Matches the AgentBoardLaneEditor save path.
      this.plugin.events.emit('task:board-config-changed');
    } catch (error) {
      new Notice(t('tasks.board.updateFailed', { error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    this.config = loadBoardConfig(settings).config;
    this.layout = resolveBoardLayout(this.config, this.model);
    this.render();
  }

  private async onToggleQueue(): Promise<void> {
    if (!this.runner) return;
    // The toggle reads "Run queue" when paused or halted; either way the intent
    // is to (re)start the queue. Otherwise it reads "Pause queue" and pauses.
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
