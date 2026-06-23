import {
  __taskCaptureTestUtils,
  __taskCommandTestUtils,
  resolveArchiveFolder,
} from '../../../../../src/features/tasks/commands/taskCommands';
import { TaskNoteStore } from '../../../../../src/features/tasks/storage/TaskNoteStore';
import { TemplateNoteStore } from '../../../../../src/features/tasks/templates/TemplateNoteStore';

const { buildWorkOrderMarkdown, buildWorkOrderFromTemplate, slugifyTitle } = __taskCommandTestUtils;

describe('buildWorkOrderFromTemplate agent', () => {
  const base = {
    id: 'task-1',
    title: 'Templated order',
    status: 'inbox' as const,
    priority: '2 - normal' as const,
    timestamp: '2026-06-23T10:00:00.000Z',
    provider: 'claude',
    model: 'sonnet',
    body: '# Templated order\n\n## Objective\nDo the thing.',
  };

  it('writes the agent frontmatter when the template assigns one', () => {
    const md = buildWorkOrderFromTemplate({ ...base, agent: 'roster:debugger' });
    expect(md).toContain('agent: "roster:debugger"');
    expect(new TaskNoteStore().parse('x.md', md).task.frontmatter.agent).toBe('roster:debugger');
  });

  it('omits the agent frontmatter when the template has no agent', () => {
    const md = buildWorkOrderFromTemplate(base);
    expect(md).not.toContain('agent:');
    expect(new TaskNoteStore().parse('x.md', md).task.frontmatter.agent).toBeUndefined();
  });
});

