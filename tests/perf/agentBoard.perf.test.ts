/**
 * Agent Board rendering scaling guard rails.
 *
 * Unlike the chat `MessageRenderer`, the board mounts every work-order card
 * (no render window today), so the durable contract is:
 *
 *   1. A full `render()` stays ~linear in card count — per-card DOM/listener
 *      cost is flat, so a 20x bigger board can never cost 20x² (e.g. a card
 *      render that iterates other cards, or per-card listeners that scale
 *      with board size).
 *   2. The streaming hot paths — `patchLiveStrip` (heartbeat repaint) and
 *      `patchCard` (status transition) — are O(1): the DOM/listener delta of a
 *      patch is a constant, independent of how many cards are mounted.
 *
 * Wall-time figures are reported, never asserted — timing is monitoring data,
 * not a gate.
 */
import { createMockEl } from '@test/helpers/mockElement';

import type {
  ResolvedBoardLayout,
  ResolvedLane,
} from '@/features/tasks/config/boardConfigTypes';
import type { TaskSpec, TaskStatus } from '@/features/tasks/model/taskTypes';
import {
  type AgentBoardRenderCallbacks,
  AgentBoardRenderer,
  type AgentBoardRenderState,
} from '@/features/tasks/ui/AgentBoardRenderer';

import { reportMetrics, timeMs } from './perfReport';

function makeTask(id: string, status: TaskStatus): TaskSpec {
  return {
    path: `tasks/${id}.md`,
    frontmatter: {
      type: 'specorator-work-order',
      schema_version: 1,
      id,
      title: `Work order ${id}`,
      status,
      priority: '2 - normal',
      created: '2026-06-01T00:00:00Z',
      updated: '2026-06-01T00:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      attempts: 1,
      ...(status === 'running'
        ? { started: '2026-06-01T00:00:00Z', heartbeat: '2026-06-01T00:00:30Z', run_id: `run-${id}` }
        : {}),
    },
    sections: {
      objective: 'Do the thing',
      acceptanceCriteria: '- [x] first\n- [ ] second',
      context: '',
      constraints: '',
      ledger: status === 'running' ? '- 2026-06-01T00:00:30Z [running] working…' : '',
      handoff: '',
    },
    body: '',
    raw: '',
  } as TaskSpec;
}

const LANE_STATUSES: TaskStatus[] = ['inbox', 'ready', 'running', 'review', 'done'];

function makeLane(status: TaskStatus, tasks: TaskSpec[]): ResolvedLane {
  return {
    id: status,
    title: status,
    tasks,
    hostsNewWorkOrders: status === 'inbox',
    definitionOfReady: [],
    definitionOfDone: [],
    isCatchAll: false,
    collapsible: false,
    collapsed: false,
  };
}

/** N cards spread round-robin over the five standard lanes (statuses match lanes). */
function makeState(total: number): AgentBoardRenderState {
  const byLane = new Map<TaskStatus, TaskSpec[]>(LANE_STATUSES.map((s) => [s, []]));
  for (let i = 0; i < total; i++) {
    const status = LANE_STATUSES[i % LANE_STATUSES.length];
    byLane.get(status)!.push(makeTask(`t${i}`, status));
  }
  const layout: ResolvedBoardLayout = {
    lanes: LANE_STATUSES.map((s) => makeLane(s, byLane.get(s)!)),
    errors: [],
  };
  return {
    layout,
    invalidNotes: [],
    slots: { used: 1, max: 4 },
    queue: {
      paused: false,
      halted: false,
      slotOccupied: 1,
      slotCapacity: 4,
      consecutiveFailures: 0,
      onToggle: () => {},
    },
  };
}

function makeCallbacks(): AgentBoardRenderCallbacks {
  const noop = () => {};
  return {
    onOpenDetail: noop,
    onRun: noop,
    onStop: noop,
    onAccept: noop,
    onRework: noop,
    onMarkReady: noop,
    onReopen: noop,
    onMoveToInbox: noop,
    onAddWorkOrder: noop,
    onRunNextReady: noop,
    onContextMenu: noop,
    onToggleLaneCollapse: noop,
    onReply: noop,
    onApprove: noop,
    onReject: noop,
    onCancelPaused: noop,
    onSendToReview: noop,
    onMarkFailed: noop,
    onArchive: noop,
    onOpenNote: noop,
    onOpenConversation: noop,
  };
}

/** Total nodes in the mock element subtree (the mounted DOM proxy). */
function countNodes(el: any): number {
  let total = 1;
  for (const child of el._children ?? el.children ?? []) total += countNodes(child);
  return total;
}

/** Total event listeners registered across the mock element subtree. */
function countListeners(el: any): number {
  let total = 0;
  const listeners: Map<string, unknown[]> | undefined = el._eventListeners;
  if (listeners) for (const handlers of listeners.values()) total += handlers.length;
  for (const child of el._children ?? el.children ?? []) total += countListeners(child);
  return total;
}

