import type { TaskSpec, TaskStatus } from '../../../../../src/features/tasks/model/taskTypes';
import {
  buildContextReference,
  filterAddableWorkOrders,
} from '../../../../../src/features/tasks/ui/AddToWorkOrderModal';

function makeTask(status: TaskStatus, updated: string, title: string = status): TaskSpec {
  return {
    path: `Agent Board/tasks/${title}.md`,
    frontmatter: { status, updated, title } as TaskSpec['frontmatter'],
    sections: {} as TaskSpec['sections'],
    body: '',
    raw: '',
  };
}

describe('filterAddableWorkOrders', () => {
  it('keeps only new (inbox) and ready work orders', () => {
    const tasks = [
      makeTask('inbox', '2026-06-01'),
      makeTask('ready', '2026-06-02'),
      makeTask('running', '2026-06-03'),
      makeTask('done', '2026-06-04'),
      makeTask('needs_fix', '2026-06-05'),
      makeTask('canceled', '2026-06-06'),
    ];
    expect(filterAddableWorkOrders(tasks).map((t) => t.frontmatter.status)).toEqual(['ready', 'inbox']);
  });

  it('sorts the kept work orders by most recently updated first', () => {
    const tasks = [
      makeTask('inbox', '2026-06-01', 'oldest'),
      makeTask('ready', '2026-06-10', 'newest'),
      makeTask('inbox', '2026-06-05', 'middle'),
    ];
    expect(filterAddableWorkOrders(tasks).map((t) => t.frontmatter.title)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('returns an empty list when nothing is addable', () => {
    expect(filterAddableWorkOrders([makeTask('running', '2026-06-01')])).toEqual([]);
  });
});

describe('buildContextReference', () => {
  it('wikilinks a markdown file, stripping the .md extension', () => {
    expect(buildContextReference({ path: 'Notes/Foo.md', isFolder: false })).toBe('[[Notes/Foo]]');
  });

  it('wikilinks a non-markdown file, keeping its extension', () => {
    expect(buildContextReference({ path: 'assets/diagram.png', isFolder: false })).toBe('[[assets/diagram.png]]');
  });

  it('code-spans a folder path', () => {
    expect(buildContextReference({ path: 'Notes/Sub', isFolder: true })).toBe('`Notes/Sub`');
  });
});
