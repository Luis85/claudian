import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { LucideIconPicker } from '../../../shared/components/LucideIconPicker';
import { addIconPickerRow, addNameAndDescriptionRows } from '../../../shared/settings/nameDescriptionRows';
import type { LoopDefinition, SaveLoopInput } from '../loops/loopTypes';

export interface LoopEditorPayload extends SaveLoopInput {
  originalPath?: string;
}

export class LoopEditorModal extends Modal {
  private iconPicker: LucideIconPicker | null = null;

  constructor(
    app: App,
    private readonly existing: LoopDefinition | null,
    private readonly onSave: (payload: LoopEditorPayload) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const isEdit = Boolean(this.existing);
    this.setTitle(isEdit ? t('tasks.loopEditor.titleEdit') : t('tasks.loopEditor.titleNew'));
    this.modalEl.addClass('specorator-sp-modal', 'specorator-loop-editor-modal');

    let name = this.existing?.name ?? '';
    let description = this.existing?.description ?? '';
    let icon = this.existing?.icon ?? '';
    let useWhen = this.existing?.useWhen ?? '';
    let approach = this.existing?.approach ?? '';
    let steps = this.existing?.steps ?? '';
    let verify = this.existing?.verify ?? '';
    let notes = this.existing?.notes ?? '';

    addNameAndDescriptionRows(this.contentEl, {
      name: {
        name: t('tasks.loopEditor.nameName'),
        desc: t('tasks.loopEditor.nameDesc'),
        value: name,
        onChange: (v) => { name = v; },
        disabled: isEdit,
      },
      description: {
        name: t('tasks.loopEditor.descriptionName'),
        desc: t('tasks.loopEditor.descriptionDesc'),
        value: description,
        onChange: (v) => { description = v; },
      },
    });

    this.iconPicker = addIconPickerRow(this.contentEl, {
      name: t('tasks.loopEditor.iconName'),
      desc: t('tasks.loopEditor.iconDesc'),
      value: icon,
      onChange: (v) => { icon = v; },
    });

    // t() requires literal TranslationKey values, so pass resolved strings rather
    // than a dynamic key to keep the helper signature typed without suppression.
    const area = (label: string, desc: string, value: string, set: (v: string) => void): void => {
      const setting = new Setting(this.contentEl)
        .setName(label)
        .setDesc(desc)
        .addTextArea((ta) => {
          ta.setValue(value).onChange(set);
          ta.inputEl.rows = 4;
          ta.inputEl.addClass('specorator-loop-section-input');
        });
      setting.settingEl.addClass('specorator-loop-section-setting');
    };

    area(t('tasks.loopEditor.useWhenName'), t('tasks.loopEditor.useWhenDesc'), useWhen, (v) => { useWhen = v; });
    area(t('tasks.loopEditor.approachName'), t('tasks.loopEditor.approachDesc'), approach, (v) => { approach = v; });
    area(t('tasks.loopEditor.stepsName'), t('tasks.loopEditor.stepsDesc'), steps, (v) => { steps = v; });
    area(t('tasks.loopEditor.verifyName'), t('tasks.loopEditor.verifyDesc'), verify, (v) => { verify = v; });
    area(t('tasks.loopEditor.notesName'), t('tasks.loopEditor.notesDesc'), notes, (v) => { notes = v; });

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText(t('tasks.loopEditor.save'))
          .setCta()
          .onClick(() => {
            void this.handleSave({ name, description, icon, useWhen, approach, steps, verify, notes });
          });
      })
      .addButton((btn) => {
        btn.setButtonText(t('tasks.loopEditor.cancel')).onClick(() => this.close());
      });
  }

  onClose(): void {
    this.iconPicker?.destroy();
    this.iconPicker = null;
    this.contentEl.empty();
  }

  private async handleSave(form: SaveLoopInput): Promise<void> {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      new Notice(t('tasks.loop.nameRequired'));
      return;
    }
    // Require at least one of approach or steps to have content — the loop is
    // useless to an agent if neither section describes what to do.
    if (!form.approach.trim() && !form.steps.trim()) {
      new Notice(t('tasks.loop.bodyRequired'));
      return;
    }

    const payload: LoopEditorPayload = {
      name: trimmedName,
      description: (form.description ?? '').trim() || undefined,
      icon: (form.icon ?? '').trim() || undefined,
      useWhen: form.useWhen.trim(),
      approach: form.approach.trim(),
      steps: form.steps.trim(),
      verify: form.verify.trim(),
      notes: form.notes.trim(),
      originalPath: this.existing?.path,
    };

    try {
      await this.onSave(payload);
      this.close();
    } catch (error) {
      new Notice(t('tasks.loop.saveFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
