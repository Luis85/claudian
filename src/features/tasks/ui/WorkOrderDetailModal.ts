import { type App, Component, type DropdownComponent, MarkdownRenderer, Modal, Setting } from 'obsidian';

import { parseAcceptanceProgress } from '../model/acceptanceProgress';
import type { TaskPriority, TaskSpec } from '../model/taskTypes';

export interface WorkOrderFieldUpdate {
  title?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
}

export interface WorkOrderOption {
  value: string;
  label: string;
}

export interface WorkOrderDetailModalCallbacks {
  onOpenNote(task: TaskSpec): void;
  onOpenConversation?(task: TaskSpec): void;
  /** Whether the linked conversation still exists and can be opened. Hides the button when false. */
  canOpenConversation?(task: TaskSpec): boolean;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onReopen(task: TaskSpec): void;
  /** needs_handoff → review: salvage a run that finished without a structured handoff. */
  onSendToReview?(task: TaskSpec): void;
  /** needs_handoff → failed: give up on a run that finished without a structured handoff. */
  onMarkFailed?(task: TaskSpec): void;
  onArchive(task: TaskSpec): void;
  onSaveFields(task: TaskSpec, fields: WorkOrderFieldUpdate): void | Promise<void>;
  getProviderOptions(): WorkOrderOption[];
  getModelOptions(providerId: string): WorkOrderOption[];
}

const PRIORITY_OPTIONS: TaskPriority[] = ['0 - urgent', '1 - high', '2 - normal', '3 - low'];

export class WorkOrderDetailModal extends Modal {
  private readonly markdownComponent = new Component();

  constructor(
    app: App,
    private readonly task: TaskSpec,
    private readonly callbacks: WorkOrderDetailModalCallbacks,
  ) {
    super(app);
  }

  onOpen(): void {
    const { task } = this;
    this.markdownComponent.load();
    this.setTitle(task.frontmatter.title);
    this.modalEl.addClass('claudian-work-order-modal');

    if (task.frontmatter.status === 'running') {
      this.renderReadOnlyMeta();
    } else {
      this.renderEditors();
    }

    this.renderMarkdownBlock('Objective', task.sections.objective || '—');
    const acProgress = parseAcceptanceProgress(task.sections.acceptanceCriteria);
    const acLabel = acProgress.total > 0
      ? `Acceptance criteria (${acProgress.done}/${acProgress.total})`
      : 'Acceptance criteria';
    this.renderMarkdownBlock(acLabel, task.sections.acceptanceCriteria || '—', 'acceptance');

    if (
      (task.frontmatter.status === 'review' || task.frontmatter.status === 'needs_fix') &&
      task.sections.handoff.length > 0
    ) {
      this.renderMarkdownBlock('Handoff', task.sections.handoff);
    }

    if (task.frontmatter.status === 'failed' && task.sections.ledger.length > 0) {
      this.renderMarkdownBlock('Run ledger', task.sections.ledger);
    }

    this.renderActions();
  }

  onClose(): void {
    this.markdownComponent.unload();
    this.contentEl.empty();
  }

  private renderMarkdownBlock(label: string, markdown: string, variant?: 'acceptance'): void {
    this.contentEl.createEl('h4', { text: label, cls: 'claudian-work-order-modal-heading' });
    const classes = ['claudian-work-order-modal-handoff'];
    if (variant === 'acceptance') classes.push('claudian-work-order-modal-acceptance');
    const el = this.contentEl.createDiv({ cls: classes.join(' ') });
    void MarkdownRenderer.render(this.app, markdown, el, this.task.path, this.markdownComponent);
  }

  private renderReadOnlyMeta(): void {
    const { task } = this;
    const meta = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-meta' });
    meta.createSpan({ text: `Status: ${task.frontmatter.status}` });
    meta.createSpan({ text: `Provider: ${task.frontmatter.provider ?? '—'}` });
    meta.createSpan({ text: `Model: ${task.frontmatter.model ?? '—'}` });
    meta.createSpan({ text: `Priority: ${task.frontmatter.priority}` });
  }