interface RenderedBoard {
  renderer: AgentBoardRenderer;
  container: any;
  state: AgentBoardRenderState;
}

function renderBoard(total: number): RenderedBoard {
  const renderer = new AgentBoardRenderer();
  const container = createMockEl();
  const state = makeState(total);
  renderer.render(container, state, makeCallbacks());
  return { renderer, container, state };
}

const SCALES = [50, 200, 1000];

describe('AgentBoard rendering scaling', () => {
  it('keeps per-card DOM and listener cost flat as the board grows', () => {
    const metrics = SCALES.map((n) => {
      const renderer = new AgentBoardRenderer();
      const container = createMockEl();
      const state = makeState(n);
      const callbacks = makeCallbacks();

      const ms = timeMs(() => renderer.render(container, state, callbacks));

      const cards = container.querySelectorAll('.specorator-agent-board-card').length;
      const nodes = countNodes(container);
      const listeners = countListeners(container);
      return {
        n,
        cards,
        nodes,
        listeners,
        values: {
          cards,
          domNodes: nodes,
          listeners,
          nodesPerCard: Math.round((nodes / cards) * 100) / 100,
          listenersPerCard: Math.round((listeners / cards) * 100) / 100,
          renderMs: Math.round(ms * 100) / 100,
        },
      };
    });

    reportMetrics('AgentBoard render — DOM/listener growth vs work-order count', metrics);

    // Every card mounts (the board has no window today — this also documents that).
    for (const m of metrics) expect(m.cards).toBe(m.n);

    // Per-card cost must be flat: amortized nodes/listeners per card cannot grow
    // with board size (toolbar/lane overhead only shrinks per-card as N grows).
    const small = metrics[0];
    const large = metrics[metrics.length - 1];
    expect(large.nodes / large.cards).toBeLessThanOrEqual(small.nodes / small.cards + 1);
    expect(large.listeners / large.cards).toBeLessThanOrEqual(small.listeners / small.cards + 0.5);

    // And the absolute totals stay ~linear — a 20x board must not cost
    // super-linearly more than 20x the smallest board.
    const factor = large.n / small.n;
    expect(large.nodes).toBeLessThan(small.nodes * factor * 1.25);
    expect(large.listeners).toBeLessThan(small.listeners * factor * 1.25);
  });

  it('patchLiveStrip repaints in place — zero node/listener churn at any board size', () => {
    const metrics = [50, 1000].map((n) => {
      const { renderer, container } = renderBoard(n);
      // Lane layout is round-robin: t2 is the first running card at every scale.
      const runningId = 't2';

      const nodesBefore = countNodes(container);
      const listenersBefore = countListeners(container);
      const ms = timeMs(() => {
        // 60 heartbeat repaints, the steady-state steaming load on a live card.
        for (let i = 0; i < 60; i++) {
          renderer.patchLiveStrip(runningId, {
            lastLedger: `step ${i}`,
            elapsedMs: i * 1000,
            attemptNumber: 1,
            heartbeatAgeMs: i * 500,
          });
        }
      });
      const nodeChurn = countNodes(container) - nodesBefore;
      const listenerChurn = countListeners(container) - listenersBefore;

      return {
        n,
        nodeChurn,
        listenerChurn,
        values: { nodeChurn, listenerChurn, patch60Ms: Math.round(ms * 1000) / 1000 },
      };
    });

    reportMetrics('AgentBoard patchLiveStrip — churn vs board size (60 repaints)', metrics);

    // In-place repaint: no DOM/listener growth, regardless of mounted card count.
    for (const m of metrics) {
      expect(m.nodeChurn).toBe(0);
      expect(m.listenerChurn).toBe(0);
    }
  });

  it('patchCard cost is a constant, independent of board size', () => {
    const metrics = [50, 1000].map((n) => {
      const { renderer, container } = renderBoard(n);
      const runningId = 't2';
      const reviewTask = makeTask(runningId, 'review');

      const nodesBefore = countNodes(container);
      const listenersBefore = countListeners(container);
      const ms = timeMs(() => renderer.patchCard(runningId, reviewTask));
      const nodeDelta = countNodes(container) - nodesBefore;
      const listenerDelta = countListeners(container) - listenersBefore;

      return {
        n,
        nodeDelta,
        listenerDelta,
        values: { nodeDelta, listenerDelta, patchMs: Math.round(ms * 1000) / 1000 },
      };
    });

    reportMetrics('AgentBoard patchCard — running→review delta vs board size', metrics);

    // The status-transition rebuild touches one card's action cluster + reply
    // surface; its DOM/listener delta must be identical at 50 and 1000 cards.
    const [small, large] = metrics;
    expect(large.nodeDelta).toBe(small.nodeDelta);
    expect(large.listenerDelta).toBe(small.listenerDelta);
    // And the delta itself is a small constant (cluster + footer seam, not a re-render).
    expect(Math.abs(large.nodeDelta)).toBeLessThan(40);
  });
});
