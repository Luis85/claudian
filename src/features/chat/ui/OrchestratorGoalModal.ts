import type { App } from 'obsidian';
import { Modal, Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';

export interface OrchestratorGoalModalOptions {
  isActive: boolean;
  onSubmit: (goal: string) => Promise<void>;
  onTurnOff?: () => Promise<void>;
}

export class OrchestratorGoalModal extends Modal {
  private options: OrchestratorGoalModalOptions;
  private goalTextarea: HTMLTextAreaElement | null = null;

  constructor(app: App, options: OrchestratorGoalModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.setTitle(t('chat.orchestrator.modal.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-orchestrator-goal-modal');

    if (this.options.isActive) {
      this.contentEl.createDiv({
        cls: 'claudian-orchestrator-goal-active-banner',
        text: t('chat.orchestrator.modal.activeBanner'),
      });
    }

    this.contentEl.createEl('p', {
      cls: 'claudian-orchestrator-goal-intro',
      text: t('chat.orchestrator.modal.intro'),
    });

    this.renderSection(
      t('chat.orchestrator.modal.sectionWhatTitle'),
      t('chat.orchestrator.modal.sectionWhatBody'),
    );
    this.renderSection(
      t('chat.orchestrator.modal.sectionGoalTitle'),
      t('chat.orchestrator.modal.sectionGoalBody'),
    );
    this.renderSection(
      t('chat.orchestrator.modal.sectionTipsTitle'),
      t('chat.orchestrator.modal.sectionTipsBody'),
    );
    this.renderSection(
      t('chat.orchestrator.modal.sectionNextTitle'),
      t('chat.orchestrator.modal.sectionNextBody'),
    );

    const goalField = this.contentEl.createDiv({ cls: 'claudian-orchestrator-goal-field' });
    goalField.createDiv({
      cls: 'claudian-orchestrator-goal-field-label',
      text: t('chat.orchestrator.modal.goalLabel'),
    });
    goalField.createDiv({
      cls: 'claudian-orchestrator-goal-field-desc',
      text: t('chat.orchestrator.modal.goalDesc'),
    });
    this.goalTextarea = goalField.createEl('textarea', {
      cls: 'claudian-orchestrator-goal-textarea',
      attr: {
        rows: '5',
        placeholder: t('chat.orchestrator.modal.goalPlaceholder'),
      },
    });

    const actions = this.contentEl.createDiv({ cls: 'claudian-orchestrator-goal-actions' });

    if (this.options.isActive && this.options.onTurnOff) {
      actions.createEl('button', {
        cls: 'mod-warning',
        text: t('chat.orchestrator.modal.turnOff'),
      }).addEventListener('click', () => {
        void this.options.onTurnOff?.().then(() => this.close());
      });
    }

    actions.createEl('button', {
      text: t('common.cancel'),
    }).addEventListener('click', () => this.close());

    actions.createEl('button', {
      cls: 'mod-cta',
      text: t('chat.orchestrator.modal.submit'),
    }).addEventListener('click', () => {
      void this.handleSubmit();
    });
  }

  private renderSection(title: string, body: string): void {
    const section = this.contentEl.createDiv({ cls: 'claudian-orchestrator-goal-section' });
    section.createEl('h4', { text: title });
    const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length <= 1) {
      section.createEl('p', { text: body });
      return;
    }
    const list = section.createEl('ul');
    for (const line of lines) {
      list.createEl('li', { text: line.replace(/^[-*]\s*/, '') });
    }
  }

  private async handleSubmit(): Promise<void> {
    const trimmed = this.goalTextarea?.value.trim() ?? '';
    if (!trimmed) {
      new Notice(t('chat.orchestrator.modal.goalRequired'));
      return;
    }
    this.close();
    try {
      await this.options.onSubmit(trimmed);
    } catch {
      new Notice(t('chat.orchestrator.modal.submitFailed'));
    }
  }

  onClose(): void {
    this.goalTextarea = null;
    this.contentEl.empty();
  }
}
