import type { BoardConfig } from '../../../../../src/features/tasks/config/boardConfigTypes';
import { resolveBoardLayout } from '../../../../../src/features/tasks/config/resolveBoardLayout';
import type { TaskBoardModel, TaskSpec, TaskStatus } from '../../../../../src/features/tasks/model/taskTypes';

function task(id: string, status: TaskStatus): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    raw: '',
    body: '',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id,
      title: id,
      status,
      priority: 'normal',
      created: 't',
      updated: 't',
      attempts: 0,
    },
    sections: { objective: '', acceptanceCriteria: '', context: '', constraints: '', ledger: '', handoff: '' },
  };
}

function model(...tasks: TaskSpec[]): TaskBoardModel {
  return { tasks, invalidNotes: [] };
}

const config: BoardConfig = {
  schemaVersion: 1,
  lanes: [
    { id: 'active', title: 'Active', statuses: ['ready', 'running'], visible: true, definitionOfReady: ['Clear'], definitionOfDone: [] },
    { id: 'closed', title: 'Closed', statuses: ['done'], visible: true, definitionOfReady: [], definitionOfDone: [] },
    { id: 'hidden', title: 'Hidden', statuses: ['failed'], visible: false, definitionOfReady: [], definitionOfDone: [] },
  ],
};

describe('resolveBoardLayout', () => {
  it('buckets tasks into matching visible lanes', () => {
    const layout = resolveBoardLayout(config, model(task('a', 'ready'), task('b', 'running'), task('c', 'done')));
    expect(layout.lanes.map((lane) => lane.id)).toEqual(['active', 'closed']);
    expect(layout.lanes[0].tasks.map((t) => t.frontmatter.id)).toEqual(['a', 'b']);
    expect(layout.lanes[1].tasks.map((t) => t.frontmatter.id)).toEqual(['c']);
    expect(layout.errors).toEqual([]);
  });

  it('routes tasks with no visible lane into a catch-all appended last', () => {
    const layout = resolveBoardLayout(config, model(task('a', 'ready'), task('z', 'failed'), task('y', 'inbox')));
    const last = layout.lanes[layout.lanes.length - 1];
    expect(last.isCatchAll).toBe(true);
    expect(last.title).toBe('Unsorted');
    expect(last.tasks.map((t) => t.frontmatter.id).sort()).toEqual(['y', 'z']);
    expect(layout.errors.length).toBe(1);
  });

  it('omits the catch-all when every task has a visible lane', () => {
    const layout = resolveBoardLayout(config, model(task('a', 'ready')));
    expect(layout.lanes.some((lane) => lane.isCatchAll)).toBe(false);
  });
});
