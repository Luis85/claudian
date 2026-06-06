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
priority: 2 - normal
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
const NOTE_WITH_FRONTMATTER_MARKERS = `---
type: claudian-work-order
schema_version: 1
id: task-1
title: Build agent board
status: ready
priority: 2 - normal
created: 2026-05-28T08:00:00.000Z
updated: 2026-05-28T08:00:00.000Z
attempts: 0
ledger_hint: "${RUN_LEDGER_START}"
handoff_hint: "${HANDOFF_START}"
---
# Build agent board

## Objective
Ship the thin slice.

## Acceptance Criteria
- Shows task cards.

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
      started: '2026-05-28T09:00:00.000Z',
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

  it('does not overwrite started on a heartbeat-only running write', () => {
    const started = store.writeStatus(VALID_NOTE, {
      status: 'running',
      started: '2026-05-28T09:00:00.000Z',
      heartbeat: '2026-05-28T09:00:00.000Z',
      timestamp: '2026-05-28T09:00:00.000Z',
    });
    const afterHeartbeat = store.writeStatus(started, {
      status: 'running',
      heartbeat: '2026-05-28T09:05:00.000Z',
      timestamp: '2026-05-28T09:05:00.000Z',
    });
    const parsed = store.parse('tasks/task-1.md', afterHeartbeat);
    expect(parsed.task.frontmatter.started).toBe('2026-05-28T09:00:00.000Z');
    expect(parsed.task.frontmatter.heartbeat).toBe('2026-05-28T09:05:00.000Z');
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

  it('ignores marker-like frontmatter values when replacing generated ledger and handoff body regions', () => {
    const ledgerWritten = store.appendLedger(NOTE_WITH_FRONTMATTER_MARKERS, {
      timestamp: '2026-05-28T09:05:00.000Z',
      status: 'running',
      message: 'Started work.',
    });

    expect(ledgerWritten).toContain(`ledger_hint: "${RUN_LEDGER_START}"`);
    expect(ledgerWritten).toContain(`${RUN_LEDGER_START}
- Existing generated entry.
- 2026-05-28T09:05:00.000Z [running] Started work.
${RUN_LEDGER_END}`);

    const handoffWritten = store.writeHandoff(ledgerWritten, 'New handoff.');

    expect(handoffWritten).toContain(`handoff_hint: "${HANDOFF_START}"`);
    expect(store.extractGeneratedRegion(handoffWritten, RUN_LEDGER_START, RUN_LEDGER_END)).toBe(`- Existing generated entry.
- 2026-05-28T09:05:00.000Z [running] Started work.`);
    expect(handoffWritten).toContain(`${HANDOFF_START}
New handoff.
${HANDOFF_END}`);
  });

  it('throws when the note is missing run-ledger markers so a hand-edited note fails loudly', () => {
    // Without markers, `extractGeneratedRegion` returns '' and
    // `replaceGeneratedRegion` would throw later — but the caller already
    // pre-computed `currentLedger + entry`, so the loud throw at the right
    // seam is the safer contract. Mirrors `writeLedgerSnapshot`'s behavior.
    const noMarkers =
      '---\n' +
      'type: claudian-work-order\nschema_version: 1\nid: t\ntitle: t\nstatus: running\nupdated: x\n' +
      '---\n' +
      '## Objective\nx\n';
    expect(() => store.appendLedger(noMarkers, {
      timestamp: '2026-05-28T09:05:00.000Z',
      status: 'running',
      message: 'should not silently append',
    })).toThrow(/Missing generated region markers/);
  });

  it('rejects ledger messages containing Claudian marker strings', () => {
    expect(() => store.appendLedger(VALID_NOTE, {
      timestamp: '2026-05-28T09:05:00.000Z',
      status: 'running',
      message: 'Do not include <!-- claudian:run-ledger-start --> here.',
    })).toThrow('Generated task region content cannot contain Claudian markers');
  });

  it('rejects handoff markdown containing Claudian marker strings', () => {
    expect(() => store.writeHandoff(
      VALID_NOTE,
      `Summary

<!-- claudian:handoff-end -->`
    )).toThrow('Generated task region content cannot contain Claudian markers');
  });

  it('writes frontmatter fields, bumps updated, and preserves unknown keys and body', () => {
    const written = store.writeFields(
      VALID_NOTE,
      { title: 'Renamed', provider: 'claude', model: 'sonnet', priority: '1 - high' },
      '2026-06-01T00:00:00.000Z',
    );

    const parsed = store.parse('tasks/task-1.md', written);
    expect(parsed.task.frontmatter.title).toBe('Renamed');
    expect(parsed.task.frontmatter.provider).toBe('claude');
    expect(parsed.task.frontmatter.model).toBe('sonnet');
    expect(parsed.task.frontmatter.priority).toBe('1 - high');
    expect(parsed.task.frontmatter.updated).toBe('2026-06-01T00:00:00.000Z');
    expect(parsed.task.frontmatter.custom_field).toBe('keep-me');
    expect(written).toContain('Intro prose that must stay.');
    expect(written).toContain('Closing prose.');
  });

  it('leaves omitted fields unchanged', () => {
    const written = store.writeFields(VALID_NOTE, { title: 'Only title' }, '2026-06-01T00:00:00.000Z');
    const parsed = store.parse('tasks/task-1.md', written);
    expect(parsed.task.frontmatter.title).toBe('Only title');
    expect(parsed.task.frontmatter.priority).toBe('2 - normal');
    expect(parsed.task.frontmatter.provider).toBeUndefined();
  });

  describe('writeStatus heartbeat + pause_reason', () => {
    const baseNote = `---