  private renderEditors(): void {
    const { task } = this;

    this.contentEl
      .createDiv({ cls: 'claudian-work-order-modal-meta' })
      .createSpan({ text: `Status: ${task.frontmatter.status}` });

    new Setting(this.contentEl).setName('Title').addText((text) => {
      text.setValue(task.frontmatter.title);
      text.inputEl.addEventListener('blur', () => {
        const value = text.getValue().trim();
        if (value.length > 0 && value !== task.frontmatter.title) {
          void this.callbacks.onSaveFields(task, { title: value });
        }
      });
    });

    let modelDropdown: DropdownComponent | null = null;
    const populateModels = (providerId: string, resetSelection = false): void => {
      if (!modelDropdown) return;
      modelDropdown.selectEl.empty();
      modelDropdown.addOption('', 'Provider default');
      for (const option of this.callbacks.getModelOptions(providerId)) {
        modelDropdown.addOption(option.value, option.label);
      }
      modelDropdown.setValue(resetSelection ? '' : (task.frontmatter.model ?? ''));
    };

    new Setting(this.contentEl).setName('Provider').addDropdown((dropdown) => {
      for (const option of this.callbacks.getProviderOptions()) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(task.frontmatter.provider ?? '');
      dropdown.onChange((value) => {
        void this.callbacks.onSaveFields(task, { provider: value, model: '' });
        populateModels(value, true);
      });
    });

    new Setting(this.contentEl).setName('Model').addDropdown((dropdown) => {
      modelDropdown = dropdown;
      populateModels(task.frontmatter.provider ?? '');
      dropdown.onChange((value) => {
        void this.callbacks.onSaveFields(task, { model: value });
      });
    });

    new Setting(this.contentEl).setName('Priority').addDropdown((dropdown) => {
      for (const priority of PRIORITY_OPTIONS) {
        dropdown.addOption(priority, priority);
      }
      dropdown.setValue(task.frontmatter.priority);
      dropdown.onChange((value) => {
        void this.callbacks.onSaveFields(task, { priority: value as TaskPriority });
      });
    });
  }

  private renderActions(): void {
    const { task } = this;
    const actions = new Setting(this.contentEl);

    const editLabel = task.frontmatter.status === 'review' ? 'Open note' : 'Edit';
    actions.addButton((btn) =>
      btn.setButtonText(editLabel).onClick(() => {
        this.close();
        this.callbacks.onOpenNote(task);
      }),
    );

    if (
      task.frontmatter.conversation_id &&
      this.callbacks.onOpenConversation &&
      (this.callbacks.canOpenConversation?.(task) ?? true)
    ) {
      actions.addButton((btn) =>
        btn.setButtonText('Open conversation').onClick(() => {
          this.close();
          this.callbacks.onOpenConversation?.(task);
        }),
      );
    }

    if (task.frontmatter.status === 'inbox') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Mark ready')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onMarkReady(task);
          }),
      );
    }

    if (task.frontmatter.status === 'ready' || task.frontmatter.status === 'needs_fix') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Run')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onRun(task);
          }),
      );
    }

    if (task.frontmatter.status === 'running') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Stop')
          .setWarning()
          .onClick(() => {
            this.close();
            this.callbacks.onStop(task);
          }),
      );
    }

    if (task.frontmatter.status === 'review') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Accept')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onAccept(task);
          }),
      );
      actions.addButton((btn) =>
        btn.setButtonText('Rework').onClick(() => {
          this.close();
          this.callbacks.onRework(task);
        }),
      );
    }

    if (task.frontmatter.status === 'done') {
      actions.addButton((btn) =>
        btn.setButtonText('Reopen').onClick(() => {
          this.close();
          this.callbacks.onReopen(task);
        }),
      );
    }

    if (task.frontmatter.status === 'needs_handoff') {
      actions.addButton((btn) =>
        btn
          .setButtonText('Review')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onSendToReview?.(task);
          }),
      );
      actions.addButton((btn) =>
        btn
          .setButtonText('Mark failed')
          .setWarning()
          .onClick(() => {
            this.close();
            this.callbacks.onMarkFailed?.(task);
          }),
      );
    }

    if (
      task.frontmatter.status === 'done' ||
      task.frontmatter.status === 'failed' ||
      task.frontmatter.status === 'canceled'
    ) {
      actions.addButton((btn) =>
        btn
          .setButtonText('Archive')
          .onClick(() => {
            this.close();
            this.callbacks.onArchive(task);
          }),
      );
    }
  }
}
