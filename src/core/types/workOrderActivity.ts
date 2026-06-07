import type { TranslationKey } from '../../i18n/types';

const WORK_ORDER_ACTIVITY_STATUSES = ['running', 'needs_input', 'needs_approval'] as const;

export type WorkOrderActivityStatus = (typeof WORK_ORDER_ACTIVITY_STATUSES)[number];

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
  readonly items: readonly WorkOrderActivityItem[];
  readonly runningCount: number;
  readonly attentionCount: number;
}

export interface WorkOrderActivityProvider {
  getSummary(): WorkOrderActivitySummary;
  subscribe(callback: (summary: WorkOrderActivitySummary) => void): () => void;
  openItem(id: string): Promise<void>;
  dispose(): void;
}

export const EMPTY_WORK_ORDER_ACTIVITY_SUMMARY: WorkOrderActivitySummary = Object.freeze({
  items: Object.freeze([]),
  runningCount: 0,
  attentionCount: 0,
});

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(WORK_ORDER_ACTIVITY_STATUSES);

export function isWorkOrderActivityStatus(value: unknown): value is WorkOrderActivityStatus {
  return typeof value === 'string' && ACTIVE_STATUSES.has(value);
}
