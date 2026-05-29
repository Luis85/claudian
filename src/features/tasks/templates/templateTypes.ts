import type { TaskPriority } from '../model/taskTypes';

export interface WorkOrderTemplate {
  path: string;
  name: string;
  description?: string;
  icon?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
  body: string;
}

export type TemplateChoice =
  | { kind: 'blank' }
  | { kind: 'template'; template: WorkOrderTemplate };

export interface TemplateVars {
  title: string;
  date: string;
  source: string;
}

export const ALLOWED_TEMPLATE_PLACEHOLDERS = ['title', 'date', 'source'] as const;
