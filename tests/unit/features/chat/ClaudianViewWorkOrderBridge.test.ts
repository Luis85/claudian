import {
  ClaudianViewWorkOrderBridge,
  type ClaudianViewWorkOrderBridgeDeps,
} from '@/features/chat/ClaudianViewWorkOrderBridge';

function makeBridge(overrides: Partial<ClaudianViewWorkOrderBridgeDeps> = {}) {
  const deps: ClaudianViewWorkOrderBridgeDeps = {
    getTabManager: () => null,
    findConversationTab: () => null,
    openConversationInNewTab: jest.fn(async () => {}),
    ...overrides,
  };
  return { bridge: new ClaudianViewWorkOrderBridge(deps), deps };
}

const commitOptions = {
  conversationId: 'conv-1',
  fallbackProviderId: 'claude' as const,
  fallbackModel: 'opus',
  prompt: 'PROMPT',
};

describe('ClaudianViewWorkOrderBridge.startTaskRunInFreshTab', () => {
  it('releases the reservation and returns null when there is no tab manager', async () => {
    const release = jest.fn();
    const { bridge } = makeBridge();

    const result = await bridge.startTaskRunInFreshTab({
      providerId: 'claude',
      model: 'opus',
      prompt: 'go',
      tabReservation: { release } as never,
    });

    expect(result).toBeNull();
    expect(release).toHaveBeenCalled();
  });
});

describe('ClaudianViewWorkOrderBridge.injectCommitTurnForConversation', () => {
  it('throws when the chat view has no tab manager', async () => {
    const { bridge } = makeBridge();
    await expect(bridge.injectCommitTurnForConversation(commitOptions)).rejects.toThrow(/chat view/i);
  });

  it('sends into a hosting tab without reopening or falling back', async () => {
    const sendMessage = jest.fn(async () => {});
    const whenHydrated = jest.fn(async () => {});
    const switchToTab = jest.fn(async () => {});
    const tab = { controllers: { inputController: { sendMessage }, conversationController: { whenHydrated } } };
    const tabManager = { switchToTab, getTab: jest.fn(() => tab) } as never;
    const findConversationTab = jest.fn(() => ({ tabManager, tabId: 'tab-1' }));
    const openConversationInNewTab = jest.fn(async () => {});
    const { bridge } = makeBridge({ getTabManager: () => tabManager, findConversationTab, openConversationInNewTab });

    await bridge.injectCommitTurnForConversation(commitOptions);

    expect(openConversationInNewTab).not.toHaveBeenCalled();
    expect(switchToTab).toHaveBeenCalledWith('tab-1');
    // Drains background hydration before sending so the prompt isn't dropped.
    expect(whenHydrated).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({ content: 'PROMPT' });
  });

  it('reopens from history then sends when no tab initially hosts the conversation', async () => {
    const sendMessage = jest.fn(async () => {});
    const switchToTab = jest.fn(async () => {});
    const tab = {
      controllers: { inputController: { sendMessage }, conversationController: { whenHydrated: jest.fn(async () => {}) } },
    };
    const tabManager = { switchToTab, getTab: jest.fn(() => tab) } as never;
    const findConversationTab = jest
      .fn()
      .mockReturnValueOnce(null) // not hosted initially
      .mockReturnValueOnce({ tabManager, tabId: 'tab-2' }); // surfaced after reopen
    const openConversationInNewTab = jest.fn(async () => {});
    const { bridge } = makeBridge({ getTabManager: () => tabManager, findConversationTab, openConversationInNewTab });

    await bridge.injectCommitTurnForConversation(commitOptions);

    expect(openConversationInNewTab).toHaveBeenCalledWith('conv-1');
    expect(switchToTab).toHaveBeenCalledWith('tab-2');
    expect(sendMessage).toHaveBeenCalledWith({ content: 'PROMPT' });
  });
});
