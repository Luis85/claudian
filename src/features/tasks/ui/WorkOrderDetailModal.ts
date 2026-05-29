import { type App, type DropdownComponent, Modal, Setting } from 'obsidian';

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
  onRun(task: TaskSpec): void;
  onStop(task: TaskSpec): void;
  onAccept(task: TaskSpec): void;
  onRework(task: TaskSpec): void;
  onMarkReady(task: TaskSpec): void;
  onSaveFields(task: TaskSpec, fields: WorkOrderFieldUpdate): void | Promise<void>;
  getProviderOptions(): WorkOrderOption[];
  getModelOptions(providerId: string): WorkOrderOption[];
}

const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

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

    if (task.frontmatter.status === 'running') {
      this.renderReadOnlyMeta();
    } else {
      this.renderEditors();
    }

    this.renderSection('Objective', task.sections.objective);
    this.renderSection('Acceptance criteria', task.sections.acceptanceCriteria);
    this.renderSection('Run ledger', task.sections.ledger);
    this.renderSection('Handoff', task.sections.handoff);

    this.renderActions();
  }

  onClose(): void {
    this.contentEl.empty();
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
    const populateModels = (providerId: string): void => {
      if (!modelDropdown) return;
      modelDropdown.selectEl.empty();
      modelDropdown.addOption('', 'Provider default');
      for (const option of this.callbacks.getModelOptions(providerId)) {
        modelDropdown.addOption(option.value, option.label);
      }
      modelDropdown.setValue(task.frontmatter.model ?? '');
    };

    new Setting(this.contentEl).setName('Provider').addDropdown((dropdown) => {
      for (const option of this.callbacks.getProviderOptions()) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(task.frontmatter.provider ?? '');
      dropdown.onChange((value) => {
        void this.callbacks.onSaveFields(task, { provider: value, model: '' });
        populateModels(value);
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

    actions.addButton((btn) =>
      btn.setButtonText('Open note').onClick(() => {
        this.close();
        this.callbacks.onOpenNote(task);
      }),
    );

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
  }

  private renderSection(label: string, body: string): void {
    this.contentEl.createEl('h4', { text: label });
    this.contentEl.createEl('pre', {
      cls: 'claudian-work-order-modal-section',
      text: body.length > 0 ? body : '—',
    });
  }
}
