import { ChatTabReservations } from '../../../../../src/core/chatTabReservations';
import type { TaskExecutionSurface, TaskRunHandle } from '../../../../../src/features/tasks/execution/TaskExecutionSurface';
import { TaskRunCoordinator } from '../../../../../src/features/tasks/execution/TaskRunCoordinator';
import type { TaskSpec } from '../../../../../src/features/tasks/model/taskTypes';

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

  constructor(private readonly handle: TaskRunHandle) {}

  async startTaskRun(_task: TaskSpec, options: { prompt: string }): Promise<TaskRunHandle> {
    this.prompts.push(options.prompt);
    return this.handle;
  }
}

function makeCoordinator(handle: TaskRunHandle) {
  const statuses: string[] = [];
  const ledgerMessages: string[] = [];
  const handoffs: string[] = [];
  const surface = new FakeSurface(handle);
  const coordinator = new TaskRunCoordinator({
    executionSurface: surface,
    now: () => '2026-05-28T18:10:00+02:00',
    isProviderEnabled: () => true,
    ownsModel: () => true,
    writeTaskStatus: async (_task, options) => { statuses.push(options.status); },
    appendLedger: async (_task, entry) => { ledgerMessages.push(entry.message); },
    writeHandoff: async (_task, markdown) => { handoffs.push(markdown); },
  });
  return { coordinator, statuses, ledgerMessages, handoffs, surface };
}

const VALID_HANDOFF = `<claudian_handoff>
summary: Done.
verification: Tests passed.
risks: None known.
next_action: Review.
</claudian_handoff>`;

describe('TaskRunCoordinator', () => {
  it('blocks missing provider', async () => {
    const { coordinator, statuses } = makeCoordinator({
      status: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: VALID_HANDOFF,
    });

    await expect(coordinator.run(makeTask({ provider: undefined }))).resolves.toEqual({
      ok: false,
      error: 'Work order is missing provider',
    });
    expect(statuses).toEqual([]);
  });

  it('blocks missing model', async () => {
    const { coordinator } = makeCoordinator({
      status: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: VALID_HANDOFF,
    });

    await expect(coordinator.run(makeTask({ model: undefined }))).resolves.toEqual({
      ok: false,
      error: 'Work order is missing model',
    });
  });

  it('blocks already-running work orders', async () => {
    const { coordinator } = makeCoordinator({
      status: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: VALID_HANDOFF,
    });

    await expect(coordinator.run(makeTask({ status: 'running' }))).resolves.toEqual({
      ok: false,
      error: 'This work order is already running.',
    });
  });

  it('transitions ready to running to review on valid handoff', async () => {
    const { coordinator, statuses, handoffs, surface } = makeCoordinator({
      status: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: VALID_HANDOFF,
    });

    await expect(coordinator.run(makeTask())).resolves.toEqual({ ok: true, status: 'review' });
    expect(statuses).toEqual(['running', 'review']);
    expect(handoffs[0]).toContain('## Summary');
    expect(surface.prompts[0]).toContain('Task ID: task-1');
  });

  it('transitions running to failed when completed content has no handoff', async () => {
    const { coordinator, statuses } = makeCoordinator({
      status: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: 'No handoff here.',
    });

    await expect(coordinator.run(makeTask())).resolves.toEqual({
      ok: false,
      error: 'Missing claudian_handoff block',
    });
    expect(statuses).toEqual(['running', 'failed']);
  });

  it('transitions running to canceled when execution is canceled', async () => {
    const { coordinator, statuses } = makeCoordinator({
      status: 'canceled',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: '',
    });

    await expect(coordinator.run(makeTask())).resolves.toEqual({
      ok: false,
      error: 'Run canceled.',
      canceled: true,
    });
    expect(statuses).toEqual(['running', 'canceled']);
  });

  it('uses an injected renderPrompt when provided', async () => {
    const surface = new FakeSurface({
      status: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: VALID_HANDOFF,
    });
    const coordinator = new TaskRunCoordinator({
      executionSurface: surface,
      now: () => '2026-05-28T18:10:00+02:00',
      isProviderEnabled: () => true,
      ownsModel: () => true,
      writeTaskStatus: async () => {},
      appendLedger: async () => {},
      writeHandoff: async () => {},
      renderPrompt: () => 'INJECTED PROMPT',
    });

    await coordinator.run(makeTask());
    expect(surface.prompts[0]).toBe('INJECTED PROMPT');
  });
});

