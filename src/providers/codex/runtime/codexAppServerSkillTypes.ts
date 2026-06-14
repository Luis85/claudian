// Codex app-server `skills/list` wire types. Re-exported from
// codexAppServerTypes.ts so existing importers are unchanged.

export type SkillScope = 'user' | 'repo' | 'system' | 'admin';

export interface SkillInterface {
  displayName?: string;
  shortDescription?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  interface?: SkillInterface;
  path: string;
  scope: SkillScope;
  enabled: boolean;
}

export interface SkillErrorInfo {
  path: string;
  message: string;
}

export interface SkillsListEntry {
  cwd: string;
  skills: SkillMetadata[];
  errors: SkillErrorInfo[];
}

export interface SkillsListParams {
  cwds?: string[];
  forceReload?: boolean;
  perCwdExtraUserRoots?: Array<{
    cwd: string;
    extraUserRoots: string[];
  }> | null;
}

export interface SkillsListResult {
  data: SkillsListEntry[];
}
