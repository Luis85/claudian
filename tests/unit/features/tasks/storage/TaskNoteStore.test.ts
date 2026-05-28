import {
  HANDOFF_END,
  HANDOFF_START,
  RUN_LEDGER_END,
  RUN_LEDGER_START,
  TaskNoteStore,
} from '../../../../../src/features/tasks/storage/TaskNoteStore';

const VALID_NOTE = `---
type: claudian-work-order
schema_version: 1
id: task-1
title: Build agent board
status: ready
priority: normal
created: 2026-05-28T08:00:00.000Z
updated: 2026-05-28T08:00:00.000Z
attempts: 0
custom_field: keep-me
---
# Build agent board

Intro prose that must stay.

## Objective
Ship the thin slice.

## Acceptance Criteria
- Shows task cards.
- Runs work orders.

## Context
Use existing chat runtime.

## Constraints
Do not touch unrelated files.

## Run Ledger
${RUN_LEDGER_START}
- Existing generated entry.
${RUN_LEDGER_END}

## Handoff
${HANDOFF_START}
Old handoff.
${HANDOFF_END}

Closing prose.
`;

describe('TaskNoteStore', () => {
  const store = new TaskNoteStore();

  it('parses a valid work order note into frontmatter and sections', () => {
    const result = store.parse('tasks/task-1.md', VALID_NOTE);

    expect(result.task.frontmatter.status).toBe('ready');
    expect(result.task.frontmatter.custom_field).toBe('keep-me');
    expect(result.task.sections.objective).toBe('Ship the thin slice.');
    expect(result.task.sections.context).toBe('Use existing chat runtime.');
    expect(result.task.sections.ledger).toBe('- Existing generated entry.');
    expect(result.task.sections.handoff).toBe('Old handoff.');
  });

  it('rejects notes without YAML frontmatter', () => {
    expect(() => store.parse('tasks/bad.md', '# No frontmatter')).toThrow('Missing YAML frontmatter');
  });

  it('writes running status metadata while preserving unknown frontmatter and body prose', () => {
    const written = store.writeStatus(VALID_NOTE, {
      status: 'running',
      runId: 'run-123',
      conversationId: 'conversation-456',
      sidepanelTabId: 'tab-789',
      timestamp: '2026-05-28T09:00:00.000Z',
    });

    const parsed = store.parse('tasks/task-1.md', written);
    expect(parsed.task.frontmatter.status).toBe('running');
    expect(parsed.task.frontmatter.updated).toBe('2026-05-28T09:00:00.000Z');
    expect(parsed.task.frontmatter.started).toBe('2026-05-28T09:00:00.000Z');
    expect(parsed.task.frontmatter.run_id).toBe('run-123');
    expect(parsed.task.frontmatter.conversation_id).toBe('conversation-456');
    expect(parsed.task.frontmatter.sidepanel_tab_id).toBe('tab-789');
    expect(parsed.task.frontmatter.custom_field).toBe('keep-me');
    expect(written).toContain('Intro prose that must stay.');
    expect(written).toContain('Closing prose.');
  });

  it('appends ledger entries only between ledger markers', () => {
    const written = store.appendLedger(VALID_NOTE, {
      timestamp: '2026-05-28T09:05:00.000Z',
      status: 'running',
      message: 'Started work.',
    });

    expect(written).toContain('Intro prose that must stay.');
    expect(written).toContain(`${RUN_LEDGER_START}\n- Existing generated entry.\n- 2026-05-28T09:05:00.000Z [running] Started work.\n${RUN_LEDGER_END}`);
    expect(store.extractGeneratedRegion(written, HANDOFF_START, HANDOFF_END)).toBe('Old handoff.');
  });

  it('writes handoff markdown only between handoff markers', () => {
    const written = store.writeHandoff(VALID_NOTE, 'New handoff.\n\n- Verify it.');

    expect(written).toContain('Intro prose that must stay.');
    expect(store.extractGeneratedRegion(written, RUN_LEDGER_START, RUN_LEDGER_END)).toBe('- Existing generated entry.');
    expect(written).toContain(`${HANDOFF_START}\nNew handoff.\n\n- Verify it.\n${HANDOFF_END}`);
  });
});
