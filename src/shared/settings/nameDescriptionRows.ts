import { Setting } from 'obsidian';

import { LucideIconPicker } from '../components/LucideIconPicker';

export interface EditorTextRowConfig {
  /** Setting label. */
  name: string;
  /** Optional sub-label rendered under the name. */
  desc?: string;
  /** Initial input value. */
  value: string;
  /** Receives every input change. */
  onChange: (value: string) => void;
  /** When true, the text input is rendered read-only (e.g. name frozen on Edit). */
  disabled?: boolean;
}

/** Builds a single name/description-style text-input `Setting` row. */
export function addEditorTextRow(contentEl: HTMLElement, config: EditorTextRowConfig): Setting {
  const setting = new Setting(contentEl).setName(config.name);
  if (config.desc !== undefined) {
    setting.setDesc(config.desc);
  }
  setting.addText((text) => {
    text.setValue(config.value).onChange(config.onChange);
    if (config.disabled) {
      text.setDisabled(true);
    }
  });
  return setting;
}

/**
 * Builds the two leading text rows shared by the editor modals: a name row
 * (frozen on Edit so the filename stays stable) followed by a description row.
 * Rows append to `contentEl` in name-then-description order.
 */
export function addNameAndDescriptionRows(
  contentEl: HTMLElement,
  rows: { name: EditorTextRowConfig; description: EditorTextRowConfig },
): void {
  addEditorTextRow(contentEl, rows.name);
  addEditorTextRow(contentEl, rows.description);
}

export interface EditorIconRowConfig {
  /** Setting label. */
  name: string;
  /** Setting sub-label. */
  desc: string;
  /** Initial icon id. */
  value: string;
  /** Receives the selected icon id. */
  onChange: (iconId: string) => void;
}

/**
 * Builds the shared icon-picker `Setting` row used by the editor modals and
 * returns the mounted picker so the caller can destroy it on close. Appends a
 * single `Setting` to `contentEl` tagged with `claudian-icon-picker-setting`.
 */
export function addIconPickerRow(contentEl: HTMLElement, config: EditorIconRowConfig): LucideIconPicker {
  const iconSetting = new Setting(contentEl)
    .setName(config.name)
    .setDesc(config.desc);
  iconSetting.settingEl.addClass('claudian-icon-picker-setting');
  return new LucideIconPicker(iconSetting.controlEl, {
    value: config.value,
    onChange: config.onChange,
  });
}
