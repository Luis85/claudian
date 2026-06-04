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
    const skills: LoadedSkill[] = [];

    try {
      const folders = await this.adapter.listFolders(SKILLS_PATH);

      for (const folder of folders) {
        const skillName = folder.split('/').pop()!;
        const skillPath = `${SKILLS_PATH}/${skillName}/SKILL.md`;

        try {
          if (!(await this.adapter.exists(skillPath))) continue;

          const content = await this.adapter.read(skillPath);
          const parsed = parseSlashCommandContent(content);

          skills.push({
            skill: {
              ...parsedToSlashCommand(parsed, {
                id: `skill-${skillName}`,
                name: skillName,
                source: 'user',
              }),
              kind: 'skill',
            },
            filePath: skillPath,
          });
        } catch {
          // Non-critical: skip malformed skill files
        }
      }
    } catch {
      return [];
    }

    return skills;
  }

  async save(skill: SlashCommand): Promise<void> {
    const name = skill.name;
    const dirPath = `${SKILLS_PATH}/${name}`;
    const filePath = `${dirPath}/SKILL.md`;

    await this.adapter.ensureFolder(dirPath);
    await this.adapter.write(filePath, serializeCommand(skill));
  }

  async delete(skillId: string): Promise<void> {
    const name = skillId.replace(/^skill-/, '');
    const dirPath = `${SKILLS_PATH}/${name}`;
    const filePath = `${dirPath}/SKILL.md`;
    await this.adapter.delete(filePath);
    await this.adapter.deleteFolder(dirPath);
  }
}
