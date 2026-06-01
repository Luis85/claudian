/**
 * MessageRenderer scaling guard rails (PERF-2).
 *
 * The durable contract this suite protects: rendering a conversation must cost
 * O(render window), NOT O(conversation length). PERF-2 capped the mounted DOM
 * to the trailing `RENDER_WINDOW_SIZE`; if a future change reintroduces an
 * unbounded mount (mounting all N messages, per-message listeners that scale
 * with history, etc.) these assertions trip.
 *
 * The wall-time figures are reported, never asserted — timing is noisy on
 * shared/CI machines, so it is monitoring data, not a gate.
 */
import { createMockEl } from '@test/helpers/mockElement';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer, RENDER_WINDOW_SIZE } from '@/features/chat/rendering/MessageRenderer';

import { reportMetrics, timeMs } from './perfReport';

jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: (md: string) => md,
}));
jest.mock('@/utils/fileLink', () => ({
  processFileLinks: jest.fn(),
  registerFileLinkHandler: jest.fn(),
}));

function createRenderer(messagesEl: any): MessageRenderer {
  const plugin = {
    app: { vault: { getAbstractFileByPath: () => null }, workspace: { openLinkText: jest.fn() } },
    settings: { mediaFolder: '' },
    chatMessageActions: [],
    getActiveConversationSnapshot: () => null,
  };
  const component = { registerDomEvent: jest.fn(), register: jest.fn(), addChild: jest.fn() };
  const renderer = new MessageRenderer(plugin as any, component as any, messagesEl);
  // Keep markdown rendering synchronous and DOM-free so node counts reflect the
  // renderer's own structure, not the (mocked) markdown pipeline.
  jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
  return renderer;
}

/** A user + assistant turn so each message exercises the real render branches. */
function conversation(turns: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < turns; i++) {
    messages.push({
      id: `u${i}`,
      role: 'user',
      content: `Question ${i} with some context`,
      timestamp: i * 2,
      userMessageId: `uuid-u${i}`,
    } as unknown as ChatMessage);
    messages.push({
      id: `a${i}`,
      role: 'assistant',
      content: '',
      timestamp: i * 2 + 1,
      contentBlocks: [{ type: 'text', content: `Answer ${i}` }],
    } as unknown as ChatMessage);
  }
  return messages;
}

/** Total nodes in the mock element subtree (the mounted DOM proxy). */
function countNodes(el: any): number {
  let total = 1;
  for (const child of el._children ?? el.children ?? []) {
    total += countNodes(child);
  }
  return total;
}

/** Total event listeners registered across the mock element subtree. */
function countListeners(el: any): number {
  let total = 0;
  const listeners: Map<string, unknown[]> | undefined = el._eventListeners;
  if (listeners) {
    for (const handlers of listeners.values()) total += handlers.length;
  }
  for (const child of el._children ?? el.children ?? []) {
    total += countListeners(child);
  }
  return total;
}

const SCALES = [50, 200, 500, 1000];

describe('MessageRenderer scaling (PERF-2)', () => {
  it('mounts O(render window) nodes regardless of conversation length', () => {
    const metrics = SCALES.map((n) => {
      const messagesEl = createMockEl();
      const renderer = createRenderer(messagesEl);
      const messages = conversation(Math.ceil(n / 2)).slice(0, n);

      const ms = timeMs(() => renderer.renderMessages(messages, () => 'hi'));

      const mounted = messagesEl.querySelectorAll('.claudian-message').length;
      return {
        n,
        mounted,
        values: {
          mounted,
          domNodes: countNodes(messagesEl),
          listeners: countListeners(messagesEl),
          renderMs: Math.round(ms * 100) / 100,
        },
      };
    });

    reportMetrics('renderMessages — DOM/listener growth vs conversation length', metrics);

    for (const { n, mounted } of metrics) {
      // Mounted message bubbles never exceed the window cap.
      expect(mounted).toBeLessThanOrEqual(RENDER_WINDOW_SIZE);
      // ...and below the cap, everything is mounted (no silent truncation).
      expect(mounted).toBe(Math.min(n, RENDER_WINDOW_SIZE));
    }

    // The whole point of PERF-2: a 20x longer chat must not mount 20x the DOM.
    const small = metrics[0].values.domNodes;
    const large = metrics[metrics.length - 1].values.domNodes;
    expect(large).toBeLessThan(small * 2);
  });

  it('does not grow per-render retained listeners with conversation length', () => {
    const shortEl = createMockEl();
    createRenderer(shortEl).renderMessages(conversation(40), () => 'hi');

    const longEl = createMockEl();
    createRenderer(longEl).renderMessages(conversation(2000), () => 'hi');

    // Listener count is bounded by the window, so a 25x longer chat should land
    // within a small constant factor (the load-earlier control adds a few).
    expect(countListeners(longEl)).toBeLessThan(countListeners(shortEl) * 2);
  });
});
