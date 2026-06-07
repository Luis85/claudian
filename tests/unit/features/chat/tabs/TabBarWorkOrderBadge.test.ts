import { createMockEl } from '@test/helpers/mockElement';

import { TabBar } from '@/features/chat/tabs/TabBar';
import type { TabBarItem } from '@/features/chat/tabs/types';

const item: TabBarItem = {
  id: 'chat',
  index: 1,
  title: 'Chat',
  providerId: 'claude',
  isActive: false,
  isStreaming: false,
  needsAttention: false,
  canClose: true,
  kind: 'chat',
};

describe('TabBar visible work-order removal', () => {
  it('renders the filtered chat items it receives', () => {
    const host = createMockEl();
    new TabBar(host, { onTabClick: jest.fn(), onTabClose: jest.fn(), onNewTab: jest.fn() }).update([item]);
    expect(host._children).toHaveLength(1);
    expect(host._children[0].getAttribute('data-kind')).toBe('chat');
  });
});
