import type { TranslationKey } from '../../i18n/types';

export type WorkOrderActivityStatus = 'running' | 'needs_input' | 'needs_approval';

export interface WorkOrderActivityItem {
  id: string;
  path: string;
  title: string;
  status: WorkOrderActivityStatus;
  labelKey: TranslationKey;
  actionHintKey: TranslationKey;
  sidepanelTabId?: string | null;
}

export interface WorkOrderActivitySummary {
  items: WorkOrderActivityItem[];
  runningCount: number;
  attentionCount: number;
}

export interface WorkOrderActivityProvider {
  getSummary(): WorkOrderActivitySummary;
  subscribe(callback: (summary: WorkOrderActivitySummary) => void): () => void;
  openItem(id: string): Promise<void>;
  dispose(): void;
}

export const EMPTY_WORK_ORDER_ACTIVITY_SUMMARY: WorkOrderActivitySummary = Object.freeze({
  items: Object.freeze([]) as WorkOrderActivityItem[],
  runningCount: 0,
  attentionCount: 0,
});

const ACTIVE_STATUSES = new Set<string>(['running', 'needs_input', 'needs_approval']);

export function isWorkOrderActivityStatus(value: unknown): value is WorkOrderActivityStatus {
  return typeof value === 'string' && ACTIVE_STATUSES.has(value);
}
