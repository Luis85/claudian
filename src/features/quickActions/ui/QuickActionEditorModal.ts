import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { LucideIconPicker } from '../../../shared/components/LucideIconPicker';
import type { QuickActionStorage } from '../QuickActionStorage';
import type { QuickAction } from '../types';

export class QuickActionEditorModal extends Modal {
  private existing: QuickAction | null;
  private onSave: (action: QuickAction) => Promise<void>;
  private storage: QuickActionStorage;
  private seed: { name?: string; prompt?: string } | null;
  private iconPicker: LucideIconPicker | null = null;

  constructor(
    app: App,
    existing: QuickAction | null,
    onSave: (action: QuickAction) => Promise<void>,
    storage: QuickActionStorage,
    seed?: { name?: string; prompt?: string },
  ) {
    super(app);
    this.existing = existing;
    this.onSave = onSave;
    this.storage = storage;
    this.seed = seed ?? null;
  }

  onOpen(): void {
    const isEdit = Boolean(this.existing);
    this.setTitle(isEdit
      ? t('quickActions.editor.titleEdit')
      : t('quickActions.editor.titleAdd'));
    this.modalEl.addClass('claudian-sp-modal');

    let name = this.existing?.name ?? this.seed?.name ?? '';
    let description = this.existing?.description ?? '';
    let icon = this.existing?.icon ?? '';
    let prompt = this.existing?.prompt ?? this.seed?.prompt ?? '';

    new Setting(this.contentEl)
      .setName(t('quickActions.editor.name'))
      .setDesc(t('quickActions.editor.nameDesc'))
      .addText((text) => {
        text.setValue(name).onChange((v) => { name = v; });
        if (isEdit) {
          text.setDisabled(true);
        }
      });

    new Setting(this.contentEl)
      .setName(t('quickActions.editor.description'))
      .addText((text) => {
        text.setValue(description).onChange((v) => { description = v; });
      });

    const iconSetting = new Setting(this.contentEl)
      .setName(t('quickActions.editor.icon'))
      .setDesc(t('quickActions.editor.iconDesc'));
    iconSetting.settingEl.addClass('claudian-icon-picker-setting');
    this.iconPicker = new LucideIconPicker(iconSetting.controlEl, {
      value: icon,
      onChange: (v) => { icon = v; },
    });

    new Setting(this.contentEl)
      .setName(t('quickActions.editor.prompt'))
      .setDesc(t('quickActions.editor.promptDesc'))
      .addTextArea((area) => {
        area.setValue(prompt).onChange((v) => { prompt = v; });
        area.inputEl.rows = 10;
        area.inputEl.addClass('claudian-quick-action-prompt-input');
      });

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText(t('common.save'))
          .setCta()
          .onClick(() => {
            void this.handleSave(name, description, icon, prompt);
          });
      })
      .addButton((btn) => {
        btn.setButtonText(t('common.cancel'))
          .onClick(() => this.close());
      });
  }

  onClose(): void {
    this.iconPicker?.destroy();
    this.iconPicker = null;
    this.contentEl.empty();
  }

  private async handleSave(
    name: string,
    description: string,
    icon: string,
    prompt: string,
  ): Promise<void> {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName) {
      new Notice(t('quickActions.editor.nameRequired'));
      return;
    }
    if (!trimmedPrompt) {
      new Notice(t('quickActions.editor.promptRequired'));
      return;
    }

    if (!this.existing) {
      const targetPath = this.storage.getFilePathForName(trimmedName);
      if (await this.storage.exists(targetPath)) {
        new Notice(t('quickActions.editor.nameExists'));
        return;
      }
    }

    const action: QuickAction = {
      id: this.existing?.id ?? trimmedName,
      name: trimmedName,
      description: description.trim() || trimmedName,
      icon: icon.trim() || undefined,
      tags: this.existing?.tags,
      prompt: trimmedPrompt,
      filePath: this.existing?.filePath ?? '',
      favorite: this.existing?.favorite,
      favoriteRank: this.existing?.favoriteRank,
    };

    try {
      await this.onSave(action);
      this.close();
    } catch {
      new Notice(t('quickActions.editor.saveFailed'));
    }
  }
}
