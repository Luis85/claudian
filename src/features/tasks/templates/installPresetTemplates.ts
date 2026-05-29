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
  const folder = normalizeFolder(plugin.settings.agentBoardTemplateFolder || 'Agent Board/templates');
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
