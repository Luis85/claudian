import { type TAbstractFile,TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types/settings';
import type {
  WorkOrderActivityClosableTab,
  WorkOrderActivityItem,
  WorkOrderActivityProvider as WorkOrderActivityProviderContract,
  WorkOrderActivitySummary,
} from '../../../core/types/workOrderActivity';
import { EMPTY_WORK_ORDER_ACTIVITY_SUMMARY } from '../../../core/types/workOrderActivity';
import type ClaudianPlugin from '../../../main';
import { revealWorkspaceLeaf } from '../../../utils/obsidianCompat';
import { TaskIndexer } from '../indexing/TaskIndexer';
import type { TaskBoardModel, TaskSpec } from '../model/taskTypes';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { buildWorkOrderActivitySummary } from './workOrderActivitySummary';
import { buildWorkOrderConversationBindings } from './workOrderConversationBindings';
import { WorkOrderDetailModal, type WorkOrderDetailModalCallbacks, type WorkOrderFieldUpdate } from './WorkOrderDetailModal';

export interface WorkOrderActivityProviderDeps {
  indexTasks?: () => Promise<TaskBoardModel>;
  openDetailModal?: (task: TaskSpec) => void;
}

export class WorkOrderActivityProvider implements WorkOrderActivityProviderContract {
  private readonly noteStore = new TaskNoteStore();
  private readonly indexer = new TaskIndexer(this.noteStore);
  private readonly listeners = new Set<(summary: WorkOrderActivitySummary) => void>();
  private summary: WorkOrderActivitySummary = EMPTY_WORK_ORDER_ACTIVITY_SUMMARY;
  private disposers: Array<() => void> = [];
  // Monotonic refresh token. Out-of-order completions (e.g. a slow vault scan
  // resolving after a faster one started later) must not overwrite the latest
  // published summary, otherwise the dropdown can flash back to a stale state
  // until the next event tick.
  private refreshGeneration = 0;
  private refreshTimer: number | null = null;

  constructor(private readonly plugin: ClaudianPlugin, private readonly deps: WorkOrderActivityProviderDeps = {}) {}

  start(): void {
    const refresh = (): void => { void this.refresh(); };
    this.disposers = [
      this.plugin.events.on('task:run-started', refresh),
      this.plugin.events.on('task:status-changed', refresh),
      this.plugin.events.on('task:needs-input', refresh),
      this.plugin.events.on('task:needs-approval', refresh),
      this.plugin.events.on('task:run-finished', refresh),
      this.plugin.events.on('task:board-config-changed', refresh),
    ];
    this.watchVault();
    void this.refresh();
  }

  // Task bus events only cover runs Claudian drives. Work-order notes can also
  // change through plain vault operations — manual status edits, deletes,
  // renames, external sync — which never emit a task event. Without this the
  // dropdown would keep a finished/deleted order pinned in the chat header until
  // an unrelated task event or reload, unlike AgentBoardView which already
  // listens on the vault for the work-order folder.
  private watchVault(): void {
    const vault = this.plugin.app.vault;
    if (typeof vault.on !== 'function') return;
    const onChange = (file: TAbstractFile, oldPath?: string): void => {
      if (this.isWorkOrderPath(file.path) || (oldPath !== undefined && this.isWorkOrderPath(oldPath))) {
        this.scheduleRefresh();
      }
    };
    const refs = [
      vault.on('create', onChange),
      vault.on('modify', onChange),
      vault.on('delete', onChange),
      vault.on('rename', onChange),
    ];
    for (const ref of refs) this.disposers.push(() => vault.offref(ref));
  }

  // Coalesce bursts (a single board action can rename + modify the same note)
  // into one vault re-index, matching AgentBoardView's debounce window.
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 100);
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.listeners.clear();
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getSummary(): WorkOrderActivitySummary {
    return this.summary;
  }

  subscribe(callback: (summary: WorkOrderActivitySummary) => void): () => void {
    this.listeners.add(callback);
    callback(this.summary);
    return () => this.listeners.delete(callback);
  }

  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const model = await this.indexModel();
    if (generation !== this.refreshGeneration) return;
    const base = buildWorkOrderActivitySummary(model.tasks);
    this.summary = { ...base, closableTabs: this.collectClosableTabs(base.items) };
    for (const listener of [...this.listeners]) listener(this.summary);
  }

  // Open work-order tabs whose run is no longer active. Work-order badges are
  // hidden from the tab bar, so a finished/orphaned work-order tab would be
  // invisible and uncloseable while still consuming the work-order slot budget
  // (blocking the next queued/manual run). The dropdown offers an explicit close
  // for these; "active" tabs (those backing a running/needs-input/needs-approval
  // item) are excluded because their row already navigates to the live tab.
  private collectClosableTabs(activeItems: readonly WorkOrderActivityItem[]): WorkOrderActivityClosableTab[] {
    const activeTabIds = new Set(
      activeItems.map((item) => item.sidepanelTabId).filter((id): id is string => typeof id === 'string'),
    );
    const seen = new Set<string>();
    const result: WorkOrderActivityClosableTab[] = [];
    for (const view of this.plugin.getAllViews()) {
      const manager = view.getTabManager();
      if (typeof manager?.listWorkOrderTabs !== 'function') continue;
      for (const tab of manager.listWorkOrderTabs()) {
        if (activeTabIds.has(tab.id) || seen.has(tab.id)) continue;
        // A run just started can create its tab before RunSession persists
        // `running` + `sidepanel_tab_id`, so the tab is briefly absent from
        // activeItems. Never offer a streaming (live) tab as "finished" — that
        // would let the user force-close and free the slot mid-run.
        if (tab.isStreaming) continue;
        seen.add(tab.id);
        result.push({ tabId: tab.id, title: tab.title });
      }
    }
    return result;
  }

  async closeTab(tabId: string): Promise<void> {
    for (const view of this.plugin.getAllViews()) {
      const manager = view.getTabManager();
      if (!manager?.getTab(tabId)) continue;
      // Force-close: a finished work-order tab is never streaming, and this frees
      // the work-order slot so AgentBoardView's chat:tabs-changed handler can tick
      // the next queued run.
      await manager.closeTab(tabId, true);
      void this.refresh();
      return;
    }
  }

  async openItem(id: string): Promise<void> {
    const item = this.summary.items.find((candidate) => candidate.id === id);
    if (!item) return;
    if (item.sidepanelTabId) {
      for (const view of this.plugin.getAllViews()) {
        const manager = view.getTabManager();
        if (!manager?.getTab(item.sidepanelTabId)) continue;
        // The dropdown renders in every chat view, so the owning tab can live in
        // a different workspace leaf/split. Reveal that leaf first — otherwise
        // selecting the row only flips the other manager's internal tab and the
        // user sees nothing (same reason the cross-view conversation path reveals
        // before switching).
        await revealWorkspaceLeaf(this.plugin.app.workspace, view.leaf);
        await manager.switchToTab(item.sidepanelTabId);
        return;
      }
    }
    const model = await this.indexModel();
    const task = model.tasks.find((candidate) => candidate.frontmatter.id === id || candidate.path === item.path);
    if (task) this.openDetailModal(task);
  }

  private get workOrderFolder(): string {
    const settings = asSettingsBag(this.plugin.settings);
    const folder = typeof settings.agentBoardWorkOrderFolder === 'string'
      ? settings.agentBoardWorkOrderFolder
      : 'Agent Board/tasks';
    return folder.replace(/^\/+|\/+$/g, '');
  }

  private isWorkOrderPath(path: string): boolean {
    return path.startsWith(`${this.workOrderFolder}/`);
  }

  private async indexModel(): Promise<TaskBoardModel> {
    if (this.deps.indexTasks) return this.deps.indexTasks();
    const vault = this.plugin.app.vault;
    if (typeof vault.getMarkdownFiles !== 'function' || typeof vault.read !== 'function') {
      return { tasks: [], invalidNotes: [] };
    }
    return this.indexer.indexVaultFolder(vault, this.workOrderFolder);
  }

  private openDetailModal(task: TaskSpec): void {
    if (this.deps.openDetailModal) {
      this.deps.openDetailModal(task);
      return;
    }
    new WorkOrderDetailModal(this.plugin.app, task, this.buildDetailModalCallbacks(task)).open();
  }

  // Public-ish (accessed via cast in tests) so the modal callback wiring —
  // including the persisting `onSaveFields` — can be unit-tested without
  // spinning up Obsidian's modal stack.
  private buildDetailModalCallbacks(_task: TaskSpec): WorkOrderDetailModalCallbacks {
    const settings = asSettingsBag(this.plugin.settings);
    return {
      onOpenNote: (target) => { void this.openNote(target); },
      ...buildWorkOrderConversationBindings(this.plugin),
      // Without this the activity dropdown's fallback modal would render
      // editable title/provider/model/priority controls whose edits silently
      // no-op'd through the optional callback, losing user input on close.
      onSaveFields: (target, fields) => this.saveTaskFields(target, fields),
      getProviderOptions: () => ProviderRegistry.getEnabledProviderIds(settings).map((id) => ({ value: id, label: id })),
      getModelOptions: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId)
          ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
          : [],
    };
  }

  private async saveTaskFields(task: TaskSpec, fields: WorkOrderFieldUpdate): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) return;
    // vault.process serializes concurrent transforms on the same note so
    // edits from this dropdown cannot clobber a parallel run-coordinator write.
    await this.plugin.app.vault.process(file, (content) => this.noteStore.writeFields(content, fields));
  }

  private async openNote(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) await this.plugin.app.workspace.getLeaf('tab').openFile(file);
  }
}