import { EventBus } from '../../../../../src/core/events/EventBus';
import type { TaskEventMap } from '../../../../../src/features/tasks/events';
import type {
  TaskExecutionSurface,
  TaskRunHandle,
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
  readonly adapter = new SyntheticStreamAdapter();

  constructor(private readonly opts: { runId?: string; terminal?: TaskRunTerminal } = {}) {}

  async startTaskRun(_task: TaskSpec, options: { prompt: string }): Promise<TaskRunHandle> {
    this.prompts.push(options.prompt);
    return {
      runId: this.opts.runId ?? 'run-1',
      conversationId: 'conv-1',
      sidepanelTabId: 'tab-1',
      stream: this.adapter,
      terminal: Promise.resolve(this.opts.terminal ?? { status: 'completed', finalAssistantContent: '' }),
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

  it('returns the terminal error when the surface could not start a run', async () => {
    const surface = new FakeSurface({ runId: '', terminal: { status: 'failed', finalAssistantContent: '', error: 'tab cap' } });
    const { coordinator, statuses } = makeCoordinator(surface);
    await expect(coordinator.run(makeTask())).resolves.toEqual({ ok: false, error: 'tab cap' });
    expect(statuses).toEqual([]);
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

  it('delegates a completed run with no handoff to needs_handoff', async () => {
    const { coordinator, statuses, surface } = makeCoordinator();
    const p = coordinator.run(makeTask());
    await flushMicrotasks();
    surface.adapter.emitText('No handoff here.');
    surface.adapter.emitEnd({ status: 'completed', finalAssistantContent: 'No handoff here.' });

    await expect(p).resolves.toEqual({ ok: false, error: 'Missing claudian_handoff block' });
    expect(statuses).toEqual(['running', 'needs_handoff']);
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
});
