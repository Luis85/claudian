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
      priority: '2 - normal',
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
    { id: 'active', title: 'Active', statuses: ['ready', 'running'], visible: true, definitionOfReady: ['Clear'], definitionOfDone: [], collapsible: false, collapsed: false },
    { id: 'closed', title: 'Closed', statuses: ['done'], visible: true, definitionOfReady: [], definitionOfDone: [], collapsible: false, collapsed: false },
    { id: 'hidden', title: 'Hidden', statuses: ['failed'], visible: false, definitionOfReady: [], definitionOfDone: [], collapsible: false, collapsed: false },
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

  it('propagates each visible lane\'s statuses and gives the catch-all every unclaimed status', () => {
    const layout = resolveBoardLayout(config, model(task('z', 'inbox')));
    expect(layout.lanes[0].statuses).toEqual(['ready', 'running']);
    expect(layout.lanes[1].statuses).toEqual(['done']);
    const catchAll = layout.lanes.find((lane) => lane.isCatchAll)!;
    // Statuses no visible lane claims land on the catch-all — including `inbox`
    // and `failed` (the latter only claimed by a hidden lane).
    expect(catchAll.statuses).toContain('inbox');
    expect(catchAll.statuses).toContain('failed');
    expect(catchAll.statuses).not.toContain('ready');
    expect(catchAll.statuses).not.toContain('done');
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

  it('passes collapsible/collapsed through to resolved lanes', () => {
    const c: BoardConfig = {
      schemaVersion: 1,
      lanes: [
        {
          id: 'a',
          title: 'A',
          statuses: ['ready'],
          visible: true,
          definitionOfReady: [],
          definitionOfDone: [],
          collapsible: true,
          collapsed: true,
        },
      ],
    };
    const layout = resolveBoardLayout(c, model());
    expect(layout.lanes[0].collapsible).toBe(true);
    expect(layout.lanes[0].collapsed).toBe(true);
  });

  it('defaults catch-all lane to non-collapsible', () => {
    // A `running` task with no visible lane routes through the catch-all,
    // which must never project a collapsed strip.
    const layout = resolveBoardLayout(config, model(task('z', 'inbox')));
    const catchAll = layout.lanes.find((lane) => lane.isCatchAll);
    expect(catchAll?.collapsible).toBe(false);
    expect(catchAll?.collapsed).toBe(false);
  });

  it('re-gates collapsed against collapsible at resolve time', () => {
    // Defense-in-depth: a hand-built config that bypasses normalizeLane
    // (collapsible=false but collapsed=true) must not project a strip.
    const c: BoardConfig = {
      schemaVersion: 1,
      lanes: [
        {
          id: 'a',
          title: 'A',
          statuses: ['ready'],
          visible: true,
          definitionOfReady: [],
          definitionOfDone: [],
          collapsible: false,
          collapsed: true,
        },
      ],
    };
    const layout = resolveBoardLayout(c, model());
    expect(layout.lanes[0].collapsed).toBe(false);
  });
});
