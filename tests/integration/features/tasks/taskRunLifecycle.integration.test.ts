import { EventBus } from '../../../../src/core/events/EventBus';
import type { TaskEventMap } from '../../../../src/features/tasks/events';
import { RunSession } from '../../../../src/features/tasks/execution/RunSession';
import type { TaskSpec } from '../../../../src/features/tasks/model/taskTypes';
import {
  HANDOFF_END,
  HANDOFF_START,
  RUN_LEDGER_END,
  RUN_LEDGER_START,
  TaskNoteStore,
} from '../../../../src/features/tasks/storage/TaskNoteStore';
import { SyntheticStreamAdapter } from '../../../helpers/SyntheticStreamAdapter';

const VALID_HANDOFF = `<specorator_handoff>
summary: Did the work.
verification: Tests pass.
risks: None.
next_action: Review.
</specorator_handoff>`;

const PATH = 'Agent Board/tasks/t1.md';

function makeNote(overrides: { status?: string; ledger?: string } = {}): string {
  return `---
type: specorator-work-order
schema_version: 1
id: t1
title: Integration task
status: ${overrides.status ?? 'ready'}
priority: 2 - normal
created: 2026-06-04T08:00:00.000Z
updated: 2026-06-04T08:00:00.000Z
provider: claude
model: claude-sonnet-4-5
attempts: 0
---
# Integration task

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
${overrides.ledger ?? ''}
${RUN_LEDGER_END}

## Result / Handoff

${HANDOFF_START}
${HANDOFF_END}
`;
}

function makeHarness(initialNote = makeNote()) {
  const store = new TaskNoteStore();
  let note = initialNote;
  const events = new EventBus<TaskEventMap>();
  const adapter = new SyntheticStreamAdapter();
  const statuses: string[] = [];
  const task = store.parse(PATH, note).task as TaskSpec;
  // Simulate the production sidecar: appendLedger captures entries in memory,
  // finalizeLedgerToNote snapshots them into the note's run-ledger region.
  const sidecarLedger: Array<{ timestamp: string; status: string; message: string }> = [];
  const session = new RunSession({
    task,
    runId: 'run-1',
    getConversationId: () => 'conv-1',
    sidepanelTabId: 'tab-1',
    stream: adapter,
    events,
    now: () => '2026-06-04T09:00:00.000Z',
    writeStatus: async (_t, options) => {
      statuses.push(options.status);
      note = store.writeStatus(note, options);
    },
    writeHeartbeat: async () => {
      // Sidecar heartbeat is irrelevant to these note-state assertions; no-op.
    },
    appendLedger: async (_runId, entry) => {
      sidecarLedger.push(entry);
    },
    finalizeLedgerToNote: async () => {
      const markdown = sidecarLedger
        .map((e) => `- ${e.timestamp} [${e.status}] ${e.message}`)
        .join('\n');
      if (markdown.length === 0) return;
      note = store.writeLedgerSnapshot(note, markdown);
    },
    writeHandoff: async (_t, markdown) => {
      note = store.writeHandoff(note, markdown);
    },
    heartbeatIntervalMs: 1000,
    staleThresholdMs: 5000,
    ledgerIntervalMs: 1000,
    ledgerMilestone: 999,
  });
  return {
    store,
    session,
    adapter,
    events,
    statuses,
    parsed: () => store.parse(PATH, note).task,
    rawNote: () => note,
    sidecarMessages: () => sidecarLedger.map((e) => e.message),
  };
}

