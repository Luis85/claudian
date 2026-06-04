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

export class QuickActionStorage {
  constructor(
    private adapter: VaultFileAdapter,
    private getFolderPath: () => string,
  ) {}

  async loadAll(): Promise<QuickAction[]> {
    const folder = this.getFolderPath().trim();
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

  async save(action: QuickAction): Promise<string> {
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
    await this.adapter.ensureFolder(this.getFolderPath());
    await this.adapter.write(filePath, content);
    return filePath;
  }

  async setFavorite(action: QuickAction, rank: number): Promise<void> {
    if (!Number.isInteger(rank) || rank < 1 || rank > 5) {
      throw new Error(`invalid favoriteRank: ${rank}`);
    }
    await this.save({ ...action, favorite: true, favoriteRank: rank });
  }

  async unsetFavorite(action: QuickAction): Promise<void> {
    const { favorite: _favorite, favoriteRank: _favoriteRank, ...rest } = action;
    await this.save({ ...rest, favorite: undefined, favoriteRank: undefined });
  }

  async delete(filePath: string): Promise<void> {
    await this.adapter.delete(filePath);
  }

  getFilePathForName(name: string): string {
    const folder = this.getFolderPath().trim();
    const safe = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'action';
    return `${folder}/${safe}.md`;
  }
}
