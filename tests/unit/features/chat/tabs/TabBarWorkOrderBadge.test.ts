import { createMockEl } from '@test/helpers/mockElement';

import { TabBar } from '@/features/chat/tabs/TabBar';
import type { TabBarItem } from '@/features/chat/tabs/types';

function item(overrides: Partial<TabBarItem>): TabBarItem {
  return {
    id: 't',
    index: 1,
    title: 'Tab',
    providerId: 'claude',
    isActive: false,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    kind: 'chat',
    ...overrides,
  } as TabBarItem;
}

function findBadge(host: ReturnType<typeof createMockEl>): { classes: Set<string>; attrs: Map<string, string> } | null {
  const children = (host as unknown as { _children: Array<{ _classes: Set<string>; _attributes: Map<string, string> }> })._children;
  for (const c of children) {
    if (c._classes.has('claudian-tab-badge')) {
      return { classes: c._classes, attrs: c._attributes };
    }
  }
  return null;
}

describe('TabBar work-order badge styling', () => {
  it('adds work-order class to work-order badges', () => {
    const host = createMockEl();
    const bar = new TabBar(host as never, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([item({ id: 'wo', kind: 'work-order' })]);
    const badge = findBadge(host);
    expect(badge).not.toBeNull();
    expect(badge?.classes.has('claudian-tab-badge--work-order')).toBe(true);
    expect(badge?.attrs.get('data-kind')).toBe('work-order');
  });

  it('does not add the work-order class to chat badges', () => {
    const host = createMockEl();
    const bar = new TabBar(host as never, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([item({ id: 'c', kind: 'chat' })]);
    const badge = findBadge(host);
    expect(badge?.classes.has('claudian-tab-badge--work-order')).toBe(false);
    expect(badge?.attrs.get('data-kind')).toBe('chat');
  });

  it('appends a (work order) suffix to the aria label', () => {
    const host = createMockEl();
    const bar = new TabBar(host as never, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([item({ id: 'wo', title: 'Refactor task', kind: 'work-order' })]);
    const badge = findBadge(host);
    expect(badge?.attrs.get('aria-label')).toContain('Refactor task');
    expect(badge?.attrs.get('aria-label')).toMatch(/\(work order\)/i);
  });

  it('renders an icon span on work-order badges instead of the index number', () => {
    const host = createMockEl();
    const bar = new TabBar(host as never, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([item({ id: 'wo', index: 2, kind: 'work-order' })]);
    const children = (host as unknown as { _children: Array<{ _children: Array<{ _classes: Set<string> }> }> })._children;
    const badge = children.find((c) => (c as unknown as { _classes: Set<string> })._classes.has('claudian-tab-badge'));
    const iconChild = badge?._children.find((ch) => ch._classes.has('claudian-tab-badge-icon'));
    expect(iconChild).toBeDefined();
  });

  it('adds work-order-first class to the first WO badge after a chat group', () => {
    const host = createMockEl();
    const bar = new TabBar(host as never, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([
      item({ id: 'c1', index: 1, kind: 'chat' }),
      item({ id: 'wo1', index: 2, kind: 'work-order' }),
      item({ id: 'wo2', index: 3, kind: 'work-order' }),
    ]);
    const children = (host as unknown as { _children: Array<{ _classes: Set<string>; _attributes: Map<string, string> }> })._children;
    const wo1 = children.find((c) => c._attributes.get('data-kind') === 'work-order' && c._classes.has('claudian-tab-badge--work-order-first'));
    const wo2Badges = children.filter((c) => c._attributes.get('data-kind') === 'work-order');
    expect(wo1).toBeDefined();
    // Only the first WO badge gets the modifier — subsequent WO badges do not.
    expect(wo2Badges.filter((b) => b._classes.has('claudian-tab-badge--work-order-first'))).toHaveLength(1);
  });

  it('does not add work-order-first when no chat tabs precede the WO group', () => {
    const host = createMockEl();
    const bar = new TabBar(host as never, { onTabClick: () => {}, onTabClose: () => {}, onNewTab: () => {} });
    bar.update([item({ id: 'wo1', kind: 'work-order' })]);
    const badge = findBadge(host);
    expect(badge?.classes.has('claudian-tab-badge--work-order-first')).toBe(false);
  });
});
