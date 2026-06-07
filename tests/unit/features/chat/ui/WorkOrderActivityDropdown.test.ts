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
  it('renders nothing with no active items and no closable tabs', () => {
    const host = createMockEl();
    new WorkOrderActivityDropdown(host, {
      summary: { items: [], closableTabs: [], runningCount: 0, attentionCount: 0 },
      onOpenItem: jest.fn(),
      onCloseItem: jest.fn(),
    });
    expect(host._children).toHaveLength(0);
  });

  it('marks the host hidden when empty so flexbox gap collapses', () => {
    const host = createMockEl();
    new WorkOrderActivityDropdown(host, {
      summary: { items: [], closableTabs: [], runningCount: 0, attentionCount: 0 },
      onOpenItem: jest.fn(),
      onCloseItem: jest.fn(),
    });
    expect(host.hasClass('claudian-hidden')).toBe(true);
  });

  it('unmarks hidden when entries appear', () => {
    const host = createMockEl();
    const dropdown = new WorkOrderActivityDropdown(host, {
      summary: { items: [], closableTabs: [], runningCount: 0, attentionCount: 0 },
      onOpenItem: jest.fn(),
      onCloseItem: jest.fn(),
    });
    dropdown.update({ items: [item], closableTabs: [], runningCount: 1, attentionCount: 0 });
    expect(host.hasClass('claudian-hidden')).toBe(false);
  });

  it('renders count, attention state, rows, and delegates selection', async () => {
    const host = createMockEl();
    const onOpenItem = jest.fn(async () => undefined);
    const summary: WorkOrderActivitySummary = { items: [item], closableTabs: [], runningCount: 0, attentionCount: 1 };
    new WorkOrderActivityDropdown(host, { summary, onOpenItem, onCloseItem: jest.fn() });

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

  it('surfaces a closable finished tab with a close affordance and delegates closing', async () => {
    const host = createMockEl();
    const onCloseItem = jest.fn(async () => undefined);
    const summary: WorkOrderActivitySummary = {
      items: [],
      closableTabs: [{ tabId: 'tab-9', title: 'Finished WO' }],
      runningCount: 0,
      attentionCount: 0,
    };
    new WorkOrderActivityDropdown(host, { summary, onOpenItem: jest.fn(), onCloseItem });

    // The dropdown shows even with no active items, counting the closable tab.
    const toggle = host.querySelector('.claudian-work-order-activity-toggle');
    expect(toggle).not.toBeNull();
    expect(host.querySelector('.claudian-work-order-activity-count')?.textContent).toBe('1');

    toggle?.click();
    const close = host.querySelector('.claudian-work-order-activity-close');
    expect(close).not.toBeNull();
    close?.click();
    await Promise.resolve();

    expect(onCloseItem).toHaveBeenCalledWith('tab-9');
  });
});