describe('TaskRunCoordinator.isActive', () => {
  it('reports false for ids not in flight', () => {
    const { coordinator } = makeCoordinator({
      status: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      finalAssistantContent: VALID_HANDOFF,
    });
    expect(coordinator.isActive('task-1')).toBe(false);
  });

  it('reports true while a run is in flight and false after it settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const surface: TaskExecutionSurface = {
      startTaskRun: async () => {
        await gate;
        return {
          status: 'completed',
          runId: 'r',
          conversationId: 'c',
          sidepanelTabId: 't',
          finalAssistantContent: VALID_HANDOFF,
        };
      },
    };
    const coordinator = new TaskRunCoordinator({
      executionSurface: surface,
      now: () => '2026-06-05T00:00:00Z',
      isProviderEnabled: () => true,
      ownsModel: () => true,
      writeTaskStatus: async () => {},
      appendLedger: async () => {},
      writeHandoff: async () => {},
    });

    const runPromise = coordinator.run(makeTask());
    expect(coordinator.isActive('task-1')).toBe(true);
    release();
    await runPromise;
    expect(coordinator.isActive('task-1')).toBe(false);
  });
});

describe('TaskRunCoordinator — shared activeRuns', () => {
  it('two coordinators sharing a set observe each others in-flight runs', async () => {
    const shared = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const surface: TaskExecutionSurface = {
      startTaskRun: async () => {
        await gate;
        return {
          status: 'completed',
          runId: 'r',
          conversationId: 'c',
          sidepanelTabId: 't',
          finalAssistantContent: VALID_HANDOFF,
        };
      },
    };
    const make = (): TaskRunCoordinator =>
      new TaskRunCoordinator({
        executionSurface: surface,
        now: () => '2026-06-05T00:00:00Z',
        isProviderEnabled: () => true,
        ownsModel: () => true,
        activeRuns: shared,
        writeTaskStatus: async () => {},
        appendLedger: async () => {},
        writeHandoff: async () => {},
      });
    const a = make();
    const b = make();

    const runPromise = a.run(makeTask());
    // The run started in `a` is visible to `b` through the shared set.
    expect(b.isActive('task-1')).toBe(true);
    // And `b` refuses to launch the same card while it is in flight elsewhere.
    await expect(b.run(makeTask())).resolves.toEqual({
      ok: false,
      error: 'This work order is already running.',
    });
    release();
    await runPromise;
    expect(b.isActive('task-1')).toBe(false);
  });
});

describe('TaskRunCoordinator — shared chat-tab reservations', () => {
  function gatedSurface(reservations: ChatTabReservations) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = { pendingDuringRun: -1, gotReservation: false };
    const surface: TaskExecutionSurface = {
      startTaskRun: async (_task, options) => {
        seen.pendingDuringRun = reservations.pending;
        seen.gotReservation = options.tabReservation !== undefined;
        await gate;
        return {
          status: 'completed',
          runId: 'r',
          conversationId: 'c',
          sidepanelTabId: 't',
          finalAssistantContent: VALID_HANDOFF,
        };
      },
    };
    return { surface, release: () => release(), seen };
  }

  function make(reservations: ChatTabReservations, surface: TaskExecutionSurface): TaskRunCoordinator {
    return new TaskRunCoordinator({
      executionSurface: surface,
      now: () => '2026-06-05T00:00:00Z',
      isProviderEnabled: () => true,
      ownsModel: () => true,
      reservations,
      writeTaskStatus: async () => {},
      appendLedger: async () => {},
      writeHandoff: async () => {},
    });
  }

  it('reserves a tab before the run and passes the reservation to the surface', async () => {
    const reservations = new ChatTabReservations();
    const { surface, release, seen } = gatedSurface(reservations);
    const coordinator = make(reservations, surface);

    const runPromise = coordinator.run(makeTask());
    // The reservation is taken synchronously at launch, visible to other panes.
    expect(reservations.pending).toBe(1);
    release();
    await runPromise;

    expect(seen.pendingDuringRun).toBe(1);
    expect(seen.gotReservation).toBe(true);
    // Released once the run settles (here via the finally safety net).
    expect(reservations.pending).toBe(0);
  });

  it('does not reserve when a guard rejects the run before launch', async () => {
    const reservations = new ChatTabReservations();
    const { surface } = gatedSurface(reservations);
    const coordinator = make(reservations, surface);

    await coordinator.run(makeTask({ provider: undefined }));
    expect(reservations.pending).toBe(0);
  });

  it('stays balanced when the surface also releases (idempotent with the finally)', async () => {
    const reservations = new ChatTabReservations();
    const surface: TaskExecutionSurface = {
      // Mirrors the chat view releasing at tab creation, mid-run.
      startTaskRun: async (_task, options) => {
        options.tabReservation?.release();
        return {
          status: 'completed',
          runId: 'r',
          conversationId: 'c',
          sidepanelTabId: 't',
          finalAssistantContent: VALID_HANDOFF,
        };
      },
    };
    const coordinator = make(reservations, surface);

    await coordinator.run(makeTask());
    expect(reservations.pending).toBe(0);
  });
});
