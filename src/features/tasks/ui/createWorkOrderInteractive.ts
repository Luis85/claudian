import { Notice, type TFile, type TFolder } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import {
  buildSelectionSeed,
  createWorkOrder,
  createWorkOrderFromSeed,
  type CreateWorkOrderOptions,
} from '../commands/taskCommands';
import { chooseWorkOrderTemplate } from './WorkOrderTemplatePickerModal';

export async function createWorkOrderInteractive(
  plugin: ClaudianPlugin,
  source?: TFile | TFolder | null,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  const picked = await chooseWorkOrderTemplate(plugin);
  if (picked.cancelled) {
    return null;
  }
  return createWorkOrder(plugin, source ?? null, { ...options, template: picked.template });
}

export async function createWorkOrderFromCurrentNoteInteractive(plugin: ClaudianPlugin): Promise<TFile | null> {
  const active = plugin.app.workspace.getActiveFile();
  if (!active) {
    new Notice('Open a note to create a work order from it.');
    return null;
  }
  const picked = await chooseWorkOrderTemplate(plugin);
  if (picked.cancelled) {
    return null;
  }
  return createWorkOrder(plugin, active, { template: picked.template });
}

export async function createWorkOrderFromSelectionInteractive(plugin: ClaudianPlugin): Promise<TFile | null> {
  const editor = plugin.app.workspace.activeEditor?.editor;
  const selection = editor?.getSelection() ?? '';
  if (!selection.trim()) {
    new Notice('Select text in a note to create a work order from it.');
    return null;
  }
  const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? null;
  const seed = buildSelectionSeed({ selectionText: selection, sourcePath });
  const picked = await chooseWorkOrderTemplate(plugin);
  if (picked.cancelled) {
    return null;
  }
  return createWorkOrderFromSeed(plugin, seed, { template: picked.template });
}
