import type { App } from 'obsidian';
import { Modal, Notice, setIcon, TFile, TFolder } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { TaskIndexer } from '../indexing/TaskIndexer';
import type { TaskSpec, TaskStatus } from '../model/taskTypes';
import { TaskNoteStore } from '../storage/TaskNoteStore';
import { createWorkOrderInteractive } from './createWorkOrderInteractive';

const WORK_ORDER_ICON = 'kanban-square';

// "New or ready" in the user's terms: a work order that has not started running
// yet (`inbox`) or is queued to run (`ready`). Running / terminal work orders are
// excluded — their context is already locked in for the active run.
const ADDABLE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['inbox', 'ready']);

/** New (`inbox`) or `ready` work orders the quick-add flow targets, most recently updated first. */
export function filterAddableWorkOrders(tasks: TaskSpec[]): TaskSpec[] {
  return tasks
    .filter((task) => ADDABLE_STATUSES.has(task.frontmatter.status))
    .sort((a, b) => (b.frontmatter.updated ?? '').localeCompare(a.frontmatter.updated ?? ''));
}

/** Build the `## Context` reference for a file (wikilink) or folder (code-spanned path). */
export function buildContextReference(args: { path: string; isFolder: boolean }): string {
  if (args.isFolder) return `\`${args.path}\``;
  return `[[${args.path.replace(/\.md$/i, '')}]]`;
}

function humanizeStatus(status: TaskStatus): string {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`.replace(/_/g, ' ');
}

/**
 * Picker that adds a file or folder to an existing new/ready work order's
 * `## Context` section. Opened from the file-explorer right-click menu.
 */
export class AddToWorkOrderModal extends Modal {
  private readonly store = new TaskNoteStore();
  private readonly indexer = new TaskIndexer(this.store);
  private listEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly plugin: ClaudianPlugin,
    private readonly target: TFile | TFolder,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('tasks.addToWorkOrder.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-wo-templates-modal');

    const body = this.contentEl.createDiv({ cls: 'claudian-wo-templates-body' });
    body
      .createDiv({ cls: 'claudian-wo-templates-intro' })
      .createEl('p', { text: t('tasks.addToWorkOrder.lead') });
    this.listEl = body.createDiv({ cls: 'claudian-wo-templates-list' });

    const footer = this.contentEl.createDiv({ cls: 'claudian-wo-templates-footer' });
    footer
      .createEl('button', { cls: 'mod-cta', text: t('tasks.addToWorkOrder.newWorkOrder') })
      .addEventListener('click', () => {
        this.close();
        void createWorkOrderInteractive(this.plugin, this.target);
      });

    void this.refreshList();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl) return;
    this.listEl.empty();
    const folder = this.plugin.settings.agentBoardWorkOrderFolder || 'Agent Board/tasks';
    const model = await this.indexer.indexVaultFolder(this.plugin.app.vault, folder);
    const tasks = filterAddableWorkOrders(model.tasks);
    if (tasks.length === 0) {
      this.listEl.createEl('p', {
        cls: 'claudian-wo-templates-intro-lead',
        text: t('tasks.addToWorkOrder.empty'),
      });
      return;
    }
    for (const task of tasks) {
      this.renderRow(task);
    }
  }

  private renderRow(task: TaskSpec): void {
    if (!this.listEl) return;
    const row = this.listEl.createDiv({ cls: 'claudian-wo-templates-row' });
    const main = row.createDiv({ cls: 'claudian-wo-templates-main' });

    setIcon(main.createSpan({ cls: 'claudian-wo-templates-icon' }), WORK_ORDER_ICON);

    const textCol = main.createDiv({ cls: 'claudian-wo-templates-text' });
    textCol.createEl('strong', { text: task.frontmatter.title });
    textCol.createDiv({
      cls: 'claudian-wo-templates-desc',
      text: humanizeStatus(task.frontmatter.status),
    });

    main.addEventListener('click', () => {
      void this.addToTask(task);
    });
  }

  private async addToTask(task: TaskSpec): Promise<void> {
    const name = this.target instanceof TFolder ? this.target.name : this.target.basename;
    const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      new Notice(t('tasks.board.fileNotFound'));
      this.close();
      return;
    }
    try {
      const content = await this.plugin.app.vault.read(file);
      const reference = buildContextReference({
        path: this.target.path,
        isFolder: this.target instanceof TFolder,
      });
      const result = this.store.appendContext(content, reference);
      if (result.changed) {
        await this.plugin.app.vault.modify(file, result.content);
        new Notice(t('tasks.addToWorkOrder.added', { name, title: task.frontmatter.title }));
      } else {
        new Notice(t('tasks.addToWorkOrder.already', { name, title: task.frontmatter.title }));
      }
    } catch (error) {
      new Notice(
        t('tasks.addToWorkOrder.failed', { error: error instanceof Error ? error.message : String(error) }),
      );
    }
    this.close();
  }
}

export function addToWorkOrderInteractive(plugin: ClaudianPlugin, target: TFile | TFolder): void {
  new AddToWorkOrderModal(plugin.app, plugin, target).open();
}
