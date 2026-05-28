import { TaskIndexer } from '../../../../../src/features/tasks/indexing/TaskIndexer';
import { TaskNoteStore } from '../../../../../src/features/tasks/storage/TaskNoteStore';

const VALID = `---
type: claudian-work-order
schema_version: 1
id: task-valid
title: Valid order
status: ready
priority: normal
created: 2026-05-28T08:00:00.000Z
updated: 2026-05-28T08:00:00.000Z
attempts: 0
---
## Objective
Do it.
`;

const WRONG_TYPE = `---
type: not-a-work-order
schema_version: 1
---
body
`;

const NO_FRONTMATTER = `# Just a note

no frontmatter here
`;

describe('TaskIndexer', () => {
  const indexer = new TaskIndexer(new TaskNoteStore());

  it('sorts valid notes into tasks and bad notes into invalidNotes', () => {
    const model = indexer.indexContents([
      { path: 'Agent Board/tasks/valid.md', content: VALID },
      { path: 'Agent Board/tasks/wrong-type.md', content: WRONG_TYPE },
      { path: 'Agent Board/tasks/no-fm.md', content: NO_FRONTMATTER },
    ]);

    expect(model.tasks.map((task) => task.frontmatter.id)).toEqual(['task-valid']);
    expect(model.invalidNotes).toEqual([
      { path: 'Agent Board/tasks/wrong-type.md', error: 'Invalid work order type' },
      { path: 'Agent Board/tasks/no-fm.md', error: 'Missing YAML frontmatter' },
    ]);
  });
});
