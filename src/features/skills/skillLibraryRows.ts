import type { SkillTabEntry } from '../quickActions/skills/types';

export interface SkillLibraryRow {
  id: string;
  name: string;
  description: string;
  providerDisplayName: string;
  sourceFilePath: string | null;
  editable: boolean;
}

export function toSkillLibraryRows(entries: SkillTabEntry[]): SkillLibraryRow[] {
  return entries
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      providerDisplayName: e.providerDisplayName,
      sourceFilePath: e.sourceFilePath,
      editable: e.sourceFilePath !== null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
