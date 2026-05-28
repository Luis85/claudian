import type { ProviderId } from '../../../core/providers/types';

export type TaskStatus =
  | 'inbox'
  | 'ready'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'review'
  | 'needs_fix'
  | 'done'
  | 'failed'
  | 'canceled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TaskFrontmatter {
  type: 'claudian-work-order';
  schema_version: 1;
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  created: string;
  updated: string;
  provider?: ProviderId;
  model?: string;
  run_id?: string | null;
  conversation_id?: string | null;
  sidepanel_tab_id?: string | null;
  started?: string | null;
  finished?: string | null;
  attempts: number;
}

export interface TaskSections {
  objective: string;
  acceptanceCriteria: string;
  context: string;
  constraints: string;
  ledger: string;
  handoff: string;
}

export interface TaskSpec {
  path: string;
  frontmatter: TaskFrontmatter;
  sections: TaskSections;
  body: string;
  raw: string;
}

export interface InvalidTaskNote {
  path: string;
  error: string;
}

export interface TaskBoardModel {
  tasks: TaskSpec[];
  invalidNotes: InvalidTaskNote[];
}

export interface TaskLedgerEntry {
  timestamp: string;
  status: TaskStatus;
  message: string;
}

export interface ParsedHandoff {
  summary: string;
  verification: string;
  risks: string;
  nextAction: string;
  markdown: string;
}