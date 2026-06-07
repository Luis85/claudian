import { TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { asSettingsBag } from '../../../core/types/settings';
import type {
  WorkOrderActivityProvider as WorkOrderActivityProviderContract,
  WorkOrderActivitySummary,
} from '../../../core/types/workOrderActivity';
import { EMPTY_WORK_ORDER_ACTIVITY_SUMMARY } from '../../../core/types/workOrderActivity';
import type ClaudianPlugin from '../../../main';
import { TaskIndexer } from '../indexing/TaskIndexer';
import type { TaskBoardModel, TaskSpec } from '../model/taskTypes';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { buildWorkOrderActivitySummary } from './workOrderActivitySummary';
import { buildWorkOrderConversationBindings } from './workOrderConversationBindings';
import { WorkOrderDetailModal } from './WorkOrderDetailModal';

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
    void this.refresh();
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.listeners.clear();
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
    const model = await this.indexModel();
    this.summary = buildWorkOrderActivitySummary(model.tasks);
    for (const listener of [...this.listeners]) listener(this.summary);
  }

  async openItem(id: string): Promise<void> {
    const item = this.summary.items.find((candidate) => candidate.id === id);
    if (!item) return;
    if (item.sidepanelTabId) {
      for (const view of this.plugin.getAllViews()) {
        const manager = view.getTabManager();
        if (!manager?.getTab(item.sidepanelTabId)) continue;
        await manager.switchToTab(item.sidepanelTabId);
        return;
      }
    }
    const model = await this.indexModel();
    const task = model.tasks.find((candidate) => candidate.frontmatter.id === id || candidate.path === item.path);
    if (task) this.openDetailModal(task);
  }

  private async indexModel(): Promise<TaskBoardModel> {
    if (this.deps.indexTasks) return this.deps.indexTasks();
    const settings = asSettingsBag(this.plugin.settings);
    const folder = typeof settings.agentBoardWorkOrderFolder === 'string'
      ? settings.agentBoardWorkOrderFolder
      : 'Agent Board/tasks';
    const vault = this.plugin.app.vault;
    if (typeof vault.getMarkdownFiles !== 'function' || typeof vault.read !== 'function') {
      return { tasks: [], invalidNotes: [] };
    }
    return this.indexer.indexVaultFolder(vault, folder);
  }

  private openDetailModal(task: TaskSpec): void {
    if (this.deps.openDetailModal) {
      this.deps.openDetailModal(task);
      return;
    }
    const settings = asSettingsBag(this.plugin.settings);
    new WorkOrderDetailModal(this.plugin.app, task, {
      onOpenNote: (target) => { void this.openNote(target); },
      ...buildWorkOrderConversationBindings(this.plugin),
      getProviderOptions: () => ProviderRegistry.getEnabledProviderIds(settings).map((id) => ({ value: id, label: id })),
      getModelOptions: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId)
          ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
          : [],
    }).open();
  }

  private async openNote(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) await this.plugin.app.workspace.getLeaf('tab').openFile(file);
  }
}