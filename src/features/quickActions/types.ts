/** YAML frontmatter `type` value for quick-action markdown files. */
export const QUICK_ACTION_FRONTMATTER_TYPE = 'quick-action';

export interface QuickAction {
  id: string;
  name: string;
  description: string;
  icon?: string;
  prompt: string;
  filePath: string;
}

export interface QuickActionFrontmatter {
  name: string;
  description?: string;
  icon?: string;
}
