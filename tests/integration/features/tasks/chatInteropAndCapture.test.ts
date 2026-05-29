import type { ChatMessage } from '@/core/types';
import { __taskCommandTestUtils, buildMessageSeed } from '@/features/tasks/commands/taskCommands';
import { selectNextReadyTask } from '@/features/tasks/execution/selectNextReadyTask';
import { TaskNoteStore } from '@/features/tasks/storage/TaskNoteStore';
import { chatMessageText } from '@/utils/chatMessageText';

const { buildWorkOrderMarkdown } = __taskCommandTestUtils;

describe('chat interop and capture (integration)', () => {
  it("captures an agent (assistant) message by lifting its text blocks into the objective", () => {
    // The per-message button now lives on assistant messages, whose prose is in
    // contentBlocks (content stays empty). Capture must read that, not message.content.
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 0,
      contentBlocks: [
        { type: 'thinking', content: 'planning' } as never,
        { type: 'text', content: 'Refactor the parser into smaller units.' } as never,
        { type: 'text', content: 'Then add focused tests.' } as never,
      ],
    };

    const seed = buildMessageSeed({
      messageContent: chatMessageText(assistant),
      currentNote: null,
      conversationId: 'conv-agent',
    });

    expect(seed.conversationId).toBe('conv-agent');
    expect(seed.status).toBe('inbox');
    expect(seed.title).toBe('Refactor the parser into smaller units.');

    const markdown = buildWorkOrderMarkdown({
      id: 'task-conv-agent',
      title: seed.title ?? 'Work order from chat',
      provider: 'claude',
      model: 'sonnet',
      timestamp: '2026-05-29T10:00:00.000Z',
      status: seed.status,
      objective: seed.objective,
      contextMarkdown: seed.contextMarkdown,
      conversationId: seed.conversationId,
    });

    const { task } = new TaskNoteStore().parse('Agent Board/tasks/task-conv-agent.md', markdown);
    expect(task.frontmatter.conversation_id).toBe('conv-agent');
    expect(task.frontmatter.status).toBe('inbox');
    expect(task.sections.objective).toBe('Refactor the parser into smaller units.\n\nThen add focused tests.');
  });

  it('a promoted message seed produces a parseable inbox order linked to the conversation', () => {
    // Promote: chat message -> work-order seed (Task 1/4/5 capture path).
    const seed = buildMessageSeed({
      messageContent: 'Do the thing',
      currentNote: 'a.md',
      conversationId: 'conv-1',
    });
    expect(seed.conversationId).toBe('conv-1');
    expect(seed.status).toBe('inbox');

    // Link + render: feed the seed through the SAME markdown builder the command uses,
    // so the conversation_id quoting contract is exercised end to end.
    const markdown = buildWorkOrderMarkdown({
      id: 'task-conv-1',
      title: seed.title ?? 'Work order from chat',
      provider: 'codex',
      model: 'gpt-5-codex',
      timestamp: '2026-05-29T10:00:00.000Z',
      status: seed.status,
      objective: seed.objective,
      contextMarkdown: seed.contextMarkdown,
      conversationId: seed.conversationId,
    });

    // Parse: round-trip the durable note back through the store.
    const { task } = new TaskNoteStore().parse('Agent Board/tasks/task-conv-1.md', markdown);

    expect(task.frontmatter.conversation_id).toBe('conv-1');
    expect(task.frontmatter.status).toBe('inbox');
    expect(task.frontmatter.id).toBe('task-conv-1');
    // Objective and context survive the round-trip into the parsed body/sections.
    expect(task.sections.objective).toBe('Do the thing');
    expect(task.sections.context).toContain('Source note: [[a]]');
    expect(task.sections.context).toContain('Promoted from chat message.');
  });

  it('selectNextReadyTask picks a ready order produced by capture', () => {
    const store = new TaskNoteStore();
    const markdown = buildWorkOrderMarkdown({
      id: 'task-ready',
      title: 'Ready order',
      provider: 'codex',
      model: 'gpt-5-codex',
      timestamp: '2026-05-29T10:00:00.000Z',
      status: 'ready',
    });

    const { task } = store.parse('Agent Board/tasks/task-ready.md', markdown);
    expect(task.frontmatter.status).toBe('ready');

    expect(selectNextReadyTask([task], (s) => s === 'ready')?.frontmatter.id).toBe('task-ready');
  });

  it('captured inbox orders are not run by run-next-ready (by design)', () => {
    // A promoted/captured order lands in `inbox`; run-next-ready only fires for `ready`,
    // so a freshly captured order must NOT be auto-selected for a run.
    const store = new TaskNoteStore();
    const seed = buildMessageSeed({
      messageContent: 'Triage later',
      currentNote: null,
      conversationId: 'conv-2',
    });
    const markdown = buildWorkOrderMarkdown({
      id: 'task-inbox',
      title: seed.title ?? 'Work order from chat',
      provider: 'codex',
      model: 'gpt-5-codex',
      timestamp: '2026-05-29T10:00:00.000Z',
      status: seed.status,
      objective: seed.objective,
      contextMarkdown: seed.contextMarkdown,
      conversationId: seed.conversationId,
    });

    const { task } = store.parse('Agent Board/tasks/task-inbox.md', markdown);
    expect(task.frontmatter.status).toBe('inbox');
    expect(selectNextReadyTask([task], (s) => s === 'ready')).toBeNull();
  });
});
