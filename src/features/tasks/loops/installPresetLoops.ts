import { normalizePath, Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type SpecoratorPlugin from '../../../main';
import { LoopNoteStore } from './LoopNoteStore';
import { PRESET_LOOPS } from './presetLoops';

export interface InstallPresetLoopsResult {
  installed: number;
  skipped: number;
  folder: string;
}

function normalizeFolder(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export async function installPresetLoops(plugin: SpecoratorPlugin): Promise<InstallPresetLoopsResult> {
  // Settings-derived folder feeds vault.createFolder/getAbstractFileByPath below.
  const folder = normalizePath(normalizeFolder(plugin.settings.agentBoardLoopFolder || 'Agent Board/loops'));
  const store = new LoopNoteStore();
  const vault = plugin.app.vault;

  if (!vault.getAbstractFileByPath(folder)) {
    await vault.createFolder(folder);
  }

  let installed = 0;
  let skipped = 0;
  for (const preset of PRESET_LOOPS) {
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

/** Installs the preset loops and surfaces the installed/skipped summary as a Notice. */
export async function installPresetLoopsWithNotice(plugin: SpecoratorPlugin): Promise<void> {
  const result = await installPresetLoops(plugin);
  const parts: string[] = [];
  if (result.installed > 0) parts.push(`installed ${result.installed}`);
  if (result.skipped > 0) parts.push(`skipped ${result.skipped} already present`);
  const summary = parts.join(', ');
  new Notice(summary
    ? t('settings.agentBoard.commonLoops', { loops: summary })
    : t('settings.agentBoard.commonLoopsEmpty'));
}
