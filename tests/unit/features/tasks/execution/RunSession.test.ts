import { EventBus } from '../../../../../src/core/events/EventBus';
import type { TaskEventMap } from '../../../../../src/features/tasks/events';
import { RunSession } from '../../../../../src/features/tasks/execution/RunSession';
import type { TaskLedgerEntry, TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';
import { SyntheticStreamAdapter } from '../../../../helpers/SyntheticStreamAdapter';

const VALID_HANDOFF = `<claudian_handoff>
summary: Done.
verification: Tests pass.
risks: None.
next_action: Review.
</claudian_handoff>`;

function makeTask(overrides: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: 'Agent Board/tasks/t1.md',
    raw: '',
    body: '',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 't1',
      title: 'T1',
      status: 'ready',
      priority: '2 - normal',
      created: '2026-06-04T08:00:00Z',
      updated: '2026-06-04T08:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      attempts: 0,
      ...overrides,
    },
    sections: {
      objective: 'Do',
      acceptanceCriteria: '- [ ] x',
      context: '',
      constraints: '',
      ledger: '',
      handoff: '',
    },
  };
}

function makeSession(overrides: Partial<ConstructorParameters<typeof RunSession>[0]> = {}) {
  const adapter = new SyntheticStreamAdapter();
  const events = new EventBus<TaskEventMap>();
  const statuses: string[] = [];
  const ledger: TaskLedgerEntry[] = [];
  const handoffs: string[] = [];
  const session = new RunSession({
    task: makeTask(),
    runId: 'run-1',
    conversationId: 'conv-1',
    sidepanelTabId: 'tab-1',
    stream: adapter,
    events,
    now: () => '2026-06-04T09:00:00Z',
    writeStatus: async (_t, options) => { statuses.push(options.status); },
    flushLedger: async (entries) => { ledger.push(...entries); },
    writeHandoff: async (_t, md) => { handoffs.push(md); },
    heartbeatIntervalMs: 1000,
    staleThresholdMs: 5000,
    ledgerIntervalMs: 1000,
    ledgerMilestone: 999,
    ...overrides,
  });
  return { session, adapter, events, statuses, ledger, handoffs };
}

describe('RunSession', () => {
  it('writes running status + Run started ledger, then handles a clean end-to-end run', async () => {
    const { session, adapter, statuses, ledger, handoffs } = makeSession();
    const terminal = session.run();
    expect(statuses[0]).toBe('running');
    adapter.emitText('Working… ');
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'Working… ' + VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(statuses).toEqual(['running', 'review']);
    expect(ledger.map((e) => e.message)).toEqual(expect.arrayContaining(['Run started (attempt 1)', 'Handoff written.']));
    expect(handoffs.length).toBe(1);
  });

  it('transitions to needs_input on <claudian_needs_input> and resumes via sendFollowUp', async () => {
    jest.useFakeTimers();
    const { session, adapter, events, statuses, ledger } = makeSession();
    const seen: TaskEventMap['task:needs-input'][] = [];
    events.on('task:needs-input', (p) => seen.push(p));
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: which env?\n</claudian_needs_input>');
    await Promise.resolve();
    expect(statuses).toEqual(['running', 'needs_input']);
    expect(seen[0].question).toBe('which env?');
    // The pause turn ends with its own stream-end; it must be ignored.
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' });
    await Promise.resolve();
    await session.resume({ kind: 'reply', content: '.env.local' });
    expect(adapter.followUps).toEqual(['.env.local']);
    expect(statuses).toEqual(['running', 'needs_input', 'running']);
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await terminal;
    expect(ledger.find((e) => e.message.startsWith('resumed:'))).toBeTruthy();
    jest.useRealTimers();
  });

  it('ignores the late pause-turn end after a fast resume', async () => {
    jest.useFakeTimers();
    const { session, adapter, statuses, handoffs } = makeSession();
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: which env?\n</claudian_needs_input>');
    await Promise.resolve();
    // User resumes BEFORE the pause turn's own `done` arrives.
    await session.resume({ kind: 'reply', content: '.env.local' });
    expect(statuses).toEqual(['running', 'needs_input', 'running']);
    // The late pause-turn `done` arrives now — it must not finalize the run.
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' });
    await Promise.resolve();
    expect(handoffs.length).toBe(0);
    // The real follow-up turn then completes with a handoff.
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('review');
    jest.useRealTimers();
  });

  it('rejected approval cancels the run with reason', async () => {
    const { session, adapter, statuses, ledger } = makeSession();
    const terminal = session.run();
    adapter.emitText('<claudian_needs_approval>\naction: drop table\n</claudian_needs_approval>');
    await Promise.resolve();
    await session.resume({ kind: 'reject', reason: 'too risky' });
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses).toEqual(['running', 'needs_approval', 'canceled']);
    expect(ledger.find((e) => e.message.includes('rejected: too risky'))).toBeTruthy();
  });

  it('lands in needs_handoff when stream completes with content but no handoff block', async () => {
    const { session, adapter, statuses } = makeSession();
    const terminal = session.run();
    adapter.emitText('did stuff but no handoff');
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'did stuff but no handoff' });
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses).toEqual(['running', 'needs_handoff']);
  });

  it('ignores a completed stream end while paused and finalizes only after resume', async () => {
    jest.useFakeTimers();
    const { session, adapter, statuses, handoffs } = makeSession();
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: which env?\n</claudian_needs_input>');
    await Promise.resolve();
    expect(statuses).toEqual(['running', 'needs_input']);
    // The pause turn ends with its own stream-end; this must NOT finalize the run.
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' });
    await Promise.resolve();
    expect(statuses).toEqual(['running', 'needs_input']);
    expect(handoffs.length).toBe(0);

    await session.resume({ kind: 'reply', content: '.env.local' });
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(statuses).toEqual(['running', 'needs_input', 'running', 'review']);
    jest.useRealTimers();
  });

  it('fails with heartbeat lost when no events arrive within the stale threshold', async () => {
    jest.useFakeTimers();
    const { session, statuses } = makeSession({ staleThresholdMs: 2000, heartbeatIntervalMs: 500 });
    const terminal = session.run();
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('failed');
    jest.useRealTimers();
  });
});
