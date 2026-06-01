import { debounce } from 'obsidian';

import { GitService } from '@/features/chat/services/GitService';
import { GitStatusWatcher } from '@/features/chat/services/GitStatusWatcher';
import type ClaudianPlugin from '@/main';
import { getEnhancedPath } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

export class PluginLifecycle {
  constructor(private readonly plugin: ClaudianPlugin) {}

  installGitWatcher(): void {
    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) return;

    this.plugin.gitStatusWatcher = new GitStatusWatcher(
      new GitService(vaultPath, getEnhancedPath()),
    );
    const refreshGit = debounce(
      () => void this.plugin.gitStatusWatcher?.refresh(),
      1500,
      true,
    );
    this.plugin.registerEvent(this.plugin.app.vault.on('modify', () => refreshGit()));
    this.plugin.registerEvent(this.plugin.app.vault.on('create', () => refreshGit()));
    this.plugin.registerEvent(this.plugin.app.vault.on('delete', () => refreshGit()));
    this.plugin.registerEvent(this.plugin.app.vault.on('rename', () => refreshGit()));
  }

  shutdownActiveRuntimes(): void {
    for (const view of this.plugin.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;
      for (const tab of tabManager.getAllTabs()) {
        try {
          void tab.service?.cleanup();
        } catch {
          // best-effort: keep tearing down remaining runtimes
        }
      }
    }
  }

  async persistOpenTabStates(): Promise<void> {
    await Promise.all(
      this.plugin.getAllViews().map((view) => {
        const tabManager = view.getTabManager();
        if (!tabManager) return Promise.resolve();
        return this.plugin.persistTabManagerState(tabManager.getPersistedState());
      }),
    );
  }
}
