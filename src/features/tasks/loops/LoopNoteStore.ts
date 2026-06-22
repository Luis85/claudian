import type { App, Vault } from 'obsidian';
import { normalizePath, TFile } from 'obsidian';

import { extractString, parseFrontmatter } from '../../../utils/frontmatter';
import type { LoopDefinition, SaveLoopInput } from './loopTypes';

const SECTION_HEADINGS = Object.freeze({
  useWhen: 'Use when',
  approach: 'Approach',
  steps: 'Steps',
  verify: 'Verify',
  notes: 'Notes',
});

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

function extractSection(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const headingPattern = /^##\s+(.+?)\s*$/;
  const sectionLines: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const match = line.match(headingPattern);
    if (match) {
      if (inSection) break;
      inSection = match[1] === heading;
      continue;
    }
    if (inSection) sectionLines.push(line);
  }
  return sectionLines.join('\n').trim();
}

export class LoopNoteStore {
  parse(path: string, content: string): LoopDefinition {
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      throw new Error('Missing YAML frontmatter');
    }
    if (parsed.frontmatter.type !== 'claudian-loop') {
      throw new Error('Invalid loop type');
    }
    if (parsed.frontmatter.schema_version !== 1) {
      throw new Error('Unsupported loop schema_version');
    }

    const name = extractString(parsed.frontmatter, 'name') ?? fileBaseName(path);
    return {
      path,
      id: slugify(name) || fileBaseName(path),
      name,
      description: extractString(parsed.frontmatter, 'description'),
      icon: extractString(parsed.frontmatter, 'icon'),
      useWhen: extractSection(parsed.body, SECTION_HEADINGS.useWhen),
      approach: extractSection(parsed.body, SECTION_HEADINGS.approach),
      steps: extractSection(parsed.body, SECTION_HEADINGS.steps),
      verify: extractSection(parsed.body, SECTION_HEADINGS.verify),
      notes: extractSection(parsed.body, SECTION_HEADINGS.notes),
    };
  }

  build(input: SaveLoopInput): string {
    const lines: string[] = [
      '---',
      'type: claudian-loop',
      'schema_version: 1',
      `name: ${JSON.stringify(input.name)}`,
    ];
    if (input.description) lines.push(`description: ${JSON.stringify(input.description)}`);
    if (input.icon) lines.push(`icon: ${JSON.stringify(input.icon)}`);
    lines.push('---', '');
    const section = (heading: string, value: string): void => {
      if (value.trim()) lines.push(`## ${heading}`, '', value.trim(), '');
    };
    section(SECTION_HEADINGS.useWhen, input.useWhen);
    section(SECTION_HEADINGS.approach, input.approach);
    section(SECTION_HEADINGS.steps, input.steps);
    section(SECTION_HEADINGS.verify, input.verify);
    section(SECTION_HEADINGS.notes, input.notes);
    return lines.join('\n');
  }

  async list(vault: Vault, folder: string): Promise<{ loops: LoopDefinition[]; warnings: string[] }> {
    const normalized = normalizeFolder(folder);
    const loops: LoopDefinition[] = [];
    const warnings: string[] = [];
    const files = vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${normalized}/`));
    for (const file of files) {
      try {
        loops.push(this.parse(file.path, await vault.read(file)));
      } catch (error) {
        warnings.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    loops.sort((a, b) => a.name.localeCompare(b.name));
    return { loops, warnings };
  }

  getFilePathForName(folder: string, name: string): string {
    const slug = slugify(name) || 'loop';
    // folder + name are user-/settings-derived; normalize before any vault call.
    return normalizePath(`${normalizeFolder(folder)}/${slug}.md`);
  }

  async save(vault: Vault, folder: string, input: SaveLoopInput, originalPath?: string): Promise<string> {
    const content = this.build(input);
    if (originalPath) {
      const existing = vault.getAbstractFileByPath(originalPath);
      if (existing instanceof TFile) {
        await vault.modify(existing, content);
        return originalPath;
      }
    }
    const normalized = normalizePath(normalizeFolder(folder));
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
