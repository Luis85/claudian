import { createMockEl } from '@test/helpers/mockElement';

import { TabManager } from '@/features/chat/tabs/TabManager';

function seedTabs(
  mgr: TabManager,
  sequence: Array<{ id: string; kind: 'chat' | 'work-order' }>,
): void {
  const internal = mgr as unknown as { tabs: Map<string, { id: string; kind: 'chat' | 'work-order' }> };
  for (const entry of sequence) {
    internal.tabs.set(entry.id, { id: entry.id, kind: entry.kind });
  }
}

function makeManager() {
  const plugin = {
    settings: { maxChatTabs: 10, agentBoardQueueCap: 10 },
    events: { emit: jest.fn() },
  } as never;
  return new TabManager(plugin, createMockEl() as never, {} as never);
}

describe('TabManager.getOrderedTabs', () => {
  it('returns chat tabs first then work-order tabs', () => {
    const mgr = makeManager();
    seedTabs(mgr, [
      { id: 'wo-1', kind: 'work-order' },
      { id: 'chat-1', kind: 'chat' },
      { id: 'wo-2', kind: 'work-order' },
      { id: 'chat-2', kind: 'chat' },
    ]);
    const ordered = mgr.getOrderedTabs().map((t) => t.id);
    expect(ordered).toEqual(['chat-1', 'chat-2', 'wo-1', 'wo-2']);
  });

  it('preserves insertion order within each group', () => {
    const mgr = makeManager();
    seedTabs(mgr, [
      { id: 'chat-a', kind: 'chat' },
      { id: 'chat-b', kind: 'chat' },
      { id: 'wo-a', kind: 'work-order' },
      { id: 'chat-c', kind: 'chat' },
      { id: 'wo-b', kind: 'work-order' },
    ]);
    const ordered = mgr.getOrderedTabs().map((t) => t.id);
    expect(ordered).toEqual(['chat-a', 'chat-b', 'chat-c', 'wo-a', 'wo-b']);
  });

  it('returns an empty list when no tabs are open', () => {
    expect(makeManager().getOrderedTabs()).toEqual([]);
  });
});
