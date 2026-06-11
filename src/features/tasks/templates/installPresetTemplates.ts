import { normalizePath, Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { PRESET_TEMPLATES } from './presetTemplates';
import { TemplateNoteStore } from './TemplateNoteStore';

export interface InstallPresetTemplatesResult {
  installed: number;
  skipped: number;
  folder: string;
}

function normalizeFolder(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export async function installPresetTemplates(plugin: ClaudianPlugin): Promise<InstallPresetTemplatesResult> {
  // Settings-derived folder feeds vault.createFolder/getAbstractFileByPath below.
  const folder = normalizePath(normalizeFolder(plugin.settings.agentBoardTemplateFolder || 'Agent Board/templates'));
  const store = new TemplateNoteStore();
  const vault = plugin.app.vault;

  if (!vault.getAbstractFileByPath(folder)) {
    await vault.createFolder(folder);
  }

  let installed = 0;
  let skipped = 0;
  for (const preset of PRESET_TEMPLATES) {
    const path = store.getFilePathForName(folder, preset.name);
    if (vault.getAbstractFileByPath(path)) {
      skipped += 1;
      continue;
    }
    await vault.create(path, store.build(preset));
    installed += 1;
  }
  return { installed, skipped, folder };
}

/** Installs the preset templates and surfaces the installed/skipped summary as a Notice. */
export async function installPresetTemplatesWithNotice(plugin: ClaudianPlugin): Promise<void> {
  const result = await installPresetTemplates(plugin);
  const parts: string[] = [];
  if (result.installed > 0) parts.push(`installed ${result.installed}`);
  if (result.skipped > 0) parts.push(`skipped ${result.skipped} already present`);
  const summary = parts.join(', ');
  new Notice(summary
    ? t('settings.agentBoard.commonTemplates', { templates: summary })
    : t('settings.agentBoard.commonTemplatesEmpty'));
}