describe('resolveArchiveFolder', () => {
  it('defaults to Agent Board/archive when unset', () => {
    expect(resolveArchiveFolder('')).toBe('Agent Board/archive');
  });

  it('trims surrounding slashes from a custom folder', () => {
    expect(resolveArchiveFolder('/Custom/Archive/')).toBe('Custom/Archive');
  });
});

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
    expect(markdown).toContain('status: inbox');
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
    expect(task.frontmatter.status).toBe('inbox');
    expect(task.frontmatter.provider).toBe('codex');
    expect(task.frontmatter.model).toBe('gpt-5-codex');
  });

  it('emits the requested status, defaulting to inbox', () => {
    const base = { id: 't', title: 'T', provider: 'codex', model: 'm', timestamp: '2026-05-28T18:00:00.000Z' };
    expect(buildWorkOrderMarkdown(base)).toContain('status: inbox');
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

describe('stripMarkdown (title normalization)', () => {
  const strip = __taskCommandTestUtils.stripMarkdown;

  it.each([
    ['## Heading title', 'Heading title'],
    ['### Heading ###', 'Heading'],
    ['> quoted line', 'quoted line'],
    ['- bullet item', 'bullet item'],
    ['* star bullet', 'star bullet'],
    ['1. first step', 'first step'],
    ['- [ ] todo title', 'todo title'],
    ['- [x] done title', 'done title'],
    ['**Bold heading**', 'Bold heading'],
    ['_emphasised_', 'emphasised'],
    ['***strong emphasis***', 'strong emphasis'],
    ['~~struck~~', 'struck'],
    ['use `code` here', 'use code here'],
    ['see [the docs](https://x.dev)', 'see the docs'],
    ['look ![alt text](img.png)', 'look alt text'],
    ['ref [[notes/parser|the parser]]', 'ref the parser'],
    ['ref [[notes/parser]]', 'ref notes/parser'],
    ['## **Bold** in a [heading](u)', 'Bold in a heading'],
    ['plain text stays', 'plain text stays'],
  ])('strips %p -> %p', (input, expected) => {
    expect(strip(input)).toBe(expected);
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

  it('strips markdown from the title but keeps it in the quoted body', () => {
    const seed = __taskCaptureTestUtils.buildSelectionSeed({
      selectionText: '## Refactor the **parser**\ninto smaller units',
      sourcePath: 'notes/parser.md',
    });
    expect(seed.title).toBe('Refactor the parser');
    expect(seed.contextMarkdown).toContain('> ## Refactor the **parser**');
  });
});

describe('buildBrowserSeed', () => {
  it('blockquotes the selection and links the source url', () => {
    const seed = __taskCaptureTestUtils.buildBrowserSeed({
      source: 'browser:https://x.dev',
      selectedText: 'Two Sum problem',
      title: 'LeetCode',
      url: 'https://x.dev',
    });
    expect(seed.status).toBe('inbox');
    expect(seed.title).toBe('LeetCode');
    expect(seed.contextMarkdown).toContain('> Two Sum problem');
    expect(seed.contextMarkdown).toContain('[LeetCode](https://x.dev)');
  });
});

describe('buildMessageSeed / buildConversationSeed', () => {
  it('message seed carries objective, conversation id, and inbox status', () => {
    const seed = __taskCaptureTestUtils.buildMessageSeed({
      messageContent: 'Refactor the parser\nfor speed',
      currentNote: 'notes/parser.md',
      conversationId: 'conv-9',
    });
    expect(seed.status).toBe('inbox');
    expect(seed.title).toBe('Refactor the parser');
    expect(seed.objective).toBe('Refactor the parser\nfor speed');
    expect(seed.conversationId).toBe('conv-9');
    expect(seed.contextMarkdown).toContain('Source note: [[notes/parser]]');
    expect(seed.contextMarkdown).toContain('Promoted from chat message.');
  });

  it('strips markdown from a message title while leaving the objective intact', () => {
    const seed = __taskCaptureTestUtils.buildMessageSeed({
      messageContent: '## Add focused tests\n\nThen wire CI.',
      currentNote: null,
      conversationId: 'conv-md',
    });
    expect(seed.title).toBe('Add focused tests');
    expect(seed.objective).toBe('## Add focused tests\n\nThen wire CI.');
  });

  it('conversation seed links the conversation', () => {
    const seed = __taskCaptureTestUtils.buildConversationSeed({
      conversationId: 'conv-9',
      conversationTitle: 'Auth spike',
    });
    expect(seed.title).toBe('Auth spike');
    expect(seed.conversationId).toBe('conv-9');
    expect(seed.contextMarkdown).toContain('Promoted from chat conversation.');
  });
});

describe('buildWorkOrderMarkdown priority + seam', () => {
  const { buildWorkOrderMarkdown } = __taskCommandTestUtils;
  const base = { id: 't', title: 'T', provider: 'codex', model: 'm', timestamp: '2026-05-29T10:00:00.000Z' };

  it('emits the requested priority, defaulting to normal', () => {
    expect(buildWorkOrderMarkdown(base)).toContain('priority: 2 - normal');
    expect(buildWorkOrderMarkdown({ ...base, priority: '1 - high' })).toContain('priority: 1 - high');
  });

  it('keeps the constraints-to-ledger seam intact', () => {
    expect(buildWorkOrderMarkdown(base)).toContain(
      '- Do not modify unrelated files.\n\n## Run Ledger\n\n<!-- claudian:run-ledger-start -->',
    );
  });
});

describe('buildWorkOrderFromTemplate', () => {
  const { buildWorkOrderFromTemplate } = __taskCommandTestUtils;

  it('wraps the rendered body in frontmatter and generated regions', () => {
    const md = buildWorkOrderFromTemplate({
      id: 'task-tpl',
      title: 'Templated',
      status: 'inbox',
      priority: '1 - high',
      timestamp: '2026-05-29T10:00:00.000Z',
      provider: 'claude',
      model: 'sonnet',
      conversationId: null,
      body: '# Templated\n\n## Objective\n\nDo the thing.',
    });

    expect(md).toContain('priority: 1 - high');
    expect(md).toContain('provider: claude');
    expect(md).toContain('## Objective\n\nDo the thing.');
    expect(md).toContain('## Run Ledger');
    expect(md).toContain('<!-- claudian:handoff-start -->');

    const { task } = new TaskNoteStore().parse('Agent Board/tasks/tpl.md', md);
    expect(task.frontmatter.status).toBe('inbox');
    expect(task.frontmatter.priority).toBe('1 - high');
  });

  it('emits loop: "<slug>" when a loop is supplied, and omits it when absent', () => {
    const base = {
      id: 'task-loop',
      title: 'Loop test',
      status: 'inbox' as const,
      priority: '2 - normal' as const,
      timestamp: '2026-06-22T10:00:00.000Z',
      provider: 'claude',
      model: 'sonnet',
      conversationId: null,
      body: '# Loop test\n\n## Objective\n\nDo the loop thing.',
    };

    const withLoop = buildWorkOrderFromTemplate({ ...base, loop: 'my-loop-slug' });
    expect(withLoop).toContain('loop: "my-loop-slug"');

    const withoutLoop = buildWorkOrderFromTemplate(base);
    expect(withoutLoop).not.toContain('loop:');
  });
});

describe('buildExampleTemplateMarkdown', () => {
  const { buildExampleTemplateMarkdown } = __taskCommandTestUtils;

  it('scaffolds a template note that the template store can parse', () => {
    const tpl = new TemplateNoteStore().parse('Agent Board/templates/example.md', buildExampleTemplateMarkdown());
    expect(tpl.name).toBe('Example template');
    expect(tpl.body).toContain('{{title}}');
    expect(tpl.body).toContain('{{source}}');
  });
});
