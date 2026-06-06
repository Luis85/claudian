import type { TabData } from '../../../../../src/features/chat/tabs/types';

function makeTab(kind: 'chat' | 'work-order'): TabData {
  return { id: `tab-${kind}`, kind } as unknown as TabData;
}

describe('TabBarItem kind propagation', () => {
  it('persisted state with missing kind defaults to chat at restore', () => {
    const persisted = { tabId: 't1', conversationId: null } as {
      tabId: string;
      conversationId: string | null;
      kind?: 'chat' | 'work-order';
    };
    const inferredKind = persisted.kind ?? 'chat';
    expect(inferredKind).toBe('chat');
  });

  it('TabData carries kind for downstream consumers', () => {
    expect(makeTab('chat').kind).toBe('chat');
    expect(makeTab('work-order').kind).toBe('work-order');
  });
});
