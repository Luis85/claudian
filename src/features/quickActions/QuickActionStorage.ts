import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { parseQuickActionContent, serializeQuickAction } from './quickActionParse';
import type { QuickAction } from './types';

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
      await this.adapter.ensureFolder(folder);
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
    });
    await this.adapter.ensureFolder(this.getFolderPath());
    await this.adapter.write(filePath, content);
    return filePath;
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
