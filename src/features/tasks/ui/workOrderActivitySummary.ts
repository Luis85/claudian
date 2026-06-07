import type { WorkOrderActivityItem, WorkOrderActivityStatus, WorkOrderActivitySummary } from '../../../core/types/workOrderActivity';
import { isWorkOrderActivityStatus } from '../../../core/types/workOrderActivity';
import type { TranslationKey } from '../../../i18n/types';
import type { TaskSpec } from '../model/taskTypes';

const STATUS_RANK: Record<WorkOrderActivityStatus, number> = {
  needs_input: 0,
  needs_approval: 1,
  running: 2,
};

const STATUS_LABEL_KEYS: Record<WorkOrderActivityStatus, TranslationKey> = {
  running: 'workOrderActivity.status.running',
  needs_input: 'workOrderActivity.status.needsInput',
  needs_approval: 'workOrderActivity.status.needsApproval',
};

const ACTION_HINT_KEYS: Record<WorkOrderActivityStatus, TranslationKey> = {
  running: 'workOrderActivity.action.open',
  needs_input: 'workOrderActivity.action.reply',
  needs_approval: 'workOrderActivity.action.review',
};

export function buildWorkOrderActivitySummary(tasks: TaskSpec[]): WorkOrderActivitySummary {
  const items: WorkOrderActivityItem[] = [];
  for (const task of tasks) {
    const status = task.frontmatter.status;
    if (!isWorkOrderActivityStatus(status)) continue;
    items.push({
      id: task.frontmatter.id,
      path: task.path,
      title: task.frontmatter.title,
      status,
      labelKey: STATUS_LABEL_KEYS[status],
      actionHintKey: ACTION_HINT_KEYS[status],
      sidepanelTabId: task.frontmatter.sidepanel_tab_id ?? null,
    });
  }
  items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.title.localeCompare(b.title));
  return {
    items,
    // Closable (finished/orphaned) tabs come from live tab state, not the vault
    // task model, so the provider fills this in after composing the active items.
    closableTabs: [],
    runningCount: items.filter((item) => item.status === 'running').length,
    attentionCount: items.filter((item) => item.status !== 'running').length,
  };
}