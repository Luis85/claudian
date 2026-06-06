import type { ChatTabReservation } from '../../../../../src/core/chatTabReservations';
import { ChatTabReservations } from '../../../../../src/core/chatTabReservations';
import { EventBus } from '../../../../../src/core/events/EventBus';
import type { TaskEventMap } from '../../../../../src/features/tasks/events';
import { ActiveRunRegistry } from '../../../../../src/features/tasks/execution/activeRunRegistry';
import type {
  TaskExecutionSurface,
  TaskRunHandle,
  TaskRunOptions,
  TaskRunTerminal,
} from '../../../../../src/features/tasks/execution/TaskExecutionSurface';
import { TaskRunCoordinator, type TaskRunCoordinatorDeps } from '../../../../../src/features/tasks/execution/TaskRunCoordinator';
import type { TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';
import { SyntheticStreamAdapter } from '../../../../helpers/SyntheticStreamAdapter';

function makeTask(overrides: Partial<TaskSpec['frontmatter']> = {}): TaskSpec {
  return {
    path: 'Agent Board/tasks/example.md',
    raw: '',
    body: '',
    frontmatter: {
      type: 'claudian-work-order',
      schema_version: 1,
      id: 'task-1',
      title: 'Task 1',
      status: 'ready',
      priority: '2 - normal',
      created: '2026-05-28T18:00:00+02:00',
      updated: '2026-05-28T18:00:00+02:00',
      provider: 'codex',
      model: 'gpt-5-codex',
      attempts: 0,
      ...overrides,
    },
    sections: {
      objective: 'Do the work.',
      acceptanceCriteria: '- [ ] Done.',
      context: '[[Source]]',
      constraints: '- Stay focused.',
      ledger: '',
      handoff: '',
    },
  };
}

class FakeSurface implements TaskExecutionSurface {
  prompts: string[] = [];
  reservations: Array<ChatTabReservation | undefined> = [];
  readonly adapter = new SyntheticStreamAdapter();

  constructor(private readonly opts: { runId?: string; terminal?: TaskRunTerminal } = {}) {}

  async startTaskRun(_task: TaskSpec, options: TaskRunOptions): Promise<TaskRunHandle> {
    this.prompts.push(options.prompt);
    this.reservations.push(options.tabReservation);
    return {
      runId: this.opts.runId ?? 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      stream: this.adapter,
      // When a terminal is given, resolve it immediately (models a chat turn that
      // settled without a matching stream end). Otherwise resolve only after the
      // stream emits its end — as the real chat send does — so the stream drives
      // the finish and the terminal-completed fallback stays a no-op.
      terminal: this.opts.terminal
        ? Promise.resolve(this.opts.terminal)
        : this.adapter
            .whenEnded()
            .then((payload) => ({ status: 'completed' as const, finalAssistantContent: payload.finalAssistantContent })),
    };
  }
}

function makeCoordinator(
  surface: FakeSurface = new FakeSurface(),
  overrides: Partial<TaskRunCoordinatorDeps> = {},
) {
  const statuses: string[] = [];
  const ledgerMessages: string[] = [];
  const handoffs: string[] = [];
  const events = new EventBus<TaskEventMap>();
  const coordinator = new TaskRunCoordinator({
    executionSurface: surface,
    events,
    now: () => '2026-05-28T18:10:00+02:00',
    isProviderEnabled: () => true,
    ownsModel: () => true,
    writeTaskStatus: async (_t, options) => { statuses.push(options.status); },
    flushLedger: async (_t, entries) => { for (const e of entries) ledgerMessages.push(e.message); },
    writeHeartbeat: async () => {},
    appendLedger: async () => {},
    finalizeLedgerToNote: async () => {},
    writeHandoff: async (_t, markdown) => { handoffs.push(markdown); },
    ...overrides,
  });
  return { coordinator, statuses, ledgerMessages, handoffs, surface, events };
}

/** Lets coordinator.run() get past startTaskRun so the RunSession has subscribed. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const VALID_HANDOFF = `<claudian_handoff>
summary: Done.
verification: Tests passed.
risks: None known.
next_action: Review.
</claudian_handoff>`;

describe('TaskRunCoordinator', () => {
  it('blocks missing provider', async () => {
    const { coordinator, statuses } = makeCoordinator();
    await expect(coordinator.run(makeTask({ provider: undefined }))).resolves.toEqual({
      ok: false,
      error: 'Work order is missing provider',
    });
    expect(statuses).toEqual([]);
  });

  it('blocks missing model', async () => {
    const { coordinator } = makeCoordinator();
    await expect(coordinator.run(makeTask({ model: undefined }))).resolves.toEqual({
      ok: false,
      error: 'Work order is missing model',
    });
  });

  it('blocks already-running work orders', async () => {
    const { coordinator } = makeCoordinator();
    await expect(coordinator.run(makeTask({ status: 'running' }))).resolves.toEqual({
      ok: false,
      error: 'This work order is already running.',
    });
  });

  it('blocks disabled providers', async () => {
    const { coordinator } = makeCoordinator(new FakeSurface(), { isProviderEnabled: () => false });
    await expect(coordinator.run(makeTask())).resolves.toEqual({
      ok: false,
      error: 'Provider codex is not enabled',
    });
  });

  it('blocks unavailable models', async () => {
    const { coordinator } = makeCoordinator(new FakeSurface(), { ownsModel: () => false });
    await expect(coordinator.run(makeTask())).resolves.toEqual({
      ok: false,
      error: 'Model gpt-5-codex is not available for provider codex',
    });
  });

  it('returns the terminal error (flagged startupFailed) when the surface could not start a run', async () => {
    const surface = new FakeSurface({ runId: '', terminal: { status: 'failed', finalAssistantContent: '', error: 'tab cap' } });
    const { coordinator, statuses } = makeCoordinator(surface);
    await expect(coordinator.run(makeTask())).resolves.toEqual({ ok: false, error: 'tab cap', startupFailed: true });
    expect(statuses).toEqual([]);
  });

  it('fails promptly when the chat terminal fails without a stream end', async () => {
    // Handle is created (runId set) but the turn settles failed and the adapter
    // never emits a stream end — the terminal failure must drive the finish.
    const surface = new FakeSurface({ terminal: { status: 'failed', finalAssistantContent: '', error: 'provider init failed' } });
    const { coordinator, statuses } = makeCoordinator(surface);
    const result = await coordinator.run(makeTask());
    expect(result).toEqual({ ok: false, error: 'provider init failed' });
    expect(statuses[statuses.length - 1]).toBe('failed');
  });

  it('finishes a run whose terminal completes with a handoff but emits no stream end', async () => {
    // The provider settled the turn `completed` (handoff present) without ever
    // emitting a `done` chunk; the terminal must drive the finish to review
    // instead of leaving the run hanging until the stale timer.
    const surface = new FakeSurface({ terminal: { status: 'completed', finalAssistantContent: VALID_HANDOFF } });
    const { coordinator, statuses, handoffs } = makeCoordinator(surface);
    await expect(coordinator.run(makeTask())).resolves.toEqual({ ok: true, status: 'review' });
    expect(statuses).toEqual(['running', 'review']);
    expect(handoffs[0]).toContain('## Summary');
  });

  it('implicit-pauses (needs_input) when the terminal completes with content but no handoff and no stream end', async () => {
    const surface = new FakeSurface({ terminal: { status: 'completed', finalAssistantContent: 'no handoff' } });
    const { coordinator, statuses } = makeCoordinator(surface);
    const p = coordinator.run(makeTask());
    // Yield enough for the terminal-driven complete() → beginImplicitPause to apply.
    await flushMicrotasks();
    await flushMicrotasks();
    expect(statuses).toEqual(['running', 'needs_input']);
    // Run stays alive until either the assistant emits a handoff or the user cancels.
    coordinator.getActiveRun('task-1')?.cancel('test cleanup');
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: 'canceled', canceled: true });
  });

  it('does not double-finalize: a completed terminal is a no-op once the stream already ended', async () => {
    // Default surface resolves the terminal only after emitEnd (as the real send
    // does), so the stream-driven review wins and the terminal-completed fallback
    // is a no-op — the run settles exactly once.
    const { coordinator, statuses, surface } = makeCoordinator();
    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    surface.adapter.emitText(VALID_HANDOFF);
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await expect(p).resolves.toEqual({ ok: true, status: 'review' });
    expect(statuses).toEqual(['running', 'review']);
  });

  it('delegates a clean run to RunSession: running -> review with handoff', async () => {
    const { coordinator, statuses, handoffs, surface } = makeCoordinator();
    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    surface.adapter.emitText(VALID_HANDOFF);
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });

    await expect(p).resolves.toEqual({ ok: true, status: 'review' });
    expect(statuses).toEqual(['running', 'review']);
    expect(handoffs[0]).toContain('## Summary');
    expect(surface.prompts[0]).toContain('Task ID: task-1');
  });

  it('delegates a completed run with no handoff to an implicit needs_input pause that stays alive', async () => {
    const { coordinator, statuses, surface } = makeCoordinator();
    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    surface.adapter.emitText('No handoff here.');
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: 'No handoff here.' });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(statuses).toEqual(['running', 'needs_input']);
    expect(coordinator.getActiveRun('task-1')).toBeDefined();
    // Settle the still-alive run so the test doesn't hang.
    coordinator.getActiveRun('task-1')?.cancel('test cleanup');
    await expect(p).resolves.toEqual({ ok: false, error: 'canceled', canceled: true });
  });

  it('exposes the active run while in flight and clears it afterwards', async () => {
    const { coordinator, surface } = makeCoordinator();
    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    expect(coordinator.getActiveRun('task-1')).toBeDefined();
    surface.adapter.emitText(VALID_HANDOFF);
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await p;
    expect(coordinator.getActiveRun('task-1')).toBeUndefined();
  });

  it('reports a canceled run with canceled: true (so the queue does not count it as a failure)', async () => {
    const surface = new FakeSurface({ terminal: { status: 'canceled', finalAssistantContent: '' } });
    const { coordinator, statuses } = makeCoordinator(surface);
    await expect(coordinator.run(makeTask())).resolves.toEqual({
      ok: false,
      error: 'canceled',
      canceled: true,
    });
    expect(statuses[statuses.length - 1]).toBe('canceled');
  });

  it('rejects a concurrent run of the same work order while the first is still starting', async () => {
    let releaseStart!: () => void;
    const adapter = new SyntheticStreamAdapter();
    let startCalls = 0;
    const surface: TaskExecutionSurface = {
      startTaskRun: async (): Promise<TaskRunHandle> => {
        startCalls += 1;
        await new Promise<void>((resolve) => { releaseStart = resolve; });
        return {
          runId: 'run-1',
          conversationId: 'c',
          sidepanelTabId: 't',
          stream: adapter,
          terminal: Promise.resolve({ status: 'completed', finalAssistantContent: '' } as TaskRunTerminal),
        };
      },
    };
    const coordinator = new TaskRunCoordinator({
      executionSurface: surface,
      events: new EventBus<TaskEventMap>(),
      now: () => '2026-05-28T18:10:00+02:00',
      isProviderEnabled: () => true,
      ownsModel: () => true,
      writeTaskStatus: async () => {},
      flushLedger: async () => {},
      writeHeartbeat: async () => {},
      appendLedger: async () => {},
      finalizeLedgerToNote: async () => {},
      writeHandoff: async () => {},
    });

    const task = makeTask();
    const first = coordinator.run(task);
    const second = await coordinator.run(task);
    expect(second).toEqual({ ok: false, error: 'This work order is already running.' });
    expect(startCalls).toBe(1);

    releaseStart();
    await flushMicrotasks();
    adapter.emitText(VALID_HANDOFF);
    adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await first;
  });

  it('rejects a run already held in a shared run registry (another view)', async () => {
    const shared = new ActiveRunRegistry();
    shared.reserve('task-1'); // another coordinator/view is running it
    const { coordinator } = makeCoordinator(new FakeSurface(), { runRegistry: shared });
    await expect(coordinator.run(makeTask())).resolves.toEqual({
      ok: false,
      error: 'This work order is already running.',
    });
  });

  it('uses an injected renderPrompt when provided', async () => {
    const surface = new FakeSurface();
    const { coordinator } = makeCoordinator(surface, { renderPrompt: () => 'INJECTED PROMPT' });
    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    surface.adapter.emitText(VALID_HANDOFF);
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await p;
    expect(surface.prompts[0]).toBe('INJECTED PROMPT');
  });

  it('forwards sidecar hooks (writeHeartbeat, appendLedger, finalizeLedgerToNote) to RunSession', async () => {
    jest.useFakeTimers();
    try {
      const writeHeartbeat = jest.fn(async (_runId: string, _hb: unknown) => {});
      const appendLedger = jest.fn(async (_task: TaskSpec, _runId: string, _entry: unknown) => {});
      const finalizeLedgerToNote = jest.fn(async (_task: TaskSpec, _runId: string) => {});
      const surface = new FakeSurface();
      const { coordinator } = makeCoordinator(surface, {
        writeHeartbeat,
        appendLedger,
        finalizeLedgerToNote,
        heartbeatIntervalMs: 10,
        staleThresholdMs: 100_000,
      });
      const p = coordinator.run(makeTask());
      await Promise.resolve();
      await Promise.resolve();
      // Force one heartbeat tick so the wired writeHeartbeat fires.
      jest.advanceTimersByTime(15);
      surface.adapter.emitText(VALID_HANDOFF);
      surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
      await p;

      // The sidecar ledger receives at least the run-start and the terminal handoff entries.
      expect(appendLedger).toHaveBeenCalled();
      const firstAppend = appendLedger.mock.calls[0];
      expect(firstAppend[0].frontmatter.id).toBe('task-1');
      expect(firstAppend[1]).toBe('run-1');
      // The terminal finalize stamps the sidecar ledger back into the note exactly once.
      expect(finalizeLedgerToNote).toHaveBeenCalledTimes(1);
      expect(finalizeLedgerToNote).toHaveBeenCalledWith(
        expect.objectContaining({ frontmatter: expect.objectContaining({ id: 'task-1' }) }),
        'run-1',
      );
      // The heartbeat dep is wired and runId-keyed (no task arg).
      expect(writeHeartbeat).toHaveBeenCalled();
      expect(writeHeartbeat.mock.calls[0][0]).toBe('run-1');
      expect(writeHeartbeat.mock.calls[0][1]).toEqual(
        expect.objectContaining({ status: 'running', at: expect.any(String) }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('TaskRunCoordinator.isActive', () => {
  it('reports false for ids not in flight', () => {
    const { coordinator } = makeCoordinator();
    expect(coordinator.isActive('task-1')).toBe(false);
  });

  it('reports true while a run is in flight and false after it settles', async () => {
    const surface = new FakeSurface();
    const { coordinator } = makeCoordinator(surface);
    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    expect(coordinator.isActive('task-1')).toBe(true);
    surface.adapter.emitText(VALID_HANDOFF);
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await p;
    expect(coordinator.isActive('task-1')).toBe(false);
  });
});

describe('TaskRunCoordinator — shared activeRuns', () => {
  it('two coordinators sharing a set observe each others in-flight runs', async () => {
    const shared = new Set<string>();
    const surfaceA = new FakeSurface();
    const { coordinator: a } = makeCoordinator(surfaceA, { activeRuns: shared });
    const { coordinator: b } = makeCoordinator(new FakeSurface(), { activeRuns: shared });

    const p = a.run(makeTask());
    await flushMicrotasks();
    // The run started in `a` is visible to `b` through the shared set.
    expect(b.isActive('task-1')).toBe(true);
    // And `b` refuses to launch the same card while it is in flight elsewhere.
    await expect(b.run(makeTask())).resolves.toEqual({
      ok: false,
      error: 'This work order is already running.',
    });
    surfaceA.adapter.emitText(VALID_HANDOFF);
    surfaceA.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await p;
    expect(b.isActive('task-1')).toBe(false);
  });
});

describe('TaskRunCoordinator — shared chat-tab reservations', () => {
  it('reserves a tab before the run, passes it to the surface, and releases it after', async () => {
    const reservations = new ChatTabReservations();
    const surface = new FakeSurface();
    const { coordinator } = makeCoordinator(surface, { reservations });

    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    // The reservation is taken synchronously at launch, visible to other panes.
    expect(reservations.pending).toBe(1);
    expect(surface.reservations[0]).toBeDefined();
    surface.adapter.emitText(VALID_HANDOFF);
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await p;
    // Released once the run settles (here via the finally safety net).
    expect(reservations.pending).toBe(0);
  });

  it('does not reserve when a guard rejects the run before launch', async () => {
    const reservations = new ChatTabReservations();
    const { coordinator } = makeCoordinator(new FakeSurface(), { reservations });
    await coordinator.run(makeTask({ provider: undefined }));
    expect(reservations.pending).toBe(0);
  });

  it('stays balanced when the surface also releases (idempotent with the finally)', async () => {
    const reservations = new ChatTabReservations();
    const surface = new FakeSurface();
    // Mirror the chat view releasing the reservation at tab creation, mid-run.
    const startTaskRun = surface.startTaskRun.bind(surface);
    surface.startTaskRun = (task, options) => {
      options.tabReservation?.release();
      return startTaskRun(task, options);
    };
    const { coordinator } = makeCoordinator(surface, { reservations });

    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    surface.adapter.emitText(VALID_HANDOFF);
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: VALID_HANDOFF });
    await p;
    expect(reservations.pending).toBe(0);
  });
});
