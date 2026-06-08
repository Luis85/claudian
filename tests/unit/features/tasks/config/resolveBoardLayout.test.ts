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
    const routed = layout.lanes.filter((lane) => !lane.isCatchAll);
    expect(routed.map((lane) => lane.id)).toEqual(['active', 'closed']);
    expect(routed[0].tasks.map((t) => t.frontmatter.id)).toEqual(['a', 'b']);
    expect(routed[1].tasks.map((t) => t.frontmatter.id)).toEqual(['c']);
    expect(layout.errors).toEqual([]);
  });

  it('flags the visible lane that receives new (inbox) work orders as the host', () => {
    const c: BoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'in', title: 'In', statuses: ['inbox', 'ready'], visible: true, definitionOfReady: [], definitionOfDone: [], collapsible: false, collapsed: false },
        { id: 'done', title: 'Done', statuses: ['done'], visible: true, definitionOfReady: [], definitionOfDone: [], collapsible: false, collapsed: false },
      ],
    };
    const layout = resolveBoardLayout(c, model(task('a', 'ready')));
    expect(layout.lanes.filter((lane) => lane.hostsNewWorkOrders).map((lane) => lane.id)).toEqual(['in']);
  });

  it('flags only the first visible owner when the inbox status is mapped twice', () => {
    const c: BoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'first', title: 'First', statuses: ['inbox'], visible: true, definitionOfReady: [], definitionOfDone: [], collapsible: false, collapsed: false },
        { id: 'second', title: 'Second', statuses: ['inbox'], visible: true, definitionOfReady: [], definitionOfDone: [], collapsible: false, collapsed: false },
      ],
    };
    const layout = resolveBoardLayout(c, model());
    expect(layout.lanes.filter((lane) => lane.hostsNewWorkOrders).map((lane) => lane.id)).toEqual(['first']);
  });

  it('routes tasks with no visible lane into a catch-all appended last', () => {
    const layout = resolveBoardLayout(config, model(task('a', 'ready'), task('z', 'failed'), task('y', 'inbox')));
    const last = layout.lanes[layout.lanes.length - 1];
    expect(last.isCatchAll).toBe(true);
    expect(last.title).toBe('Unsorted');
    expect(last.tasks.map((t) => t.frontmatter.id).sort()).toEqual(['y', 'z']);
    expect(layout.errors.length).toBe(1);
  });

  it('renders an empty catch-all as the inbox host when no visible lane owns inbox', () => {
    // The shared config has no inbox lane, so the catch-all is where new work
    // orders land and must appear (empty, no error) to host the add row.
    const layout = resolveBoardLayout(config, model(task('a', 'ready')));
    const catchAll = layout.lanes.find((lane) => lane.isCatchAll);
    expect(catchAll).toBeDefined();
    expect(catchAll!.tasks).toEqual([]);
    expect(catchAll!.hostsNewWorkOrders).toBe(true);
    expect(layout.errors).toEqual([]);
  });

  it('omits the catch-all when a visible lane owns inbox and every task is routed', () => {
    const c: BoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'in', title: 'In', statuses: ['inbox', 'ready'], visible: true, definitionOfReady: [], definitionOfDone: [], collapsible: false, collapsed: false },
      ],
    };
    const layout = resolveBoardLayout(c, model(task('a', 'ready')));
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
