import type { TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import { VIEW_TYPE_CLAUDIAN_AGENT_BOARD } from '../../../core/types/chat';
import type ClaudianPlugin from '../../../main';
import type { TaskExecutionSurface } from '../execution/TaskExecutionSurface';
import { TaskRunCoordinator } from '../execution/TaskRunCoordinator';
import { TaskIndexer } from '../indexing/TaskIndexer';
import type { TaskBoardModel, TaskSpec } from '../model/taskTypes';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { AgentBoardRenderer } from './AgentBoardRenderer';

export class AgentBoardView extends ItemView {
  private readonly noteStore = new TaskNoteStore();
  private readonly indexer = new TaskIndexer(this.noteStore);
  private readonly renderer = new AgentBoardRenderer();
  private model: TaskBoardModel = { tasks: [], invalidNotes: [] };
  private selectedPath: string | null = null;
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
    await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async refresh(): Promise<void> {
    this.model = await this.indexer.indexVaultFolder(this.plugin.app.vault, this.folder);
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

  private render(): void {
    this.renderer.render(
      this.contentEl,
      { model: this.model, selectedPath: this.selectedPath },
      {
        onOpen: (task) => void this.openTask(task),
        onRun: (task) => void this.runTask(task),
        onStop: (task) => this.stopTask(task),
        onSelect: (task) => {
          this.selectedPath = task.path;
          this.render();
        },
      },
    );
  }

  private async openTask(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) {
      await this.plugin.app.workspace.getLeaf('tab').openFile(file);
    }
  }

  private stopTask(task: TaskSpec): void {
    this.executionSurface.cancelTaskRun?.(task.frontmatter.run_id ?? '');
    new Notice(`Requested stop for "${task.frontmatter.title}".`);
  }

  private async runTask(task: TaskSpec): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      new Notice('Work order file was not found.');
      await this.refresh();
      return;
    }

    let latest: TaskSpec;
    try {
      const content = await this.plugin.app.vault.read(file);
      latest = this.noteStore.parse(task.path, content).task;
    } catch (error) {
      new Notice(`Cannot run work order: ${error instanceof Error ? error.message : String(error)}`);
      await this.refresh();
      return;
    }

    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const coordinator = new TaskRunCoordinator({
      executionSurface: this.executionSurface,
      now: () => new Date().toISOString(),
      isProviderEnabled: (providerId) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
        ProviderRegistry.isEnabled(providerId as ProviderId, settings),
      ownsModel: (providerId, model) =>
        ProviderRegistry.getRegisteredProviderIds().includes(providerId as ProviderId) &&
        ProviderRegistry.getChatUIConfig(providerId as ProviderId).ownsModel(model, settings),
      writeTaskStatus: (_task, options) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.writeStatus(content, options)),
      appendLedger: (_task, entry) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.appendLedger(content, entry)),
      writeHandoff: (_task, markdown) =>
        this.applyNoteChange(task.path, (content) => this.noteStore.writeHandoff(content, markdown)),
    });

    const result = await coordinator.run(latest);
    if (!result.ok) {
      new Notice(`Work order run failed: ${result.error}`);
    }
    await this.refresh();
  }

  private async applyNoteChange(path: string, transform: (content: string) => string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const content = await this.plugin.app.vault.read(file);
    await this.plugin.app.vault.modify(file, transform(content));
  }
}
