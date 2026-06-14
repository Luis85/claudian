/**
 * Multi-tab concurrent streaming guard rails.
 *
 * Every chat tab runs its own `StreamController`, but all tabs in one Obsidian
 * window share a single animation-frame scheduler — the real-world scaling
 * seam when N tabs stream at once. The durable contracts:
 *
 *   1. Per-tab frame coalescing: however many text chunks land between frame
 *      flushes, a tab keeps at most a constant number of callbacks pending
 *      (one text-render frame + one scroll frame). Chunk arrival rate must
 *      never translate into scheduler pressure.
 *   2. Cross-tab independence: each streaming tab contributes O(1) pending
 *      callbacks per frame, so total scheduler load is O(active tabs); and the
 *      per-flush render work of one tab (markdown re-renders) is identical
 *      whether 0 or 31 other tabs stream concurrently.
 *
 * The harness drives real `StreamController` + `ChatState` instances over the
 * shared mock-element DOM with a deterministic counting frame scheduler, so
 * the assertions are structural (callback/render counts), never wall-clock.
 */
import { createMockEl } from '@test/helpers/mockElement';

import type { ChatMessage, StreamChunk } from '@/core/types';
import { StreamController, type StreamControllerDeps } from '@/features/chat/controllers/StreamController';
import { ChatState } from '@/features/chat/state/ChatState';

import { reportMetrics, timeMs } from './perfReport';

/** Deterministic rAF stand-in: counts scheduling, flushes on demand. */
class FakeFrameScheduler {
  private queue = new Map<number, () => void>();
  private nextId = 1;
  totalScheduled = 0;

  schedule(cb: () => void): number {
    this.totalScheduled += 1;
    const id = this.nextId++;
    this.queue.set(id, cb);
    return id;
  }

  cancel(id: number): void {
    this.queue.delete(id);
  }

  get pending(): number {
    return this.queue.size;
  }

  flush(): void {
    const callbacks = [...this.queue.values()];
    this.queue.clear();
    for (const cb of callbacks) cb();
  }
}

let scheduler = new FakeFrameScheduler();
const originalWindow = (globalThis as { window?: Window }).window;

beforeAll(() => {
  // One shared window scheduler for every tab — the seam under test.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      requestAnimationFrame: (cb: FrameRequestCallback): number =>
        scheduler.schedule(() => cb(performance.now())),
      cancelAnimationFrame: (id: number): void => scheduler.cancel(id),
      setTimeout: (cb: () => void, ms: number) => globalThis.setTimeout(cb, ms),
      clearTimeout: (id: number) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
      setInterval: (cb: () => void, ms: number) => globalThis.setInterval(cb, ms),
      clearInterval: (id: number) => globalThis.clearInterval(id as unknown as ReturnType<typeof setInterval>),
    } as unknown as Window,
  });
});

afterAll(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
  else Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
});

interface Tab {
  controller: StreamController;
  state: ChatState;
  msg: ChatMessage;
  renderCalls: () => number;
}

function makeTab(id: number): Tab {
  const state = new ChatState();
  const messagesEl = createMockEl();
  let renderCalls = 0;

  const deps: StreamControllerDeps = {
    plugin: { settings: { enableAutoScroll: true, collapseStreamingResponse: false }, app: { vault: {} } } as never,
    state,
    renderer: {
      renderContent: async () => {
        renderCalls += 1;
      },
      addTextCopyButton: () => {},
    } as never,
    subagentManager: {
      resetStreamingState: () => {},
      subagentsSpawnedThisStream: 0,
      hasPendingTask: () => false,
      getSyncSubagent: () => undefined,
      isPendingAsyncTask: () => false,
      isLinkedAgentOutputTool: () => false,
    } as never,
    getMessagesEl: () => messagesEl,
    getFileContextManager: () => null,
    updateQueueIndicator: () => {},
  };

  const controller = new StreamController(deps);
  state.currentContentEl = createMockEl();
  const msg = {
    id: `assistant-${id}`,
    role: 'assistant',
    content: '',
    timestamp: 0,
    toolCalls: [],
    contentBlocks: [],
  } as unknown as ChatMessage;
  return { controller, state, msg, renderCalls: () => renderCalls };
}

const textChunk: StreamChunk = { type: 'text', content: 'x' };

/** Lets the flushed (async) render callbacks settle before the next round. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface ScenarioResult {
  tabs: Tab[];
  /** Pending scheduler callbacks observed right before each flush. */
  pendingPerRound: number[];
  /** Wall time spent feeding tab 0's chunks (report-only). */
  tab0ChunkMs: number;
}

