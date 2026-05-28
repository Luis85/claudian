import { type App, Modal, Setting } from 'obsidian';

import type { TaskSpec } from '../model/taskTypes';

export interface WorkOrderDetailModalCallbacks {
  onOpenNote(task: TaskSpec): void;
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
}

export class WorkOrderDetailModal extends Modal {
  constructor(
    app: App,
    private readonly task: TaskSpec,
    private readonly callbacks: WorkOrderDetailModalCallbacks,
  ) {
    super(app);
  }

  onOpen(): void {
    const { task } = this;
    this.setTitle(task.frontmatter.title);
    this.modalEl.addClass('claudian-work-order-modal');

    const meta = this.contentEl.createDiv({ cls: 'claudian-work-order-modal-meta' });
    meta.createSpan({ text: `Status: ${task.frontmatter.status}` });
    meta.createSpan({ text: `Provider: ${task.frontmatter.provider ?? '—'}` });
    meta.createSpan({ text: `Model: ${task.frontmatter.model ?? '—'}` });
    meta.createSpan({ text: `Priority: ${task.frontmatter.priority}` });

    this.renderSection('Objective', task.sections.objective);
    this.renderSection('Acceptance criteria', task.sections.acceptanceCriteria);
    this.renderSection('Run ledger', task.sections.ledger);
    this.renderSection('Handoff', task.sections.handoff);

    const actions = new Setting(this.contentEl);
    actions.addButton((btn) =>
      btn.setButtonText('Open note').onClick(() => {
        this.close();
        this.callbacks.onOpenNote(task);
      }),
    );
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
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderSection(label: string, body: string): void {
    this.contentEl.createEl('h4', { text: label });
    this.contentEl.createEl('pre', {
      cls: 'claudian-work-order-modal-section',
      text: body.length > 0 ? body : '—',
    });
  }
}
