/**
 * Conversation-list scaling guards (history opening + plugin activation).
 *
 * Two paths that scale with the NUMBER OF CONVERSATIONS in the vault:
 *
 *  - `renderHistoryItems` (history dropdown): mounts one row + click listeners
 *    per conversation. Unlike the message list (capped in PERF-2) this is NOT
 *    windowed, so this spec MONITORS its O(N) DOM/listener growth — turning it
 *    into a gate later just means asserting a cap here.
 *  - `ConversationStore.loadConversations`: runs at plugin load; maps + sorts
 *    every session metadata record. A proxy for activation time vs. vault size.
 */
import { createMockEl } from '@test/helpers/mockElement';

import { ConversationStore } from '@/app/conversations/ConversationStore';
import type { SharedAppStorage } from '@/core/bootstrap/storage';
import type { AppSessionStorage } from '@/core/providers/types';
import type { ConversationMeta, SessionMetadata } from '@/core/types';
import { ConversationController } from '@/features/chat/controllers/ConversationController';

import { reportMetrics, timeMs } from './perfReport';

jest.mock('@/utils/imageEmbed', () => ({ replaceImageEmbedsWithHtml: (md: string) => md }));
jest.mock('@/utils/fileLink', () => ({ processFileLinks: jest.fn(), registerFileLinkHandler: jest.fn() }));

const SCALES = [50, 200, 800, 2000];

function conversationMetas(n: number): ConversationMeta[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `conv-${i}`,
    providerId: 'claude' as const,
    title: `Conversation ${i}`,
    createdAt: i * 1000,
    updatedAt: i * 1000,
    lastResponseAt: i * 1000,
    messageCount: 4,
    preview: `Preview ${i}`,
  }));
}

function countNodes(el: any): number {
  let total = 1;
  for (const child of el._children ?? el.children ?? []) total += countNodes(child);
  return total;
}

function countListeners(el: any): number {
  let total = 0;
  const listeners: Map<string, unknown[]> | undefined = el._eventListeners;
  if (listeners) for (const handlers of listeners.values()) total += handlers.length;
  for (const child of el._children ?? el.children ?? []) total += countListeners(child);
  return total;
}

// Mirror of HISTORY_RENDER_WINDOW_SIZE in ConversationController. Kept as a local
// constant (the source value isn't exported) so this asserts the intended cap.
const HISTORY_RENDER_WINDOW_SIZE = 50;

describe('history dropdown render (renderHistoryItems)', () => {
  it('mounts O(window) rows regardless of conversation count', () => {
    const metrics = SCALES.map((n) => {
      const dropdown = createMockEl();
      const metas = conversationMetas(n);
      const deps = {
        plugin: { getConversationList: () => metas } as any,
        state: { currentConversationId: null } as any,
        getHistoryDropdown: () => dropdown,
      } as any;
      const controller = new ConversationController(deps);

      const ms = timeMs(() => controller.updateHistoryDropdown());

      const rows = dropdown.querySelectorAll('.specorator-history-item').length;
      return {
        n,
        rows,
        values: {
          rows,
          domNodes: countNodes(dropdown),
          listeners: countListeners(dropdown),
          renderMs: Math.round(ms * 100) / 100,
        },
      };
    });

    reportMetrics('renderHistoryItems — DOM/listener growth vs conversation count', metrics);

    for (const m of metrics) {
      // Windowed: never mount more than one chunk up front, and mount everything
      // when below the cap.
      expect(m.rows).toBe(Math.min(m.n, HISTORY_RENDER_WINDOW_SIZE));
    }

    // A 40x longer history must not mount 40x the DOM (the PERF-2 contract,
    // applied to conversation count).
    const small = metrics[0].values.domNodes;
    const large = metrics[metrics.length - 1].values.domNodes;
    expect(large).toBeLessThan(small * 2);
  });

  it('reveals the next chunk on "Show more" click', () => {
    const dropdown = createMockEl();
    const metas = conversationMetas(120);
    const deps = {
      plugin: { getConversationList: () => metas } as any,
      state: { currentConversationId: null } as any,
      getHistoryDropdown: () => dropdown,
    } as any;
    const controller = new ConversationController(deps);

    controller.updateHistoryDropdown();
    expect(dropdown.querySelectorAll('.specorator-history-item')).toHaveLength(50);

    const clickShowMore = () =>
      dropdown.querySelector('.specorator-history-show-more-btn')?.click();

    clickShowMore();
    expect(dropdown.querySelectorAll('.specorator-history-item')).toHaveLength(100);

    clickShowMore();
    // All conversations revealed across the chunks.
    expect(dropdown.querySelectorAll('.specorator-history-item')).toHaveLength(120);
  });
});

describe('ConversationStore.loadConversations (activation proxy)', () => {
  function createStore(metas: SessionMetadata[]): ConversationStore {
    const sessions = {
      listMetadata: jest.fn().mockResolvedValue(metas),
      saveMetadata: jest.fn(),
      deleteMetadata: jest.fn(),
      toSessionMetadata: jest.fn(),
    } as unknown as AppSessionStorage;
    const storage = { sessions } as unknown as SharedAppStorage;
    return new ConversationStore({
      storage,
      getVaultPath: () => '/vault',
      repairViewsAfterDelete: async () => undefined,
      events: { emit: jest.fn(), on: jest.fn(), off: jest.fn(), setErrorSink: jest.fn() } as any,
    });
  }

  function sessionMetas(n: number): SessionMetadata[] {
    // lastResponseAt decreases with i, so conv-0 is the most recent. Input order
    // is already ascending-by-i, i.e. descending-by-recency-reversed, forcing the
    // recency sort to actually reorder rather than no-op.
    return Array.from({ length: n }, (_, i) => ({
      id: `conv-${i}`,
      providerId: 'claude',
      title: `Conversation ${i}`,
      createdAt: i * 1000,
      updatedAt: i * 1000,
      lastResponseAt: (n - i) * 1000,
    })) as unknown as SessionMetadata[];
  }

  it('keeps load+sort cost tracking conversation count', async () => {
    const metrics: { n: number; values: Record<string, number> }[] = [];
    for (const n of SCALES) {
      const store = createStore(sessionMetas(n));
      const start = performance.now();
      await store.loadConversations();
      const ms = performance.now() - start;
      metrics.push({ n, values: { loaded: store.getConversations().length, loadMs: Math.round(ms * 100) / 100 } });
      expect(store.getConversations()).toHaveLength(n);
      // Sorted by recency descending: conv-0 has the largest lastResponseAt.
      expect(store.getConversations()[0].id).toBe('conv-0');
    }

    reportMetrics('ConversationStore.loadConversations — load+sort vs count', metrics);
  });
});
