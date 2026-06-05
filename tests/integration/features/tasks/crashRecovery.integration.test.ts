import { TFile } from 'obsidian';

import { EventBus } from '../../../../src/core/events/EventBus';
import type { TaskEventMap } from '../../../../src/features/tasks/events';
import { sharedActiveRunIds } from '../../../../src/features/tasks/execution/activeRunRegistry';
import {
  HANDOFF_END,
  HANDOFF_START,
  RUN_LEDGER_END,
  RUN_LEDGER_START,
  TaskNoteStore,
} from '../../../../src/features/tasks/storage/TaskNoteStore';
import { AgentBoardView } from '../../../../src/features/tasks/ui/AgentBoardView';

const PATH = 'Agent Board/tasks/t1.md';

function makeRunningNote(status = 'running'): string {
  return `---
type: claudian-work-order
schema_version: 1
id: t1
title: Orphaned task
status: ${status}
priority: 2 - normal
created: 2026-06-04T08:00:00.000Z
updated: 2026-06-04T08:00:00.000Z
provider: claude
model: claude-sonnet-4-5
started: 2026-06-04T08:30:00.000Z
heartbeat: 2026-06-04T08:30:00.000Z
attempts: 1
---
# Orphaned task

## Objective
Do the thing.

## Acceptance Criteria
- [ ] Done.

## Context
ctx

## Constraints
none

## Run Ledger

${RUN_LEDGER_START}
- 2026-06-04T08:30:00.000Z [running] Run started (attempt 1)
${RUN_LEDGER_END}

## Result / Handoff

${HANDOFF_START}
${HANDOFF_END}
`;
}

function makeView(notes: Record<string, string>, coordinator: unknown) {
  const store = new TaskNoteStore();
  const events = new EventBus<TaskEventMap>();
  const statusEvents: string[] = [];
  events.on('task:status-changed', (p) => statusEvents.push(p.status));

  const tasks = Object.entries(notes).map(([path, content]) => store.parse(path, content).task);
  const view = Object.create(AgentBoardView.prototype) as Record<string, unknown> & {
    recoverOrphanedRuns: () => Promise<void>;
  };
  view.model = { tasks, invalidNotes: [] };
  view.coordinator = coordinator;
  view.pauseState = new Map();
  view.noteStore = store;
  view.refresh = jest.fn(async () => {});
  view.plugin = {
    app: {
      vault: {
        getAbstractFileByPath: (p: string) => {
          // Object.create keeps `instanceof TFile` true without the real
          // (test-mocked) constructor, which the obsidian types type as no-arg.
          const file = Object.create(TFile.prototype) as TFile;
          file.path = p;
          return file;
        },
        process: async (file: TFile, transform: (content: string) => string) => {
          notes[file.path] = transform(notes[file.path]);
          return notes[file.path];
        },
      },
    },
    events,
  };
  return { view, store, statusEvents };
}

describe('Agent Board crash recovery (integration)', () => {
  afterEach(() => sharedActiveRunIds.clear());

  it('marks an orphaned running work order as failed on open', async () => {
    const notes = { [PATH]: makeRunningNote('running') };
    const { view, store, statusEvents } = makeView(notes, null);

    await view.recoverOrphanedRuns();

    const parsed = store.parse(PATH, notes[PATH]).task;
    expect(parsed.frontmatter.status).toBe('failed');
    expect(parsed.sections.ledger).toContain('orphaned by plugin reload');
    expect(statusEvents).toContain('failed');
    expect(view.refresh).toHaveBeenCalled();
  });

  it('recovers an orphaned paused (needs_input) work order too', async () => {
    const notes = { [PATH]: makeRunningNote('needs_input') };
    const { view, store } = makeView(notes, null);

    await view.recoverOrphanedRuns();

    expect(store.parse(PATH, notes[PATH]).task.frontmatter.status).toBe('failed');
  });

  it('leaves a work order with a live session untouched', async () => {
    const notes = { [PATH]: makeRunningNote('running') };
    const { view, store } = makeView(notes, null);
    sharedActiveRunIds.add('t1'); // a live run (e.g. a previous view) still owns it

    await view.recoverOrphanedRuns();

    expect(store.parse(PATH, notes[PATH]).task.frontmatter.status).toBe('running');
    expect(view.refresh).not.toHaveBeenCalled();
  });

  it('ignores terminal work orders', async () => {
    const notes = { [PATH]: makeRunningNote('review') };
    const { view, store } = makeView(notes, null);

    await view.recoverOrphanedRuns();

    expect(store.parse(PATH, notes[PATH]).task.frontmatter.status).toBe('review');
  });
});
