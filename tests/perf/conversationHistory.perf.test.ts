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

describe('history dropdown render (renderHistoryItems)', () => {
  it('reports DOM/listener growth with conversation count (currently unwindowed)', () => {
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

      return {
        n,
        rows: dropdown.querySelectorAll('.claudian-history-item').length,
        values: {
          rows: dropdown.querySelectorAll('.claudian-history-item').length,
          domNodes: countNodes(dropdown),
          listeners: countListeners(dropdown),
          renderMs: Math.round(ms * 100) / 100,
        },
      };
    });

    reportMetrics('renderHistoryItems — DOM/listener growth vs conversation count', metrics);

    // Documents today's contract: one row per conversation (no window cap yet).
    // If windowing is added later, tighten this to a constant.
    for (const m of metrics) {
      expect(m.rows).toBe(m.n);
    }
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
