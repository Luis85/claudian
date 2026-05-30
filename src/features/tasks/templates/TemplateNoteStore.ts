import type { App, Vault } from 'obsidian';
import { TFile } from 'obsidian';

import { extractString, parseFrontmatter } from '../../../utils/frontmatter';
import type { TaskPriority } from '../model/taskTypes';
import type { WorkOrderTemplate } from './templateTypes';

const VALID_PRIORITIES: ReadonlySet<TaskPriority> = new Set<TaskPriority>(['0 - urgent', '1 - high', '2 - normal', '3 - low']);

function fileBaseName(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/i, '');
}

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, '');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface SaveTemplateInput {
  name: string;
  description?: string;
  icon?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
  body: string;
}

export class TemplateNoteStore {
  parse(path: string, content: string): WorkOrderTemplate {
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      throw new Error('Missing YAML frontmatter');
    }
    if (parsed.frontmatter.type !== 'claudian-work-order-template') {
      throw new Error('Invalid template type');
    }
    if (parsed.frontmatter.schema_version !== 1) {
      throw new Error('Unsupported template schema_version');
    }

    const rawPriority = extractString(parsed.frontmatter, 'priority');
    const priority = rawPriority && VALID_PRIORITIES.has(rawPriority as TaskPriority) ? (rawPriority as TaskPriority) : undefined;

    return {
      path,
      name: extractString(parsed.frontmatter, 'name') ?? fileBaseName(path),
      description: extractString(parsed.frontmatter, 'description'),
      icon: extractString(parsed.frontmatter, 'icon'),
      provider: extractString(parsed.frontmatter, 'provider'),
      model: extractString(parsed.frontmatter, 'model'),
      priority,
      body: parsed.body.trim(),
    };
  }

  async list(vault: Vault, folder: string): Promise<{ templates: WorkOrderTemplate[]; warnings: string[] }> {
    const normalized = normalizeFolder(folder);
    const templates: WorkOrderTemplate[] = [];
    const warnings: string[] = [];
    const files = vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${normalized}/`));
    for (const file of files) {
      try {
        templates.push(this.parse(file.path, await vault.read(file)));
      } catch (error) {
        warnings.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    templates.sort((a, b) => a.name.localeCompare(b.name));
    return { templates, warnings };
  }

  build(input: SaveTemplateInput): string {
    const lines: string[] = [
      '---',
      'type: claudian-work-order-template',
      'schema_version: 1',
      `name: ${JSON.stringify(input.name)}`,
    ];
    if (input.description) lines.push(`description: ${JSON.stringify(input.description)}`);
    if (input.icon) lines.push(`icon: ${JSON.stringify(input.icon)}`);
    if (input.provider) lines.push(`provider: ${JSON.stringify(input.provider)}`);
    if (input.model) lines.push(`model: ${JSON.stringify(input.model)}`);
    if (input.priority) lines.push(`priority: ${input.priority}`);
    lines.push('---', '', input.body.trim(), '');
    return lines.join('\n');
  }

  getFilePathForName(folder: string, name: string): string {
    const slug = slugify(name) || 'template';
    return `${normalizeFolder(folder)}/${slug}.md`;
  }

  async save(
    vault: Vault,
    folder: string,
    input: SaveTemplateInput,
    originalPath?: string,
  ): Promise<string> {
    const content = this.build(input);
    if (originalPath) {
      const existing = vault.getAbstractFileByPath(originalPath);
      if (existing instanceof TFile) {
        await vault.modify(existing, content);
        return originalPath;
      }
    }
    const normalized = normalizeFolder(folder);
    if (!vault.getAbstractFileByPath(normalized)) {
      await vault.createFolder(normalized);
    }
    const filePath = this.getFilePathForName(normalized, input.name);
    await vault.create(filePath, content);
    return filePath;
  }

  async delete(app: App, path: string): Promise<void> {
    const file = app.vault.getAbstractFileByPath(path);
    if (file) {
      await app.fileManager.trashFile(file);
    }
  }
}