/** N tabs each receive `chunksPerRound` text chunks per round, interleaved; flush between rounds. */
async function streamScenario(nTabs: number, rounds: number, chunksPerRound: number): Promise<ScenarioResult> {
  scheduler = new FakeFrameScheduler();
  const tabs = Array.from({ length: nTabs }, (_, i) => makeTab(i));
  const pendingPerRound: number[] = [];
  let tab0ChunkMs = 0;

  for (let r = 0; r < rounds; r++) {
    for (let c = 0; c < chunksPerRound; c++) {
      // Time only the synchronous dispatch (report-only), then settle the chunk
      // so frame accounting is deterministic before the round's flush.
      let tab0Chunk: Promise<void> | undefined;
      tab0ChunkMs += timeMs(() => {
        tab0Chunk = tabs[0].controller.handleStreamChunk(textChunk, tabs[0].msg);
      });
      await tab0Chunk;
      for (let i = 1; i < tabs.length; i++) {
        await tabs[i].controller.handleStreamChunk(textChunk, tabs[i].msg);
      }
    }
    pendingPerRound.push(scheduler.pending);
    scheduler.flush();
    await settle();
  }

  return { tabs, pendingPerRound, tab0ChunkMs };
}

describe('Multi-tab concurrent streaming', () => {
  it('coalesces chunk bursts: pending callbacks per tab are constant, not per-chunk', async () => {
    const bursts = [5, 50, 200];
    const metrics = [];
    const pendings: number[] = [];
    for (const chunks of bursts) {
      const { pendingPerRound } = await streamScenario(1, 1, chunks);
      pendings.push(pendingPerRound[0]);
      metrics.push({ n: chunks, values: { pendingCallbacks: pendingPerRound[0] } });
    }

    reportMetrics('Streaming — pending frame callbacks vs chunk-burst size (1 tab)', metrics);

    // One text-render frame + one scroll frame, no matter the burst size. If a
    // change ever schedules per-chunk work, the 200-chunk burst trips this.
    for (const pending of pendings) {
      expect(pending).toBe(pendings[0]);
      expect(pending).toBeLessThanOrEqual(2);
    }
  });

  it('keeps one tab\'s per-flush work independent of how many other tabs stream', async () => {
    const rounds = 6;
    const chunksPerRound = 10;
    const tabCounts = [1, 8, 32];

    const results = [];
    const metrics = [];
    for (const nTabs of tabCounts) {
      const result = await streamScenario(nTabs, rounds, chunksPerRound);
      const tab0Renders = result.tabs[0].renderCalls();
      const steadyPending = result.pendingPerRound[result.pendingPerRound.length - 1];
      results.push({ nTabs, tab0Renders, steadyPending });
      metrics.push({
        n: nTabs,
        values: {
          tab0Renders,
          pendingPerRound: steadyPending,
          pendingPerTab: Math.round((steadyPending / nTabs) * 100) / 100,
          totalScheduled: scheduler.totalScheduled,
          tab0ChunkMs: Math.round(result.tab0ChunkMs * 1000) / 1000,
        },
      });
    }

    reportMetrics('Streaming — per-tab cost vs concurrent streaming tabs', metrics);

    const baseline = results[0];
    for (const r of results) {
      // Tab 0 re-renders exactly once per flushed frame — adding 31 concurrent
      // tabs must not change its render count.
      expect(r.tab0Renders).toBe(baseline.tab0Renders);
      // Scheduler pressure is O(active tabs): each tab holds the same constant
      // number of pending callbacks per frame as a lone tab does.
      expect(r.steadyPending).toBe(baseline.steadyPending * r.nTabs);
    }
  });

  it('renders once per flush regardless of chunks accumulated in between', async () => {
    const rounds = 4;
    const sparse = await streamScenario(1, rounds, 2);
    const dense = await streamScenario(1, rounds, 100);

    reportMetrics('Streaming — renders per flush vs chunk density (1 tab)', [
      { n: 2, values: { renders: sparse.tabs[0].renderCalls(), rounds } },
      { n: 100, values: { renders: dense.tabs[0].renderCalls(), rounds } },
    ]);

    // The markdown re-parse count tracks frames, not chunk arrival rate: a 50x
    // denser stream costs the same number of renders per flush.
    expect(dense.tabs[0].renderCalls()).toBe(sparse.tabs[0].renderCalls());
    expect(dense.tabs[0].renderCalls()).toBe(rounds);
  });
});
