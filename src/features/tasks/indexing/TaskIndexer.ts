import type { TFile, Vault } from 'obsidian';

import type { TaskBoardModel } from '../model/taskTypes';
import type { TaskNoteStore } from '../storage/TaskNoteStore';

export interface TaskFileContent {
  path: string;
  content: string;
}

export class TaskIndexer {
  constructor(private readonly noteStore: TaskNoteStore) {}

  indexContents(files: TaskFileContent[]): TaskBoardModel {
    const model: TaskBoardModel = { tasks: [], invalidNotes: [] };
    for (const file of files) {
      try {
        const { task } = this.noteStore.parse(file.path, file.content);
        model.tasks.push(task);
      } catch (error) {
        model.invalidNotes.push({
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return model;
  }

  async indexVaultFolder(vault: Vault, folder: string): Promise<TaskBoardModel> {
    const normalized = folder.replace(/^\/+|\/+$/g, '');
    const contents: TaskFileContent[] = [];
    for (const file of vault
      .getMarkdownFiles()
      .filter((candidate: TFile) => candidate.path.startsWith(`${normalized}/`))) {
      contents.push({ path: file.path, content: await vault.read(file) });
    }
    return this.indexContents(contents);
  }
}