describe('work-order run lifecycle (integration)', () => {
  it('happy path: running -> review with a complete ledger and handoff', async () => {
    const h = makeHarness();
    const terminal = h.session.run();
    h.adapter.emitText('Working… ');
    h.adapter.emitToolUse({ name: 'Edit', primaryArg: 'src/foo.ts' });
    h.adapter.emitText('<specorator_progress>\nstep: editing files\ndone: 1/2\n</specorator_progress>');
    h.adapter.emitText(VALID_HANDOFF);
    h.adapter.emitEnd({ status: 'completed', finalAssistantContent: `Working… ${VALID_HANDOFF}` });

    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(h.statuses).toEqual(['running', 'review']);
    const parsed = h.parsed();
    expect(parsed.frontmatter.status).toBe('review');
    expect(parsed.frontmatter.started).toBe('2026-06-04T09:00:00.000Z');
    expect(parsed.sections.ledger).toContain('Run started (attempt 1)');
    expect(parsed.sections.ledger).toContain('tool: Edit src/foo.ts');
    expect(parsed.sections.ledger).toContain('progress: editing files');
    expect(parsed.sections.ledger).toContain('Handoff written.');
    expect(parsed.sections.handoff).toContain('## Summary');
    expect(parsed.sections.handoff).toContain('Did the work.');
  });

  it('needs_input: pauses, persists the question, resumes via reply, completes', async () => {
    jest.useFakeTimers();
    const h = makeHarness();
    const inputs: TaskEventMap['task:needs-input'][] = [];
    h.events.on('task:needs-input', (p) => inputs.push(p));
    const terminal = h.session.run();
    h.adapter.emitText('<specorator_needs_input>\nquestion: which env file?\nwhy: ambiguous\n</specorator_needs_input>');
    await Promise.resolve();
    h.adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' }); // pause-turn end
    await Promise.resolve();

    expect(h.parsed().frontmatter.status).toBe('needs_input');
    expect(h.parsed().frontmatter.pause_reason).toBe('which env file?');
    expect(inputs[0].question).toBe('which env file?');

    await h.session.resume({ kind: 'reply', content: '.env.local' });
    expect(h.adapter.followUps).toEqual(['.env.local']);
    h.adapter.emitText(VALID_HANDOFF);
    h.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await terminal;

    expect(h.statuses).toEqual(['running', 'needs_input', 'running', 'review']);
    expect(h.parsed().frontmatter.status).toBe('review');
    jest.useRealTimers();
  });

  it('needs_approval: approve resumes the run to review', async () => {
    const h = makeHarness();
    const terminal = h.session.run();
    h.adapter.emitText('<specorator_needs_approval>\naction: delete dist/\nrisk: high\n</specorator_needs_approval>');
    await Promise.resolve();
    h.adapter.emitEnd({ status: 'completed', finalAssistantContent: 'requesting' });
    await Promise.resolve();
    expect(h.parsed().frontmatter.status).toBe('needs_approval');

    await h.session.resume({ kind: 'approve' });
    expect(h.adapter.followUps).toEqual(['approved']);
    h.adapter.emitText(VALID_HANDOFF);
    h.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(h.parsed().frontmatter.status).toBe('review');
  });

  it('needs_approval: reject cancels the run with the reason in the ledger', async () => {
    const h = makeHarness();
    const terminal = h.session.run();
    h.adapter.emitText('<specorator_needs_approval>\naction: drop table\n</specorator_needs_approval>');
    await Promise.resolve();
    await h.session.resume({ kind: 'reject', reason: 'too destructive' });
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(h.parsed().frontmatter.status).toBe('canceled');
    expect(h.parsed().sections.ledger).toContain('rejected: too destructive');
  });

  it('implicit needs_input: completed content without a handoff block keeps the run alive and pauses for follow-up', async () => {
    const h = makeHarness();
    const terminal = h.session.run();
    h.adapter.emitText('Which folder should I scaffold under?');
    h.adapter.emitEnd({
      status: 'completed',
      finalAssistantContent: 'Which folder should I scaffold under?',
    });
    // Drain the implicit-pause async chain: persistStatus, ledger.flushNow, and
    // the per-entry appendLedger awaits inside the flush callback.
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.parsed().frontmatter.status).toBe('needs_input');
    // Mid-run, the ledger lives in the sidecar; the note's run-ledger region
    // is rewritten only at terminal (via finalizeLedgerToNote).
    expect(h.sidecarMessages().some((m) => m.startsWith('Paused implicitly'))).toBe(true);
    // Resume with a follow-up turn that produces a real handoff → review.
    await h.session.resume({ kind: 'reply', content: 'src/foo' });
    h.adapter.emitText(VALID_HANDOFF);
    h.adapter.emitEnd({
      status: 'completed',
      finalAssistantContent: 'Which folder should I scaffold under?' + VALID_HANDOFF,
    });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(h.parsed().frontmatter.status).toBe('review');
    // After terminal, the note's run-ledger contains the implicit-pause line too.
    expect(h.parsed().sections.ledger).toContain('Paused implicitly');
  });

  it('heartbeat lost: stale stream fails the run', async () => {
    jest.useFakeTimers();
    const h = makeHarness();
    const terminal = h.session.run();
    // Harness stale threshold is 5000ms; advance past it with no events.
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(h.parsed().frontmatter.status).toBe('failed');
    expect(h.parsed().sections.ledger).toContain('heartbeat lost');
    jest.useRealTimers();
  });

  it('cancel during pause: cancels with the stopped-by-user reason', async () => {
    const h = makeHarness();
    const terminal = h.session.run();
    h.adapter.emitText('<specorator_needs_input>\nquestion: which env?\n</specorator_needs_input>');
    await Promise.resolve();
    h.session.cancel();
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(h.parsed().frontmatter.status).toBe('canceled');
    expect(h.parsed().sections.ledger).toContain('stopped by user');
  });

  it('malformed protocol block: warns, keeps running, then completes normally', async () => {
    const h = makeHarness();
    const warnings: TaskEventMap['task:parser-warning'][] = [];
    h.events.on('task:parser-warning', (p) => warnings.push(p));
    const terminal = h.session.run();
    h.adapter.emitText('<specorator_needs_input>\nwhy: no question here\n</specorator_needs_input>');
    h.adapter.emitText(VALID_HANDOFF);
    h.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(h.parsed().frontmatter.status).toBe('review');
    expect(warnings.map((w) => w.warning)).toContain('needs_input missing required field: question');
    expect(h.parsed().sections.ledger).toContain('(parser) needs_input missing required field: question');
  });
});
