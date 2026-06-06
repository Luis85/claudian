import type {
  PersistedTabState,
  TabBarItem,
  TabData,
  TabKind,
} from '../../../../../src/features/chat/tabs/types';

describe('TabKind type', () => {
  it('accepts chat and work-order literals', () => {
    const a: TabKind = 'chat';
    const b: TabKind = 'work-order';
    expect([a, b]).toEqual(['chat', 'work-order']);
  });

  it('TabData carries kind', () => {
    const tabKind: TabData['kind'] = 'chat';
    expect(tabKind).toBe('chat');
  });

  it('PersistedTabState carries kind', () => {
    const persisted: Pick<PersistedTabState, 'kind'> = { kind: 'work-order' };
    expect(persisted.kind).toBe('work-order');
  });

  it('TabBarItem carries kind', () => {
    const item: Pick<TabBarItem, 'kind'> = { kind: 'work-order' };
    expect(item.kind).toBe('work-order');
  });
});
