import type { ChatMessage } from '@/core/types';
import { sendFeedbackPrompt } from '@/features/chat/feedback/sendFeedbackPrompt';
import { t } from '@/i18n/i18n';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'Hello',
    timestamp: 0,
    ...overrides,
  };
}

interface FakeTab {
  id: string;
  controllers: { inputController: { sendMessage: jest.Mock } };
}

function makeTab(id = 'tab-1'): FakeTab {
  return {
    id,
    controllers: { inputController: { sendMessage: jest.fn().mockResolvedValue(undefined) } },
  };
}

function makeTabManager(tabs: FakeTab[], activeId: string | null) {
  const map = new Map(tabs.map((t) => [t.id, t]));
  return {
    getActiveTab: jest.fn(() => (activeId ? map.get(activeId) ?? null : null)),
    getTab: jest.fn((id: string) => map.get(id) ?? null),
  };
}

function makePlugin(opts: {
  view?: { getTabManager: () => unknown } | null;
  crossView?: { view: { getTabManager: () => unknown }; tabId: string } | null;
} = {}) {
  return {
    getView: jest.fn(() => opts.view ?? null),
    findConversationAcrossViews: jest.fn(() => opts.crossView ?? null),
    logger: { scope: () => ({ debug: jest.fn() }) },
  };
}

describe('sendFeedbackPrompt', () => {
  it('sends the English thumbsUp prompt on the conversation-owning tab', () => {
    const tab = makeTab('tab-A');
    const tabManager = makeTabManager([tab], null);
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({
      view,
      crossView: { view, tabId: 'tab-A' },
    });

    sendFeedbackPrompt(plugin as never, makeMessage(), 'conv-1', 'up');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: t('chat.feedback.thumbsUp.prompt'),
    });
  });

  it('sends the English thumbsDown prompt on the conversation-owning tab', () => {
    const tab = makeTab('tab-A');
    const tabManager = makeTabManager([tab], null);
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({
      view,
      crossView: { view, tabId: 'tab-A' },
    });

    sendFeedbackPrompt(plugin as never, makeMessage(), 'conv-1', 'down');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: t('chat.feedback.thumbsDown.prompt'),
    });
  });

  it('falls back to the active tab when conversationId is null', () => {
    const tab = makeTab('tab-A');
    const tabManager = makeTabManager([tab], 'tab-A');
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({ view, crossView: null });

    sendFeedbackPrompt(plugin as never, makeMessage(), null, 'up');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledTimes(1);
    expect(plugin.findConversationAcrossViews).not.toHaveBeenCalled();
  });

  it('falls back to the active tab when findConversationAcrossViews returns null', () => {
    const tab = makeTab('tab-A');
    const tabManager = makeTabManager([tab], 'tab-A');
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({ view, crossView: null });

    sendFeedbackPrompt(plugin as never, makeMessage(), 'unknown-conv', 'down');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does nothing when getView returns null', () => {
    const plugin = makePlugin({ view: null });
    expect(() =>
      sendFeedbackPrompt(plugin as never, makeMessage(), 'conv-1', 'up'),
    ).not.toThrow();
  });

  it('does nothing when no active tab and no cross-view match exist', () => {
    const tabManager = makeTabManager([], null);
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({ view, crossView: null });

    expect(() =>
      sendFeedbackPrompt(plugin as never, makeMessage(), 'conv-1', 'down'),
    ).not.toThrow();
  });
});