type: claudian-work-order
schema_version: 1
id: t1
title: T1
status: running
priority: 2 - normal
created: 2026-06-04T08:00:00.000Z
updated: 2026-06-04T08:00:00.000Z
attempts: 0
---
body`;

    it('writes heartbeat and pause_reason when provided', () => {
      const result = store.writeStatus(baseNote, {
        status: 'needs_input',
        timestamp: '2026-06-04T09:00:00.000Z',
        heartbeat: '2026-06-04T09:00:00.000Z',
        pauseReason: 'Which env file?',
      });
      const parsed = store.parse('t1.md', result);
      expect(parsed.task.frontmatter.status).toBe('needs_input');
      expect(parsed.task.frontmatter.heartbeat).toBe('2026-06-04T09:00:00.000Z');
      expect(parsed.task.frontmatter.pause_reason).toBe('Which env file?');
    });

    it('clears pause_reason on clearPause', () => {
      const paused = store.writeStatus(baseNote, {
        status: 'needs_input',
        timestamp: '2026-06-04T09:00:00.000Z',
        pauseReason: 'Which env file?',
      });
      const cleared = store.clearPause(paused, '2026-06-04T09:01:00.000Z');
      expect(cleared).toContain('pause_reason: null');
      const parsed = store.parse('t1.md', cleared);
      expect(parsed.task.frontmatter.status).toBe('running');
      expect(parsed.task.frontmatter.heartbeat).toBe('2026-06-04T09:01:00.000Z');
    });

    it('records finished and clears heartbeat when a run ends in review', () => {
      const running = store.writeStatus(baseNote, {
        status: 'running',
        started: '2026-06-04T09:00:00.000Z',
        heartbeat: '2026-06-04T09:00:30.000Z',
        timestamp: '2026-06-04T09:00:30.000Z',
      });
      const reviewed = store.writeStatus(running, { status: 'review', timestamp: '2026-06-04T09:05:00.000Z' });
      expect(reviewed).toContain('heartbeat: null');
      const parsed = store.parse('t1.md', reviewed);
      expect(parsed.task.frontmatter.status).toBe('review');
      expect(parsed.task.frontmatter.finished).toBe('2026-06-04T09:05:00.000Z');
    });

    it('clears the finished timestamp when a new run starts', () => {
      const ended = store.writeStatus(baseNote, { status: 'failed', timestamp: '2026-06-04T09:05:00.000Z' });
      const rerun = store.writeStatus(ended, {
        status: 'running',
        started: '2026-06-04T10:00:00.000Z',
        timestamp: '2026-06-04T10:00:00.000Z',
      });
      expect(rerun).toContain('finished: null');
    });

    it('clears heartbeat and pause_reason on terminal status', () => {
      const paused = store.writeStatus(baseNote, {
        status: 'needs_input',
        timestamp: '2026-06-04T09:00:00.000Z',
        heartbeat: '2026-06-04T09:00:00.000Z',
        pauseReason: 'Which env file?',
      });
      const done = store.writeStatus(paused, { status: 'done', timestamp: '2026-06-04T09:02:00.000Z' });
      expect(done).toContain('heartbeat: null');
      expect(done).toContain('pause_reason: null');
    });
  });

  describe('writeLedgerSnapshot', () => {
    const baseNote =
      '---\n' +
      'type: claudian-work-order\nschema_version: 1\nid: t\ntitle: t\nstatus: running\nupdated: x\n' +
      '---\n' +
      '## Objective\nx\n## Acceptance Criteria\n- [ ] a\n## Context\nx\n## Constraints\nx\n' +
      `${RUN_LEDGER_START}\n- old line\n${RUN_LEDGER_END}\n` +
      '<!-- claudian:handoff-start -->\n<!-- claudian:handoff-end -->\n';

    it('replaces the run-ledger region with the provided snapshot in one write', () => {
      const next = store.writeLedgerSnapshot(baseNote, '- 2026-06-06T... [running] new line');
      expect(next).toContain(`${RUN_LEDGER_START}\n- 2026-06-06T... [running] new line\n${RUN_LEDGER_END}`);
      expect(next).not.toContain('- old line');
    });

    it('rejects snapshots that embed claudian markers', () => {
      expect(() => store.writeLedgerSnapshot(baseNote, '<!-- claudian:run-ledger-start -->'))
        .toThrow(/Generated task region content cannot contain Claudian markers/);
    });

    it('throws when the note is missing run-ledger markers', () => {
      // A hand-edited note that dropped the generated region must not be
      // silently re-mangled. The thrown error is what AgentBoardView's
      // finalizeLedgerToNote try/catches into the best-effort path so the
      // run still settles even when the snapshot can't land.
      const noMarkers =
        '---\n' +
        'type: claudian-work-order\nschema_version: 1\nid: t\ntitle: t\nstatus: running\nupdated: x\n' +
        '---\n' +
        '## Objective\nx\n';
      expect(() => store.writeLedgerSnapshot(noMarkers, '- whatever'))
        .toThrow(/Missing generated region markers/);
    });
  });

});
