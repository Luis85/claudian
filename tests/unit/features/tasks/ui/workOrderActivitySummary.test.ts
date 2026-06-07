import type { TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';
import { buildWorkOrderActivitySummary } from '@/features/tasks/ui/workOrderActivitySummary';

function task(id: string, status: TaskStatus, title = id, sidepanelTabId?: string | null): TaskSpec {
  return {
    path: `Agent Board/tasks/${id}.md`,
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id,
      title,
      status,
      priority: '2 - normal',
      created: '2026-06-07T00:00:00.000Z',
      updated: '2026-06-07T00:00:00.000Z',
      attempts: 0,
      sidepanel_tab_id: sidepanelTabId,
    },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
    body: '',
    raw: '',
  };
}

describe('buildWorkOrderActivitySummary', () => {
  it('filters to active statuses, counts attention, and sorts by urgency', () => {
    const summary = buildWorkOrderActivitySummary([
      task('ready', 'ready'),
      task('running', 'running', 'Running', 'tab-running'),
      task('input', 'needs_input', 'Input', 'tab-input'),
      task('approval', 'needs_approval', 'Approval', 'tab-approval'),
      task('done', 'done'),
    ]);

    expect(summary.items.map((item) => item.id)).toEqual(['input', 'approval', 'running']);
    expect(summary.runningCount).toBe(1);
    expect(summary.attentionCount).toBe(2);
    expect(summary.items[0]).toEqual(expect.objectContaining({
      title: 'Input',
      status: 'needs_input',
      labelKey: 'workOrderActivity.status.needsInput',
      actionHintKey: 'workOrderActivity.action.reply',
      sidepanelTabId: 'tab-input',
    }));
  });
});