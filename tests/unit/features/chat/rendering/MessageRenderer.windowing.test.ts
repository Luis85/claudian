import { createMockEl } from '@test/helpers/mockElement';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer, windowStartIndex } from '@/features/chat/rendering/MessageRenderer';

jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: jest.fn().mockImplementation((md: string) => md),
}));
jest.mock('@/utils/fileLink', () => ({
  processFileLinks: jest.fn(),
  registerFileLinkHandler: jest.fn(),
}));

function createMockComponent() {
  return { registerDomEvent: jest.fn(), register: jest.fn(), addChild: jest.fn() };
}

function mockPlugin() {
  return {
    app: { vault: { getAbstractFileByPath: () => null }, workspace: { openLinkText: jest.fn() } },
    settings: { mediaFolder: '' },
    chatMessageActions: [],
    getActiveConversationSnapshot: () => null,
  };
}

function createRenderer(messagesEl: any) {
  const renderer = new MessageRenderer(
    mockPlugin() as any,
    createMockComponent() as any,
    messagesEl,
  );
  // Markdown render is async/void; keep rendering synchronous and DOM-free for counting.
  jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
  return renderer;
}

function userMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: 'user',
    content: `message ${i}`,
    timestamp: i,
  })) as unknown as ChatMessage[];
}

function messageCount(messagesEl: any): number {
  return messagesEl.querySelectorAll('.claudian-message').length;
}

describe('MessageRenderer windowing', () => {
  describe('windowStartIndex', () => {
    it('returns 0 when the conversation fits in the window', () => {
      expect(windowStartIndex(50, 80)).toBe(0);
      expect(windowStartIndex(80, 80)).toBe(0);
    });

    it('caps to the trailing window for longer conversations', () => {
      expect(windowStartIndex(100, 80)).toBe(20);
      expect(windowStartIndex(500, 80)).toBe(420);
    });
  });

  it('mounts every message and shows no control when under the window cap', () => {
    const messagesEl = createMockEl();
    const renderer = createRenderer(messagesEl);

    renderer.renderMessages(userMessages(50), () => 'hi');

    expect(messageCount(messagesEl)).toBe(50);
    expect(messagesEl.querySelector('.claudian-load-earlier')).toBeNull();
  });

  it('mounts only the trailing window and a load-earlier control for long chats', () => {
    const messagesEl = createMockEl();
    const renderer = createRenderer(messagesEl);

    renderer.renderMessages(userMessages(100), () => 'hi');

    // 100 messages, window 80 -> only the most recent 80 are mounted.
    expect(messageCount(messagesEl)).toBe(80);
    expect(messagesEl.querySelector('.claudian-load-earlier')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-load-earlier-btn')).not.toBeNull();
  });

  it('mounts the earlier chunk on demand across repeated load-earlier clicks', () => {
    const messagesEl = createMockEl();
    const renderer = createRenderer(messagesEl);

    renderer.renderMessages(userMessages(200), () => 'hi');
    expect(messageCount(messagesEl)).toBe(80);

    const clickLoadEarlier = () =>
      messagesEl.querySelector('.claudian-load-earlier-btn')?.click();

    clickLoadEarlier();
    expect(messageCount(messagesEl)).toBe(160);

    clickLoadEarlier();
    expect(messageCount(messagesEl)).toBe(200);
  });
});
