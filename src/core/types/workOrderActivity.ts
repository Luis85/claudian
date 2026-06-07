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

/**
 * An open work-order tab whose run is no longer active (finished/terminal or
 * orphaned). Work-order badges are hidden from the tab bar, so these tabs would
 * otherwise be invisible and uncloseable while still consuming the work-order
 * slot budget — the dropdown surfaces them with an explicit close affordance.
 */
export interface WorkOrderActivityClosableTab {
  tabId: string;
  title: string;
}

export interface WorkOrderActivitySummary {
  readonly items: readonly WorkOrderActivityItem[];
  readonly closableTabs: readonly WorkOrderActivityClosableTab[];
  readonly runningCount: number;
  readonly attentionCount: number;
}

export interface WorkOrderActivityProvider {
  getSummary(): WorkOrderActivitySummary;
  subscribe(callback: (summary: WorkOrderActivitySummary) => void): () => void;
  openItem(id: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  dispose(): void;
}

export const EMPTY_WORK_ORDER_ACTIVITY_SUMMARY: WorkOrderActivitySummary = Object.freeze({
  items: Object.freeze([]),
  closableTabs: Object.freeze([]),
  runningCount: 0,
  attentionCount: 0,
});

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(WORK_ORDER_ACTIVITY_STATUSES);

export function isWorkOrderActivityStatus(value: unknown): value is WorkOrderActivityStatus {
  return typeof value === 'string' && ACTIVE_STATUSES.has(value);
}
