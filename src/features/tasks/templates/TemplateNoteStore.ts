import type { Vault } from 'obsidian';

import { extractString, parseFrontmatter } from '../../../utils/frontmatter';
import type { TaskPriority } from '../model/taskTypes';
import type { WorkOrderTemplate } from './templateTypes';

const VALID_PRIORITIES: ReadonlySet<string> = new Set(['low', 'normal', 'high', 'urgent']);

function fileBaseName(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/i, '');
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
    const priority = rawPriority && VALID_PRIORITIES.has(rawPriority) ? (rawPriority as TaskPriority) : undefined;

    return {
      path,
      name: extractString(parsed.frontmatter, 'name') ?? fileBaseName(path),
      description: extractString(parsed.frontmatter, 'description'),
      provider: extractString(parsed.frontmatter, 'provider'),
      model: extractString(parsed.frontmatter, 'model'),
      priority,
      body: parsed.body.trim(),
    };
  }

  async list(vault: Vault, folder: string): Promise<{ templates: WorkOrderTemplate[]; warnings: string[] }> {
    const normalized = folder.replace(/^\/+|\/+$/g, '');
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
}
