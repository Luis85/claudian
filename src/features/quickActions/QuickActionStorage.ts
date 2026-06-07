import { normalizePath } from 'obsidian';

import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { parseQuickActionContent, serializeQuickAction } from './quickActionParse';
import type { QuickAction } from './types';

export function assignNextFavoriteRank(actions: QuickAction[]): number | null {
  const used = new Set<number>();
  let totalFavorites = 0;
  for (const a of actions) {
    if (a.favorite === true) {
      totalFavorites++;
      if (typeof a.favoriteRank === 'number') {
        used.add(a.favoriteRank);
      }
    }
  }
  if (totalFavorites >= 5) return null;
  for (let r = 1; r <= 5; r++) {
    if (!used.has(r)) return r;
  }
  return null;
}

/**
 * Surgically patches the `favorite` and `favoriteRank` keys in a note's
 * YAML frontmatter without round-tripping through the lossy serializer.
 * Unknown keys (e.g. `aliases`, `cssclasses`, future metadata) are preserved
 * verbatim so a one-click star toggle never wipes hand-authored metadata.
 *
 * Only top-level scalar `favorite:` / `favoriteRank:` lines are touched.
 * Setting a value to `undefined` removes the line.
 */
export function applyFavoriteFrontmatterPatch(
  content: string,
  updates: { favorite?: boolean; favoriteRank?: number },
): string {
  const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/;
  const match = content.match(FRONTMATTER);
  if (!match) {
    const fmLines = ['---'];
    if (updates.favorite !== undefined) fmLines.push(`favorite: ${updates.favorite}`);
    if (updates.favoriteRank !== undefined) fmLines.push(`favoriteRank: ${updates.favoriteRank}`);
    fmLines.push('---', '');
    return fmLines.join('\n') + content;
  }

  const [, openFence, yaml, closeFence, body] = match;
  const lines = yaml.split(/\r?\n/);
  const setOrRemove = (key: string, value: unknown): void => {
    const lineRegex = new RegExp(`^${key}\\s*:`);
    const idx = lines.findIndex((l) => lineRegex.test(l));
    if (value === undefined || value === null) {
      if (idx >= 0) lines.splice(idx, 1);
      return;
    }
    const newLine = `${key}: ${value}`;
    if (idx >= 0) {
      lines[idx] = newLine;
    } else {
      lines.push(newLine);
    }
  };

  setOrRemove('favorite', updates.favorite);
  setOrRemove('favoriteRank', updates.favoriteRank);

  return openFence + lines.join('\n') + closeFence + body;
}

export class QuickActionStorage {
  constructor(
    private adapter: VaultFileAdapter,
    private getFolderPath: () => string,
  ) {}

  /**
   * Trimmed + normalized Quick Actions folder (`''` when unset). Saving and
   * loading must agree on this single value — otherwise a folder configured with
   * duplicate or backslash separators is written under the normalized path but
   * scanned under the raw one, so saved actions vanish until the user manually
   * fixes the setting.
   */
  private resolveFolder(): string {
    const folder = this.getFolderPath().trim();
    return folder ? normalizePath(folder) : '';
  }

  /**
   * Whether a non-empty Quick Actions folder is configured. Callers (e.g. the
   * modal add/edit flow) must check this before saving: with a blank folder a
   * save would land a vault-root file that `loadAll()` never scans, so the
   * action silently vanishes on refresh.
   */
  hasConfiguredFolder(): boolean {
    return this.resolveFolder() !== '';
  }

  async loadAll(): Promise<QuickAction[]> {
    const folder = this.resolveFolder();
    if (!folder) {
      return [];
    }

    const actions: QuickAction[] = [];
    try {
      // Read-only path: do not create the folder. listFilesRecursive returns []
      // when the folder is missing, so favorites cache reloads on plugin startup
      // never materialize the configured Quick Actions folder.
      const files = await this.adapter.listFilesRecursive(folder);
      for (const filePath of files) {
        if (!filePath.endsWith('.md')) {
          continue;
        }
        try {
          const action = await this.loadFromFile(filePath);
          if (action) {
            actions.push(action);
          }
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Folder may not exist yet
    }

    return actions.sort((a, b) => a.name.localeCompare(b.name));
  }

  async loadFromFile(filePath: string): Promise<QuickAction | null> {
    const content = await this.adapter.read(filePath);
    return parseQuickActionContent(content, filePath);
  }

  /** Thin wrapper for collision checks before write. */
  async exists(filePath: string): Promise<boolean> {
    return this.adapter.exists(filePath);
  }

  async save(action: QuickAction): Promise<string> {
    // Refuse to write a quick action that loadAll() could never find: a blank
    // folder normalizes to a vault-root path the loader does not scan. Callers
    // guard with hasConfiguredFolder() upfront; this is the storage backstop.
    if (!this.hasConfiguredFolder()) {
      throw new Error('Quick Actions folder is not configured');
    }
    const filePath = action.filePath || this.getFilePathForName(action.name);
    const content = serializeQuickAction({
      name: action.name,
      description: action.description,
      icon: action.icon,
      tags: action.tags,
      prompt: action.prompt,
      favorite: action.favorite,
      favoriteRank: action.favoriteRank,
    });
    // Folder is user-configured; normalize before the adapter's mkdir/write so
    // it matches the path loadAll() scans and getFilePathForName() writes to.
    const folder = this.resolveFolder();
    if (folder) {
      await this.adapter.ensureFolder(folder);
    }
    await this.adapter.write(filePath, content);
    return filePath;
  }

  async setFavorite(action: QuickAction, rank: number): Promise<void> {
    if (!Number.isInteger(rank) || rank < 1 || rank > 5) {
      throw new Error(`invalid favoriteRank: ${rank}`);
    }
    await this.patchFavoriteFrontmatter(action.filePath, { favorite: true, favoriteRank: rank });
  }

  async unsetFavorite(action: QuickAction): Promise<void> {
    await this.patchFavoriteFrontmatter(action.filePath, {
      favorite: undefined,
      favoriteRank: undefined,
    });
  }

  // Toggle path patches only the favorite fields so unknown user-authored
  // keys (aliases, cssclasses, custom fields) survive a one-click star.
  // The editor modal still goes through save() because the user has opted
  // into the canonical serialized form when they open the editor.
  private async patchFavoriteFrontmatter(
    filePath: string,
    updates: { favorite?: boolean; favoriteRank?: number },
  ): Promise<void> {
    const content = await this.adapter.read(filePath);
    const patched = applyFavoriteFrontmatterPatch(content, updates);
    await this.adapter.write(filePath, patched);
  }

  async delete(filePath: string): Promise<void> {
    await this.adapter.delete(filePath);
  }

  getFilePathForName(name: string): string {
    const folder = this.resolveFolder();
    const safe = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'action';
    // User-configured folder + action name flow into adapter writes/reads.
    return normalizePath(`${folder}/${safe}.md`);
  }
}
