import { createMockEl } from '@test/helpers/mockElement';

import type { WorkOrderActivitySummary } from '@/core/types/workOrderActivity';
import { WorkOrderActivityDropdown } from '@/features/chat/ui/WorkOrderActivityDropdown';

const item = {
  id: 'task-1',
  path: 'Agent Board/tasks/task-1.md',
  title: 'Task 1',
  status: 'needs_input' as const,
  labelKey: 'workOrderActivity.status.needsInput' as const,
  actionHintKey: 'workOrderActivity.action.reply' as const,
  sidepanelTabId: 'tab-1',
};

describe('WorkOrderActivityDropdown', () => {
  it('renders nothing with no active items', () => {
    const host = createMockEl();
    new WorkOrderActivityDropdown(host, { summary: { items: [], runningCount: 0, attentionCount: 0 }, onOpenItem: jest.fn() });
    expect(host._children).toHaveLength(0);
  });

  it('renders count, attention state, rows, and delegates selection', async () => {
    const host = createMockEl();
    const onOpenItem = jest.fn(async () => undefined);
    const summary: WorkOrderActivitySummary = { items: [item], runningCount: 0, attentionCount: 1 };
    new WorkOrderActivityDropdown(host, { summary, onOpenItem });

    const toggle = host.querySelector('.claudian-work-order-activity-toggle');
    expect(toggle?.hasClass('claudian-work-order-activity-toggle--attention')).toBe(true);
    expect(host.querySelector('.claudian-work-order-activity-count')?.textContent).toBe('1');

    toggle?.click();
    const row = host.querySelector('.claudian-work-order-activity-item');
    expect(row?.textContent).toContain('Task 1');
    row?.click();
    await Promise.resolve();

    expect(onOpenItem).toHaveBeenCalledWith('task-1');
  });
});