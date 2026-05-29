import { __taskCommandTestUtils } from '../../../../../src/features/tasks/commands/taskCommands';
import { TaskNoteStore } from '../../../../../src/features/tasks/storage/TaskNoteStore';

const { buildWorkOrderMarkdown, slugifyTitle } = __taskCommandTestUtils;

describe('slugifyTitle', () => {
  it('lowercases, strips symbols, and collapses separators', () => {
    expect(slugifyTitle('Build the Board!')).toBe('build-the-board');
    expect(slugifyTitle('  Spaces &  Symbols  ')).toBe('spaces-symbols');
  });
});

describe('buildWorkOrderMarkdown', () => {
  it('emits valid frontmatter, provider/model, source link, and generated regions', () => {
    const markdown = buildWorkOrderMarkdown({
      id: 'task-20260528180000-build-the-board',
      title: 'Build the board',
      provider: 'codex',
      model: 'gpt-5-codex',
      timestamp: '2026-05-28T18:00:00.000Z',
      sourcePath: 'docs/specs/board.md',
    });

    expect(markdown).toContain('type: claudian-work-order');
    expect(markdown).toContain('status: ready');
    expect(markdown).toContain('provider: codex');
    expect(markdown).toContain('model: gpt-5-codex');
    expect(markdown).toContain('Source note: [[docs/specs/board]]');
    expect(markdown).toContain('<!-- claudian:run-ledger-start -->');
    expect(markdown).toContain('<!-- claudian:handoff-start -->');
    // The work order links to the source note but never copies its contents.
    expect(markdown).toContain('## Context\n\nSource note: [[docs/specs/board]]');
  });

  it('omits the source link when no source note is given', () => {
    const markdown = buildWorkOrderMarkdown({
      id: 'task-1',
      title: 'No source',
      provider: 'claude',
      model: 'sonnet',
      timestamp: '2026-05-28T18:00:00.000Z',
    });

    expect(markdown).not.toContain('Source note:');
  });

  it('produces markdown that TaskNoteStore can parse back', () => {
    const markdown = buildWorkOrderMarkdown({
      id: 'task-parse',
      title: 'Parseable: with colon',
      provider: 'codex',
      model: 'gpt-5-codex',
      timestamp: '2026-05-28T18:00:00.000Z',
    });

    const { task } = new TaskNoteStore().parse('Agent Board/tasks/parse.md', markdown);
    expect(task.frontmatter.status).toBe('ready');
    expect(task.frontmatter.provider).toBe('codex');
    expect(task.frontmatter.model).toBe('gpt-5-codex');
  });

  it('emits the requested status, defaulting to ready', () => {
    const base = { id: 't', title: 'T', provider: 'codex', model: 'm', timestamp: '2026-05-28T18:00:00.000Z' };
    expect(buildWorkOrderMarkdown(base)).toContain('status: ready');
    expect(buildWorkOrderMarkdown({ ...base, status: 'inbox' })).toContain('status: inbox');
  });
});
