/**
 * VaultFileAdapter - Wrapper around Obsidian Vault API for file operations.
 *
 * Provides a consistent interface for file operations using Obsidian's
 * vault adapter instead of Node's fs module.
 */

import { type App,FileSystemAdapter } from 'obsidian';

export class VaultFileAdapter {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private app: App) {}

  /**
   * Absolute filesystem path for a vault-relative path, or null when the active
   * vault adapter does not back the vault with a real filesystem (mobile, in-mem
   * test harnesses). Callers use this to take a Node `fs` fast path for bulk I/O
   * while keeping the `vault.adapter` fallback intact.
   */
  getAbsolutePath(relativePath: string): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getFullPath(relativePath);
    }
    return null;
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.ensureParentFolder(path);
    await this.app.vault.adapter.write(path, content);
  }

  /**
   * Writes via a temp file + rename so a crash mid-write can't truncate the
   * target — either the old file or the fully-written new one survives. Used for
   * small JSON config files (roster agents, session metadata).
   */
  async writeAtomic(path: string, content: string): Promise<void> {
    const tmp = `${path}.tmp`;
    await this.write(tmp, content);
    try {
      await this.app.vault.adapter.rename(tmp, path);
    } catch {
      // Some adapters won't overwrite on rename; remove the target then retry.
      try {
        await this.delete(path);
        await this.app.vault.adapter.rename(tmp, path);
      } catch (err) {
        // The retry failed too — clean up the temp file so it can't accumulate
        // or be mistaken for the target, then surface the original failure.
        await this.delete(tmp);
        throw err;
      }
    }
  }

  async append(path: string, content: string): Promise<void> {
    await this.ensureParentFolder(path);
    this.writeQueue = this.writeQueue.then(async () => {
      if (await this.exists(path)) {
        const existing = await this.read(path);
        await this.app.vault.adapter.write(path, existing + content);
      } else {
        await this.app.vault.adapter.write(path, content);
      }
    }).catch(() => {
      // prevent queue from getting stuck
    });
    await this.writeQueue;
  }

  async delete(path: string): Promise<void> {
    if (await this.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  /** Fails silently if non-empty or missing. */
  async deleteFolder(path: string): Promise<void> {
    try {
      if (await this.exists(path)) {
        await this.app.vault.adapter.rmdir(path, false);
      }
    } catch {
      // Non-critical: directory may not be empty
    }
  }

  private async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
    if (!(await this.exists(folder))) {
      return { files: [], folders: [] };
    }
    return this.app.vault.adapter.list(folder);
  }

  async listFiles(folder: string): Promise<string[]> {
    return (await this.list(folder)).files;
  }

  /** List subfolders in a folder. Returns relative paths from the folder. */
  async listFolders(folder: string): Promise<string[]> {
    return (await this.list(folder)).folders;
  }

  /** Recursively list all files in a folder and subfolders. */
  async listFilesRecursive(folder: string): Promise<string[]> {
    const allFiles: string[] = [];

    const processFolder = async (currentFolder: string) => {
      if (!(await this.exists(currentFolder))) return;

      const listing = await this.app.vault.adapter.list(currentFolder);
      allFiles.push(...listing.files);

      for (const subfolder of listing.folders) {
        await processFolder(subfolder);
      }
    };

    await processFolder(folder);
    return allFiles;
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const folder = filePath.substring(0, filePath.lastIndexOf('/'));
    if (folder && !(await this.exists(folder))) {
      await this.ensureFolder(folder);
    }
  }

  /** Ensure a folder exists, creating it and parent folders if needed. */
  async ensureFolder(path: string): Promise<void> {
    if (await this.exists(path)) return;

    // Create parent folders recursively
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  /** Rename/move a file. */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.app.vault.adapter.rename(oldPath, newPath);
  }

  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    try {
      const stat = await this.app.vault.adapter.stat(path);
      if (!stat) return null;
      return { mtime: stat.mtime, size: stat.size };
    } catch {
      return null;
    }
  }
}
