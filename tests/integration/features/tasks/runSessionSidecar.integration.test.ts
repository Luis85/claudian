import { RunSession } from '../../../../src/features/tasks/execution/RunSession';

describe('RunSession sidecar — work-order note is untouched between status transitions', () => {
  it('does not call writeStatus or writeHandoff for heartbeats or progress blocks', async () => {
    jest.useFakeTimers();

    const writeStatus = jest.fn().mockResolvedValue(undefined);
    const writeHandoff = jest.fn().mockResolvedValue(undefined);
    const writeHeartbeat = jest.fn().mockResolvedValue(undefined);
    const appendLedger = jest.fn().mockResolvedValue(undefined);
    const finalizeLedgerToNote = jest.fn().mockResolvedValue(undefined);

    // Fake stream that lets the test drive onText / onEnd directly. The adapter
    // shape only needs to satisfy ProviderStreamAdapter at the cast boundary.
    let listener!: { onText: (s: string) => void; onEnd: (p: { status: 'completed' | 'failed' | 'canceled'; finalAssistantContent: string; error?: string }) => void };
    const stream = {
      subscribe: (l: typeof listener) => { listener = l; return () => {}; },
      cancel: jest.fn(),
      sendFollowUp: jest.fn(),
    };

    const session = new RunSession({
      task: { path: 'wo.md', frontmatter: { id: 't', title: 't', attempts: 0 }, sections: {} } as never,
      runId: 'r',
      getConversationId: () => null,
      sidepanelTabId: null,
      stream: stream as never,
      events: { emit: jest.fn() } as never,
      now: () => '2026-06-06T12:00:00.000Z',
      writeStatus,
      writeHeartbeat,
      appendLedger,
      finalizeLedgerToNote,
      writeHandoff,
      heartbeatIntervalMs: 50,
      ledgerIntervalMs: 50,
      ledgerMilestone: 1,
    });

    void session.run();
    // Drain the initial fire-and-forget `running` status write.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    writeStatus.mockClear();

    // Tick the heartbeat once, emit a progress block, then tick several more
    // heartbeats. Through all of this the note must stay untouched: only the
    // sidecar (writeHeartbeat + appendLedger) is allowed to fire.
    jest.advanceTimersByTime(60);
    await Promise.resolve();
    await Promise.resolve();
    listener.onText('<claudian_progress>\nstep: scanning\ndone: 1/3\n</claudian_progress>');
    jest.advanceTimersByTime(120);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeStatus).not.toHaveBeenCalled();
    expect(writeHandoff).not.toHaveBeenCalled();
    expect(writeHeartbeat.mock.calls.length).toBeGreaterThan(0);
    expect(appendLedger.mock.calls.length).toBeGreaterThan(0);

    // Terminal: the handoff write to the note happens exactly once, and the
    // ledger is finalized into the note exactly once.
    listener.onText('<claudian_handoff>\nsummary: s\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>');
    listener.onEnd({
      status: 'completed',
      finalAssistantContent: '<claudian_handoff>\nsummary: s\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>',
    });
    await jest.runAllTimersAsync();

    expect(writeHandoff).toHaveBeenCalledTimes(1);
    expect(finalizeLedgerToNote).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});
