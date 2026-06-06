import { EventBus } from '../../../../../src/core/events/EventBus';
import type { TaskEventMap } from '../../../../../src/features/tasks/events';
import type { ProviderStreamAdapter, StreamHandlers } from '../../../../../src/features/tasks/execution/ProviderStreamAdapter';
import { RunSession } from '../../../../../src/features/tasks/execution/RunSession';
import type { TaskLedgerEntry, TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';
import { SyntheticStreamAdapter } from '../../../../helpers/SyntheticStreamAdapter';

/** Adapter that replays a completed run synchronously inside subscribe() (fast/local run). */
class ReplayOnSubscribeAdapter implements ProviderStreamAdapter {
  detached = false;
  subscribe(handlers: StreamHandlers): () => void {
    handlers.onText(VALID_HANDOFF);
    handlers.onEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    return () => { this.detached = true; };
  }
  async sendFollowUp(): Promise<void> {}
  cancel(): void {}
}

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
    getConversationId: () => 'conv-1',
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

  it('does not let a slow initial running write land after the terminal status', async () => {
    const writes: string[] = [];
    let releaseRunning!: () => void;
    const adapter = new SyntheticStreamAdapter();
    const events = new EventBus<TaskEventMap>();
    const session = new RunSession({
      task: makeTask(),
      runId: 'r',
      getConversationId: () => null,
      sidepanelTabId: null,
      stream: adapter,
      events,
      now: () => '2026-06-04T09:00:00Z',
      writeStatus: async (_t, options) => {
        if (options.status === 'running' && writes.length === 0) {
          // The initial running write is slow (e.g. a queued vault.process).
          await new Promise<void>((resolve) => { releaseRunning = resolve; });
        }
        writes.push(options.status);
      },
      flushLedger: async () => {},
      writeHandoff: async () => {},
      heartbeatIntervalMs: 100000,
      staleThresholdMs: 100000,
      ledgerIntervalMs: 100000,
      ledgerMilestone: 999,
    });
    const terminal = session.run();
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await Promise.resolve();
    releaseRunning();
    const result = await terminal;
    expect(result.ok).toBe(true);
    // 'review' must be written after 'running', never the other way around.
    expect(writes).toEqual(['running', 'review']);
  });

  it('settles as failed (no hang) when the terminal handoff write throws', async () => {
    const statuses: string[] = [];
    const adapter = new SyntheticStreamAdapter();
    const events = new EventBus<TaskEventMap>();
    const session = new RunSession({
      task: makeTask(),
      runId: 'r',
      getConversationId: () => null,
      sidepanelTabId: null,
      stream: adapter,
      events,
      now: () => '2026-06-04T09:00:00Z',
      writeStatus: async (_t, options) => { statuses.push(options.status); },
      flushLedger: async () => {},
      writeHandoff: async () => { throw new Error('missing markers'); },
      heartbeatIntervalMs: 100000,
      staleThresholdMs: 100000,
      ledgerIntervalMs: 100000,
      ledgerMilestone: 999,
    });
    const terminal = session.run();
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('failed');
  });

  it('does not let a slow initial running write revert a fast reject', async () => {
    const writes: string[] = [];
    let releaseRunning!: () => void;
    const adapter = new SyntheticStreamAdapter();
    const events = new EventBus<TaskEventMap>();
    const session = new RunSession({
      task: makeTask(),
      runId: 'r',
      getConversationId: () => null,
      sidepanelTabId: null,
      stream: adapter,
      events,
      now: () => '2026-06-04T09:00:00Z',
      writeStatus: async (_t, options) => {
        if (options.status === 'running' && writes.length === 0) {
          await new Promise<void>((resolve) => { releaseRunning = resolve; });
        }
        writes.push(options.status);
      },
      flushLedger: async () => {},
      writeHandoff: async () => {},
      heartbeatIntervalMs: 100000,
      staleThresholdMs: 100000,
      ledgerIntervalMs: 100000,
      ledgerMilestone: 999,
    });
    const terminal = session.run();
    adapter.emitText('<claudian_needs_approval>\naction: drop\n</claudian_needs_approval>');
    await Promise.resolve();
    const rejecting = session.resume({ kind: 'reject', reason: 'no' });
    await Promise.resolve();
    releaseRunning();
    await rejecting;
    const result = await terminal;
    expect(result.ok).toBe(false);
    // 'canceled' must be the last write — the late running write cannot revert it.
    expect(writes[writes.length - 1]).toBe('canceled');
  });

  it('fails with heartbeat lost when no events arrive within the stale threshold', async () => {
    jest.useFakeTimers();
    const { session, adapter, statuses } = makeSession({ staleThresholdMs: 2000, heartbeatIntervalMs: 500 });
    const terminal = session.run();
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('failed');
    // The stuck provider turn is cancelled so the chat tab is freed.
    expect(adapter.canceled).toBe(true);
    jest.useRealTimers();
  });

  it('does not stale (cancel) while a long-running tool is in flight', async () => {
    jest.useFakeTimers();
    const { session, adapter, statuses, handoffs } = makeSession({ staleThresholdMs: 2000, heartbeatIntervalMs: 500 });
    const terminal = session.run();
    adapter.emitToolUse({ name: 'Bash', primaryArg: 'npm run build' });
    // A long tool with no intervening chunks — well past the stale threshold.
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
    expect(statuses).not.toContain('failed');
    expect(adapter.canceled).toBe(false);
    expect(handoffs.length).toBe(0);
    // The tool finishes and the run completes normally.
    adapter.emitToolResult('Bash', true);
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('review');
    jest.useRealTimers();
  });

  it('binds the conversation id once it is created lazily (read live, not frozen at start)', async () => {
    // The conversation is created by the first chat turn, so it is null when the
    // run starts and becomes non-null afterward. Status writes must pick it up.
    let conversationId: string | null = null;
    const writes: Array<{ status: string; conversationId?: string | null }> = [];
    const adapter = new SyntheticStreamAdapter();
    const session = new RunSession({
      task: makeTask(),
      runId: 'r',
      getConversationId: () => conversationId,
      sidepanelTabId: null,
      stream: adapter,
      events: new EventBus<TaskEventMap>(),
      now: () => '2026-06-04T09:00:00Z',
      writeStatus: async (_t, options) => {
        writes.push({ status: options.status, conversationId: options.conversationId });
      },
      flushLedger: async () => {},
      writeHandoff: async () => {},
      heartbeatIntervalMs: 100000,
      staleThresholdMs: 100000,
      ledgerIntervalMs: 100000,
      ledgerMilestone: 999,
    });
    const terminal = session.run();
    // The send binds the conversation before the turn ends.
    conversationId = 'conv-late';
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await terminal;

    // Initial running write happened before binding -> no conversation id frozen.
    expect(writes[0]).toEqual({ status: 'running', conversationId: undefined });
    // Terminal write happened after binding -> the live id is persisted.
    expect(writes[writes.length - 1]).toEqual({ status: 'review', conversationId: 'conv-late' });
  });

  it('never persists a null conversation id, so a re-run cannot clear an existing binding', async () => {
    const writes: Array<{ status: string; conversationId?: string | null }> = [];
    const adapter = new SyntheticStreamAdapter();
    const session = new RunSession({
      task: makeTask(),
      runId: 'r',
      getConversationId: () => null,
      sidepanelTabId: null,
      stream: adapter,
      events: new EventBus<TaskEventMap>(),
      now: () => '2026-06-04T09:00:00Z',
      writeStatus: async (_t, options) => {
        writes.push({ status: options.status, conversationId: options.conversationId });
      },
      flushLedger: async () => {},
      writeHandoff: async () => {},
      heartbeatIntervalMs: 100000,
      staleThresholdMs: 100000,
      ledgerIntervalMs: 100000,
      ledgerMilestone: 999,
    });
    const terminal = session.run();
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await terminal;

    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.conversationId).toBeUndefined();
    }
  });

  it('complete() finalizes a completed run to review when no stream end arrived', async () => {
    // The chat turn settled completed (handoff present) but emitted no `done`.
    const { session, statuses, handoffs } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    session.complete(VALID_HANDOFF);
    const result = await terminal;
    expect(result).toEqual({ ok: true, status: 'review' });
    expect(statuses[statuses.length - 1]).toBe('review');
    expect(handoffs[0]).toContain('## Summary');
  });

  it('complete() is a no-op once the run has paused, so a stale initial terminal cannot finalize it', async () => {
    const { session, adapter, statuses } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: which?\n</claudian_needs_input>');
    await Promise.resolve();
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' }); // pause-turn end
    await Promise.resolve();
    expect(statuses[statuses.length - 1]).toBe('needs_input');

    // The initial chat terminal resolves completed with only the pause content;
    // completing from that stale snapshot would wrongly finalize a paused run.
    session.complete('asked');
    await Promise.resolve();
    expect(statuses[statuses.length - 1]).toBe('needs_input');

    await session.resume({ kind: 'reply', content: '.env' });
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result.ok).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('review');
  });

  it('complete() is a no-op once the run already settled via the stream', async () => {
    const { session, adapter, statuses } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await terminal;
    const count = statuses.length;
    session.complete('late terminal content'); // the terminal resolves after the stream end
    await Promise.resolve();
    expect(statuses.length).toBe(count);
    expect(statuses[statuses.length - 1]).toBe('review');
  });

  it('detaches the stream observer when a buffered chunk finishes the run synchronously during subscribe()', async () => {
    // A fast/local run replays its `done` inside subscribe(), so finish() runs
    // before run() has stored the unsubscribe handle; run() must still detach.
    const adapter = new ReplayOnSubscribeAdapter();
    const statuses: string[] = [];
    const session = new RunSession({
      task: makeTask(),
      runId: 'r',
      getConversationId: () => null,
      sidepanelTabId: null,
      stream: adapter,
      events: new EventBus<TaskEventMap>(),
      now: () => '2026-06-04T09:00:00Z',
      writeStatus: async (_t, options) => { statuses.push(options.status); },
      flushLedger: async () => {},
      writeHandoff: async () => {},
      heartbeatIntervalMs: 100000,
      staleThresholdMs: 100000,
      ledgerIntervalMs: 100000,
      ledgerMilestone: 999,
    });
    const result = await session.run();
    expect(result).toEqual({ ok: true, status: 'review' });
    expect(adapter.detached).toBe(true);
    expect(statuses).toEqual(['running', 'review']);
  });

  it('finishes a follow-up that settles ok even when it emits no stream done', async () => {
    const { session, adapter, statuses } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: which?\n</claudian_needs_input>');
    await Promise.resolve();
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' }); // pause-turn end
    await Promise.resolve();
    await session.resume({ kind: 'reply', content: 'go' });

    // The follow-up turn produces no stream done; it settles ok via its outcome.
    adapter.settleFollowUp({ ok: true, finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result).toEqual({ ok: true, status: 'review' });
    expect(statuses).toEqual(['running', 'needs_input', 'running', 'review']);
  });

  it('completes a follow-up via its own handoff even when the pause buffer is longer', async () => {
    const { session, adapter, statuses } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    // A long pause question, so finalContentBuffer exceeds the follow-up handoff.
    const longQuestion = 'which of these environment files should I use for the deployment configuration step here';
    adapter.emitText(`<claudian_needs_input>\nquestion: ${longQuestion}\n</claudian_needs_input>`);
    await Promise.resolve();
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' }); // pause-turn end
    await Promise.resolve();
    await session.resume({ kind: 'reply', content: '.env' });

    // The follow-up settles ok with a (shorter) valid handoff and no stream text.
    adapter.settleFollowUp({ ok: true, finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result).toEqual({ ok: true, status: 'review' });
    expect(statuses[statuses.length - 1]).toBe('review');
  });

  it('finishes a follow-up settling ok even if a late pause-turn done arrives after resume', async () => {
    const { session, adapter } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: q\n</claudian_needs_input>');
    await Promise.resolve();
    // User resumes before the pause-turn done arrives.
    await session.resume({ kind: 'reply', content: 'go' });
    // The late pause-turn done now arrives; it must be ignored, not finalize.
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' });
    await Promise.resolve();
    // The follow-up then settles ok without its own done — must still finish.
    adapter.settleFollowUp({ ok: true, finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result).toEqual({ ok: true, status: 'review' });
  });

  it('does not finish a follow-up that paused again, even though it settles ok', async () => {
    const { session, adapter, statuses } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: q1\n</claudian_needs_input>');
    await Promise.resolve();
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' }); // pause 1 turn end
    await Promise.resolve();
    await session.resume({ kind: 'reply', content: 'go' });

    // The follow-up re-pauses, emitting its own turn-end done (ignored by the counter).
    adapter.emitText('<claudian_needs_input>\nquestion: q2\n</claudian_needs_input>');
    await Promise.resolve();
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked2' });
    await Promise.resolve();
    // The follow-up sendMessage then settles ok — must NOT finalize the paused run.
    adapter.settleFollowUp({ ok: true, finalAssistantContent: 'asked2' });
    await Promise.resolve();
    expect(statuses[statuses.length - 1]).toBe('needs_input');

    session.cancel(); // clean up timers / resolve the terminal
    await terminal;
  });

  it('fails a follow-up that settles with an error', async () => {
    const { session, adapter, statuses } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: q\n</claudian_needs_input>');
    await Promise.resolve();
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' });
    await Promise.resolve();
    await session.resume({ kind: 'reply', content: 'go' });

    adapter.settleFollowUp({ ok: false, error: 'provider crashed' });
    const result = await terminal;
    expect(result.ok).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('failed');
  });

  it('does not fail a queued follow-up (no outcome); the queued turn finishes it later', async () => {
    const { session, adapter, statuses } = makeSession({ heartbeatIntervalMs: 100000, staleThresholdMs: 100000 });
    const terminal = session.run();
    adapter.emitText('<claudian_needs_input>\nquestion: q\n</claudian_needs_input>');
    await Promise.resolve();
    adapter.emitEnd({ status: 'completed', finalAssistantContent: 'asked' }); // pause-turn end
    await Promise.resolve();
    await session.resume({ kind: 'reply', content: 'go' });

    // The reply was queued (tab still streaming): no outcome is reported.
    adapter.settleFollowUp();
    await Promise.resolve();
    expect(statuses[statuses.length - 1]).toBe('running'); // not failed

    // The queued turn later runs and streams its own end.
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    const result = await terminal;
    expect(result).toEqual({ ok: true, status: 'review' });
  });
});
