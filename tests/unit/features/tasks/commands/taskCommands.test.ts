import {
  __taskCaptureTestUtils,
  __taskCommandTestUtils,
} from '../../../../../src/features/tasks/commands/taskCommands';
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

  it('uses seeded objective, context, and conversation id', () => {
    const markdown = buildWorkOrderMarkdown({
      id: 'task-seeded',
      title: 'Seeded order',
      provider: 'codex',
      model: 'gpt-5-codex',
      timestamp: '2026-05-29T10:00:00.000Z',
      status: 'inbox',
      objective: 'Implement the linker',
      contextMarkdown: 'Promoted from chat message.',
      conversationId: 'conv-123',
    });

    expect(markdown).toContain('status: inbox');
    expect(markdown).toContain('conversation_id: "conv-123"');
    expect(markdown).toContain('## Objective\n\nImplement the linker');
    expect(markdown).toContain('## Context\n\nPromoted from chat message.');
  });

  it('leaves conversation_id empty and placeholders intact without a seed', () => {
    const markdown = buildWorkOrderMarkdown({
      id: 'task-bare',
      title: 'Bare',
      provider: 'claude',
      model: 'sonnet',
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    expect(markdown).toContain('conversation_id:\n');
    expect(markdown).toContain('_What should the agent accomplish?_');
  });
});

describe('buildSelectionSeed', () => {
  it('blockquotes the selection, links the source, and lands in inbox', () => {
    const seed = __taskCaptureTestUtils.buildSelectionSeed({
      selectionText: 'Fix the auth bug\nin the middleware',
      sourcePath: 'notes/auth.md',
    });
    expect(seed.status).toBe('inbox');
    expect(seed.title).toBe('Fix the auth bug');
    expect(seed.contextMarkdown).toContain('Source note: [[notes/auth]]');
    expect(seed.contextMarkdown).toContain('> Fix the auth bug');
    expect(seed.contextMarkdown).toContain('> in the middleware');
  });
});
