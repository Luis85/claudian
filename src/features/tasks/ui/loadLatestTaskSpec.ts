import type { App } from 'obsidian';
import { Notice, TFile } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import type { TaskSpec } from '../model/taskTypes';
import type { TaskNoteStore } from '../storage/TaskNoteStore';

/**
 * Re-reads a work order from disk and parses its current frontmatter, so a board
 * action validates against the note's real state rather than a stale cached card.
 *
 * Surfaces the matching Notice and returns null when the file is gone or fails to
 * parse; callers refresh the board on null. `parseErrorKey` lets each caller keep
 * its own failure copy (e.g. update vs run).
 */
export async function loadLatestTaskSpec(
  app: App,
  noteStore: TaskNoteStore,
  path: string,
  parseErrorKey: TranslationKey,
): Promise<TaskSpec | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    new Notice(t('tasks.board.fileNotFound'));
    return null;
  }

  try {
    const content = await app.vault.read(file);
    return noteStore.parse(path, content).task;
  } catch (error) {
    new Notice(t(parseErrorKey, { error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}
