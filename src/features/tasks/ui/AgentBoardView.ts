import type { TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { VIEW_TYPE_CLAUDIAN_AGENT_BOARD } from '../../../core/types/chat';
import { asSettingsBag } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { confirm } from '../../../shared/modals/ConfirmModal';
import { archiveWorkOrder } from '../commands/taskCommands';
import { getLaneForStatus, loadBoardConfig } from '../config/BoardConfigStore';
import type { BoardConfig, ResolvedBoardLayout } from '../config/boardConfigTypes';
import { resolveBoardLayout } from '../config/resolveBoardLayout';
import { selectNextReadyTask } from '../execution/selectNextReadyTask';
import type { TaskExecutionSurface } from '../execution/TaskExecutionSurface';
import { TaskRunCoordinator } from '../execution/TaskRunCoordinator';
import { TaskIndexer } from '../indexing/TaskIndexer';
import { canTransitionTaskStatus } from '../model/taskStateMachine';
import type { TaskBoardModel, TaskSpec, TaskStatus } from '../model/taskTypes';
import { renderTaskPrompt } from '../prompt/TaskPromptRenderer';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { AgentBoardRenderer } from './AgentBoardRenderer';
import { createWorkOrderInteractive } from './createWorkOrderInteractive';
import { WorkOrderDetailModal, type WorkOrderFieldUpdate } from './WorkOrderDetailModal';

export class AgentBoardView extends ItemView {
  private readonly noteStore = new TaskNoteStore();
  private readonly indexer = new TaskIndexer(this.noteStore);
  private readonly renderer = new AgentBoardRenderer();
  private model: TaskBoardModel = { tasks: [], invalidNotes: [] };
  private config: BoardConfig = loadBoardConfig({}).config;
  private layout: ResolvedBoardLayout = { lanes: [], errors: [] };
  private refreshTimer: number | null = null;

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
    await this.refresh();
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
        onRework: (task) => void this.transitionTask(task, 'needs_fix', 'Sent back for rework.'),
        onMarkReady: (task) => void this.transitionTask(task, 'ready', 'Marked ready.'),
        onAddWorkOrder: () => void this.addWorkOrderFromBoard(),
        onRunNextReady: () => void this.runNextReady(),
      },
    );

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
      onOpenConversation: (target) => {
        const conversationId = target.frontmatter.conversation_id;
        if (conversationId) void this.plugin.openConversation(conversationId);
      },
      canOpenConversation: (target) => {
        const conversationId = target.frontmatter.conversation_id;
        return Boolean(conversationId && this.plugin.getConversationSync(conversationId));
      },
      onRun: (target) => void this.runTask(target),
      onStop: (target) => this.stopTask(target),
      onAccept: (target) => void this.transitionTask(target, 'done', 'Accepted from review.'),
      onRework: (target) => void this.transitionTask(target, 'needs_fix', 'Sent back for rework.'),
      onMarkReady: (target) => void this.transitionTask(target, 'ready', 'Marked ready.'),
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

    const settings = asSettingsBag(this.plugin.settings);
    let lastStatus: TaskStatus = latest.frontmatter.status;
    const coordinator = new TaskRunCoordinator({
      executionSurface: this.executionSurface,
      now: () => new Date().toISOString(),
      isProviderEnabled: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
        ProviderRegistry.isEnabled(providerId as ProviderId, settings),
      ownsModel: (providerId, model) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
        ProviderRegistry.getChatUIConfig(providerId as ProviderId).ownsModel(model, settings),
      writeTaskStatus: async (_task, options) => {
        await this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, options));
        lastStatus = options.status;
        this.plugin.events.emit('task:status-changed', {
          taskId: latest.frontmatter.id,
          path: task.path,
          status: options.status,
        });
      },
      appendLedger: (_task, entry) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.appendLedger(content, entry)),
      writeHandoff: (_task, markdown) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.writeHandoff(content, markdown)),
      renderPrompt: (target) =>
        renderTaskPrompt(target, getLaneForStatus(this.config, target.frontmatter.status) ?? undefined),
    });

    this.plugin.events.emit('task:run-started', { taskId: latest.frontmatter.id, path: task.path });
    const result = await coordinator.run(latest);
    this.plugin.events.emit('task:run-finished', {
      taskId: latest.frontmatter.id,
      path: task.path,
      status: result.ok ? result.status : lastStatus,
    });
    if (!result.ok) {
      new Notice(t('tasks.board.runFailed', { error: result.error }));
    }
    await this.refresh();
  }

  async runNextReady(): Promise<void> {
    await this.refresh();
    const next = selectNextReadyTask(this.model.tasks, (status) => status === 'ready');
    if (!next) {
      new Notice(t('tasks.board.noReady'));
      return;
    }
    await this.runTask(next);
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
