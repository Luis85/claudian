import { type App, TFile } from 'obsidian';

import { isEditTool, TOOL_APPLY_PATCH } from '../../../core/tools/toolNames';
import type { ToolCallInfo } from '../../../core/types';
import { getVaultPath, normalizePathForVault } from '../../../utils/path';

/**
 * Nudges Obsidian's vault after a Write/Edit/NotebookEdit so the file tree
 * refreshes. Direct `fs` writes bypass the Vault API, and macOS + iCloud
 * FSWatcher often misses the event.
 */
export function notifyVaultFileChange(app: App, input: Record<string, unknown>): void {
  const rawPathValue = input.file_path ?? input.notebook_path;
  const rawPath = typeof rawPathValue === 'string' ? rawPathValue : undefined;
  const vaultPath = getVaultPath(app);
  const relativePath = normalizePathForVault(rawPath, vaultPath);
  if (!relativePath || relativePath.startsWith('/')) return;

  window.setTimeout(() => {
    const { vault } = app;
    const file = vault.getAbstractFileByPath(relativePath);
    if (file instanceof TFile) {
      // Existing file — tell listeners the content changed
      vault.trigger('modify', file);
    } else {
      // New file — scan parent directory so Obsidian discovers it
      const parentDir = relativePath.includes('/')
        ? relativePath.substring(0, relativePath.lastIndexOf('/'))
        : '';
      vault.adapter.list(parentDir).catch(() => { /* ignore */ });
    }
  }, 200);
}

/** Collects file paths from a legacy apply_patch `changes` array. */
function collectApplyPatchChangePaths(changes: unknown): string[] {
  if (!Array.isArray(changes)) return [];
  const paths: string[] = [];
  for (const change of changes) {
    if (change && typeof change === 'object' && !Array.isArray(change)) {
      const path = (change as Record<string, unknown>).path;
      if (typeof path === 'string') paths.push(path);
    }
  }
  return paths;
}

/** Collects file paths from apply_patch patch-text markers (custom_tool_call format). */
function collectApplyPatchTextPaths(input: Record<string, unknown>): string[] {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  if (!patchText) return [];
  const paths: string[] = [];
  // `Move to` is included so a rename refreshes the destination's parent (the new
  // file), not just the removed source — matters on FSWatcher-miss environments.
  for (const match of patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) {
    const filePath = match[1]?.trim();
    if (filePath) paths.push(filePath);
  }
  return paths;
}

/** Refreshes vault for each file path in an apply_patch changes array or patch text. */
export function notifyApplyPatchFileChanges(app: App, input: Record<string, unknown>): void {
  const notified = new Set<string>();
  const paths = [
    ...collectApplyPatchChangePaths(input.changes),
    ...collectApplyPatchTextPaths(input),
  ];
  for (const path of paths) {
    if (notified.has(path)) continue;
    notified.add(path);
    notifyVaultFileChange(app, { file_path: path });
  }
}

/** Refreshes the Obsidian vault for a successful file-mutating tool result. */
export function notifyVaultForToolResult(app: App, toolCall: ToolCallInfo): void {
  // Notify Obsidian vault so the file tree refreshes after Write/Edit/NotebookEdit
  if (isEditTool(toolCall.name)) {
    notifyVaultFileChange(app, toolCall.input);
  }

  // Runtime apply_patch: refresh each changed file path
  if (toolCall.name === TOOL_APPLY_PATCH) {
    notifyApplyPatchFileChanges(app, toolCall.input);
  }
}
