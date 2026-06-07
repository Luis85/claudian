import {
  EMPTY_WORK_ORDER_ACTIVITY_SUMMARY,
  isWorkOrderActivityStatus,
  type WorkOrderActivityItem,
  type WorkOrderActivityProvider,
  type WorkOrderActivitySummary,
} from '@/core/types/workOrderActivity';

describe('work-order activity contracts', () => {
  it('recognizes only active dropdown statuses', () => {
    expect(isWorkOrderActivityStatus('running')).toBe(true);
    expect(isWorkOrderActivityStatus('needs_input')).toBe(true);
    expect(isWorkOrderActivityStatus('needs_approval')).toBe(true);
    expect(isWorkOrderActivityStatus('review')).toBe(false);
    expect(isWorkOrderActivityStatus('done')).toBe(false);
  });

  it('exports an immutable empty summary and provider shape', () => {
    const item: WorkOrderActivityItem = {
      id: 'task-1',
      path: 'Agent Board/tasks/task-1.md',
      title: 'Task 1',
      status: 'needs_input',
      labelKey: 'workOrderActivity.status.needsInput',
      actionHintKey: 'workOrderActivity.action.reply',
      sidepanelTabId: 'tab-1',
    };
    const provider: WorkOrderActivityProvider = {
      getSummary: () => ({ items: [item], runningCount: 0, attentionCount: 1 }),
      subscribe: jest.fn(() => jest.fn()),
      openItem: jest.fn(async () => undefined),
      dispose: jest.fn(),
    };

    expect(EMPTY_WORK_ORDER_ACTIVITY_SUMMARY).toEqual({ items: [], runningCount: 0, attentionCount: 0 });
    expect(Object.isFrozen(EMPTY_WORK_ORDER_ACTIVITY_SUMMARY)).toBe(true);
    expect(Object.isFrozen(EMPTY_WORK_ORDER_ACTIVITY_SUMMARY.items)).toBe(true);
    expect(provider.getSummary().items[0].actionHintKey).toBe('workOrderActivity.action.reply');
  });
});

function expectReadonlySummaryItems(summary: WorkOrderActivitySummary, item: WorkOrderActivityItem): void {
  // @ts-expect-error readonly summary snapshots reject item mutation
  summary.items.push(item);
}

void expectReadonlySummaryItems;
