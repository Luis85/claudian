import { normalizePath } from 'obsidian';

import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { SlashCommand } from '../../../core/types';
import { parsedToSlashCommand, parseSlashCommandContent, serializeCommand } from '../../../utils/slashCommand';

export const SKILLS_PATH = '.claude/skills';

export interface LoadedSkill {
  skill: SlashCommand;
  filePath: string;
}

export class SkillStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async loadAll(): Promise<LoadedSkill[]> {
    try {
      const folders = await this.adapter.listFolders(SKILLS_PATH);
      const results = await Promise.all(folders.map((f) => this.loadOne(f)));
      return results.filter((x): x is LoadedSkill => x !== null);
    } catch {
      return [];
    }
  }

  private async loadOne(folder: string): Promise<LoadedSkill | null> {
    const skillName = folder.split('/').pop()!;
    const skillPath = `${SKILLS_PATH}/${skillName}/SKILL.md`;
    try {
      if (!(await this.adapter.exists(skillPath))) return null;
      const content = await this.adapter.read(skillPath);
      const parsed = parseSlashCommandContent(content);
      return {
        skill: {
          ...parsedToSlashCommand(parsed, {
            id: `skill-${skillName}`,
            name: skillName,
            source: 'user',
          }),
          kind: 'skill',
        },
        filePath: skillPath,
      };
    } catch {
      return null;
    }
  }

  async save(skill: SlashCommand): Promise<void> {
    const name = skill.name;
    // Skill name is user-/agent-supplied; normalize the vault path it forms.
    const dirPath = normalizePath(`${SKILLS_PATH}/${name}`);
    const filePath = normalizePath(`${dirPath}/SKILL.md`);

    await this.adapter.ensureFolder(dirPath);
    await this.adapter.write(filePath, serializeCommand(skill));
  }

  async delete(skillId: string): Promise<void> {
    const name = skillId.replace(/^skill-/, '');
    const dirPath = normalizePath(`${SKILLS_PATH}/${name}`);
    const filePath = normalizePath(`${dirPath}/SKILL.md`);
    await this.adapter.delete(filePath);
    await this.adapter.deleteFolder(dirPath);
  }
}
