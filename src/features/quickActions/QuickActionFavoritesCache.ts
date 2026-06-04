import type { App, EventRef, TAbstractFile } from 'obsidian';

import type { QuickActionStorage } from './QuickActionStorage';
import type { QuickAction } from './types';

const MAX_FAVORITES = 5;

/**
 * Synchronous read-only view of the favorite quick actions. The
 * Obsidian `file-menu` callback runs synchronously, so it needs a
 * non-async way to read the current favorites. This cache subscribes
 * to vault events scoped to `quickActionsFolder` and refreshes its
 * internal list on each relevant event.
 */
export class QuickActionFavoritesCache {
  private favorites: QuickAction[] = [];
  private refs: EventRef[] = [];
  private currentFolder = '';
  private reloadGeneration = 0;

  constructor(
    private storage: QuickActionStorage,
    private app: App,
    private getFolderPath: () => string,
  ) {}

  start(): void {
    this.currentFolder = this.normalizedFolder();
    this.subscribe();
    void this.reload();
  }

  /** Returns the favorites sorted by rank ascending, capped at five. */
  getFavorites(): QuickAction[] {
    return this.favorites;
  }

  /** Re-reads the folder setting and re-subscribes if it changed; reloads either way. */
  refresh(): void {
    const next = this.normalizedFolder();
    if (next !== this.currentFolder) {
      this.unsubscribe();
      this.currentFolder = next;
      this.subscribe();
    }
    void this.reload();
  }

  dispose(): void {
    // Bump generation so any in-flight reload that resolves after dispose
    // is discarded instead of repopulating `favorites`.
    ++this.reloadGeneration;
    this.unsubscribe();
    this.favorites = [];
  }

  private subscribe(): void {
    const handler = (file: TAbstractFile, _oldPath?: string) => {
      const path = (file as { path?: string })?.path ?? '';
      const oldPath = typeof _oldPath === 'string' ? _oldPath : '';
      if (this.isUnderFolder(path) || (oldPath && this.isUnderFolder(oldPath))) {
        void this.reload();
      }
    };
    this.refs.push(this.app.vault.on('create', handler));
    this.refs.push(this.app.vault.on('modify', handler));
    this.refs.push(this.app.vault.on('delete', handler));
    this.refs.push(this.app.vault.on('rename', handler));
  }

  private unsubscribe(): void {
    for (const ref of this.refs) {
      this.app.vault.offref(ref);
    }
    this.refs = [];
  }

  private async reload(): Promise<void> {
    const myGeneration = ++this.reloadGeneration;
    const all = await this.storage.loadAll();
    // If another reload (or dispose) bumped the generation while we were
    // awaiting, our result is stale and must not overwrite fresher state.
    if (myGeneration !== this.reloadGeneration) return;
    const favs = all
      .filter((a) => a.favorite === true)
      .sort((a, b) => {
        const ar = a.favoriteRank ?? Number.POSITIVE_INFINITY;
        const br = b.favoriteRank ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_FAVORITES);
    this.favorites = favs;
  }

  private normalizedFolder(): string {
    const raw = (this.getFolderPath() ?? '').trim();
    return raw.replace(/\/+$/, '');
  }

  private isUnderFolder(path: string): boolean {
    if (!this.currentFolder) return false;
    return path === this.currentFolder
      || path.startsWith(`${this.currentFolder}/`);
  }
}
