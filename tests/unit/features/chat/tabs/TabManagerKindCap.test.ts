import { createMockEl } from '@test/helpers/mockElement';

import { TabManager } from '@/features/chat/tabs/TabManager';

function makeManager(opts: { maxChatTabs?: number; agentBoardQueueCap?: number } = {}) {
  const settings = {
    maxChatTabs: opts.maxChatTabs ?? 4,
    agentBoardQueueCap: opts.agentBoardQueueCap ?? 2,
  };
  const plugin = {
    settings,
    events: { emit: jest.fn() },
  } as never;
  return new TabManager(plugin, createMockEl() as never, {} as never);
}

describe('TabManager per-kind cap', () => {
  it('canCreateTab respects the chat cap independently of work-order tabs', () => {
    const mgr = makeManager({ maxChatTabs: 3, agentBoardQueueCap: 3 });
    const internal = mgr as unknown as { tabs: Map<string, { kind: 'chat' | 'work-order' }> };
    internal.tabs.set('wo-1', { kind: 'work-order' });
    expect(mgr.canCreateTab('chat')).toBe(true);
    internal.tabs.set('chat-1', { kind: 'chat' });
    internal.tabs.set('chat-2', { kind: 'chat' });
    internal.tabs.set('chat-3', { kind: 'chat' });
    expect(mgr.canCreateTab('chat')).toBe(false);
    expect(mgr.canCreateTab('work-order')).toBe(true);
  });

  it('canCreateTab respects the work-order cap independently of chat tabs', () => {
    const mgr = makeManager({ maxChatTabs: 5, agentBoardQueueCap: 3 });
    const internal = mgr as unknown as { tabs: Map<string, { kind: 'chat' | 'work-order' }> };
    internal.tabs.set('chat-1', { kind: 'chat' });
    internal.tabs.set('chat-2', { kind: 'chat' });
    expect(mgr.canCreateTab('work-order')).toBe(true);
    internal.tabs.set('wo-1', { kind: 'work-order' });
    internal.tabs.set('wo-2', { kind: 'work-order' });
    internal.tabs.set('wo-3', { kind: 'work-order' });
    expect(mgr.canCreateTab('work-order')).toBe(false);
    expect(mgr.canCreateTab('chat')).toBe(true);
  });

  it('canCreateTab defaults to chat when no kind argument is supplied', () => {
    const mgr = makeManager({ maxChatTabs: 3, agentBoardQueueCap: 5 });
    const internal = mgr as unknown as { tabs: Map<string, { kind: 'chat' | 'work-order' }> };
    internal.tabs.set('chat-1', { kind: 'chat' });
    internal.tabs.set('chat-2', { kind: 'chat' });
    internal.tabs.set('chat-3', { kind: 'chat' });
    expect(mgr.canCreateTab()).toBe(false);
  });

  it('countTabsByKind returns 0 for empty state', () => {
    const mgr = makeManager();
    expect(mgr.countTabsByKind('chat')).toBe(0);
    expect(mgr.countTabsByKind('work-order')).toBe(0);
  });
});
