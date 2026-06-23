import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { TabBar, type TabBarCallbacks } from '@/features/chat/tabs/TabBar';
import type { TabBarItem } from '@/features/chat/tabs/types';

// Helper to create mock callbacks
function createMockCallbacks(): TabBarCallbacks {
  return {
    onTabClick: jest.fn(),
    onTabClose: jest.fn(),
    onNewTab: jest.fn(),
  };
}

// Helper to create tab bar items
function createTabBarItem(overrides: Partial<TabBarItem> = {}): TabBarItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Test Tab',
    providerId: 'claude',
    isActive: false,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    kind: 'chat',
    ...overrides,
  };
}

describe('TabBar', () => {
  describe('constructor', () => {
    it('should add tab badges class to container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();

      new TabBar(containerEl, callbacks);

      expect(containerEl._classList.has('specorator-tab-badges')).toBe(true);
    });

    it('marks the container as the tablist enclosing the role=tab badges', () => {
      const containerEl = createMockEl();
      new TabBar(containerEl, createMockCallbacks());
      expect(containerEl.getAttribute('role')).toBe('tablist');
    });
  });

  describe('update', () => {
    it('should clear existing badges before rendering', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      // First update
      tabBar.update([createTabBarItem()]);
      expect(containerEl._children.length).toBe(1);

      // Second update should clear first
      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);
      expect(containerEl._children.length).toBe(2);
    });

    it('should render badge for each tab item', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([
        createTabBarItem({ id: 'tab-1', index: 1 }),
        createTabBarItem({ id: 'tab-2', index: 2 }),
        createTabBarItem({ id: 'tab-3', index: 3 }),
      ]);

      expect(containerEl._children.length).toBe(3);
    });

    it('should render empty when no items', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([]);

      expect(containerEl._children.length).toBe(0);
    });
  });

  describe('badge rendering', () => {
    it('should display index number as text', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ index: 5 })]);

      expect(containerEl._children[0].textContent).toBe('5');
    });

    it('should set aria-label tooltip from item title', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ title: 'My Conversation' })]);

      expect(containerEl._children[0].getAttribute('aria-label')).toBe('My Conversation');
      // title attribute is intentionally omitted to prevent double tooltip
      expect(containerEl._children[0].getAttribute('title')).toBeNull();
    });

    it('should set a provider attribute for per-tab streaming colors', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ providerId: 'opencode' })]);

      expect(containerEl._children[0].getAttribute('data-provider')).toBe('opencode');
    });
  });

  describe('badge state classes', () => {
    it('should apply idle class for inactive tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: false, isStreaming: false, needsAttention: false })]);

      expect(containerEl._children[0]._classList.has('specorator-tab-badge-idle')).toBe(true);
    });

    it('should apply active class for active tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true })]);

      expect(containerEl._children[0]._classList.has('specorator-tab-badge-active')).toBe(true);
    });

    it('should apply working class for streaming tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isStreaming: true })]);

      expect(containerEl._children[0]._classList.has('specorator-tab-badge-working')).toBe(true);
    });

    it('should stack working class with active tab', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ isActive: true, isStreaming: true })]);

      const badge = containerEl._children[0];
      expect(badge._classList.has('specorator-tab-badge-active')).toBe(true);
      expect(badge._classList.has('specorator-tab-badge-working')).toBe(true);
      expect(badge.getAttribute('aria-busy')).toBe('true');
      expect(badge.getAttribute('data-working')).toBe('true');
      expect(badge.getAttribute('aria-label')).toContain('(working)');
    });

    it('marks a normal tab as working when streaming', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ isStreaming: true, isActive: false })]);

      const badge = containerEl._children[0];
      expect(badge._classList.has('specorator-tab-badge-working')).toBe(true);
      expect(badge.getAttribute('data-working')).toBe('true');
    });

    it('should apply attention class for tab needing attention', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('specorator-tab-badge-attention')).toBe(true);
    });

    it('should stack active and attention classes when both apply', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true, needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('specorator-tab-badge-active')).toBe(true);
      expect(containerEl._children[0]._classList.has('specorator-tab-badge-attention')).toBe(true);
    });

    it('should stack attention and working classes when both apply', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isStreaming: true, needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('specorator-tab-badge-attention')).toBe(true);
      expect(containerEl._children[0]._classList.has('specorator-tab-badge-working')).toBe(true);
    });
  });

  describe('badge interactions', () => {
    it('should call onTabClick when badge is clicked', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'clicked-tab' })]);

      // Simulate click
      containerEl._children[0].dispatchEvent('click');

      expect(callbacks.onTabClick).toHaveBeenCalledWith('clicked-tab');
    });

    it('should call onTabClose on right-click when canClose is true', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);

      // Simulate right-click (contextmenu)
      const mockEvent = { preventDefault: jest.fn() };
      containerEl._children[0].dispatchEvent('contextmenu', mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(callbacks.onTabClose).toHaveBeenCalledWith('closeable-tab');
    });

    it('should not register contextmenu handler when canClose is false', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'uncloseable-tab', canClose: false })]);

      // Check that contextmenu handler was not registered
      expect(containerEl._children[0]._eventListeners.has('contextmenu')).toBe(false);
    });
  });

  describe('badge accessibility', () => {
    it('exposes role=tab, roving tabindex, and aria-selected reflecting isActive', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([
        createTabBarItem({ id: 'active', isActive: true }),
        createTabBarItem({ id: 'inactive', index: 2, isActive: false }),
      ]);

      const [activeBadge, inactiveBadge] = containerEl._children;
      expect(activeBadge.getAttribute('role')).toBe('tab');
      // Roving tabindex: the active badge is the single tab stop.
      expect(activeBadge.getAttribute('tabindex')).toBe('0');
      expect(activeBadge.getAttribute('aria-selected')).toBe('true');
      expect(inactiveBadge.getAttribute('tabindex')).toBe('-1');
      expect(inactiveBadge.getAttribute('aria-selected')).toBe('false');
    });

    it('gives exactly one badge tabindex=0 (the active one)', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([
        createTabBarItem({ id: 'a', index: 1, isActive: false }),
        createTabBarItem({ id: 'b', index: 2, isActive: true }),
        createTabBarItem({ id: 'c', index: 3, isActive: false }),
      ]);

      const tabStops = containerEl._children.filter(
        (b: MockElement) => b.getAttribute('tabindex') === '0',
      );
      expect(tabStops.length).toBe(1);
      expect(tabStops[0].getAttribute('aria-selected')).toBe('true');
    });

    it('makes the first badge the tab stop when none is active', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([
        createTabBarItem({ id: 'a', index: 1, isActive: false }),
        createTabBarItem({ id: 'b', index: 2, isActive: false }),
      ]);

      const [first, second] = containerEl._children;
      expect(first.getAttribute('tabindex')).toBe('0');
      expect(second.getAttribute('tabindex')).toBe('-1');
    });

    it('ArrowRight moves focus and roving tabindex to the next badge', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([
        createTabBarItem({ id: 'a', index: 1, isActive: true }),
        createTabBarItem({ id: 'b', index: 2, isActive: false }),
      ]);

      const [first, second] = containerEl._children;
      const focused = jest.fn();
      second.addEventListener('focus', focused);

      const preventDefault = jest.fn();
      first.dispatchEvent('keydown', { key: 'ArrowRight', preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(second.getAttribute('tabindex')).toBe('0');
      expect(first.getAttribute('tabindex')).toBe('-1');
      expect(focused).toHaveBeenCalled();
      // Manual activation: focus moves but the tab is not switched.
      expect(callbacks.onTabClick).not.toHaveBeenCalled();
    });

    it('ArrowLeft moves focus and roving tabindex to the previous badge', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([
        createTabBarItem({ id: 'a', index: 1, isActive: false }),
        createTabBarItem({ id: 'b', index: 2, isActive: true }),
      ]);

      const [first, second] = containerEl._children;
      const focused = jest.fn();
      first.addEventListener('focus', focused);

      const preventDefault = jest.fn();
      second.dispatchEvent('keydown', { key: 'ArrowLeft', preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(first.getAttribute('tabindex')).toBe('0');
      expect(second.getAttribute('tabindex')).toBe('-1');
      expect(focused).toHaveBeenCalled();
    });

    it('ArrowRight wraps from the last badge to the first', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([
        createTabBarItem({ id: 'a', index: 1, isActive: false }),
        createTabBarItem({ id: 'b', index: 2, isActive: true }),
      ]);

      const [first, second] = containerEl._children;
      const focused = jest.fn();
      first.addEventListener('focus', focused);

      second.dispatchEvent('keydown', { key: 'ArrowRight', preventDefault: jest.fn() });

      expect(first.getAttribute('tabindex')).toBe('0');
      expect(second.getAttribute('tabindex')).toBe('-1');
      expect(focused).toHaveBeenCalled();
    });

    it('ArrowLeft wraps from the first badge to the last', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([
        createTabBarItem({ id: 'a', index: 1, isActive: true }),
        createTabBarItem({ id: 'b', index: 2, isActive: false }),
      ]);

      const [first, last] = containerEl._children;
      const focused = jest.fn();
      last.addEventListener('focus', focused);

      first.dispatchEvent('keydown', { key: 'ArrowLeft', preventDefault: jest.fn() });

      expect(last.getAttribute('tabindex')).toBe('0');
      expect(first.getAttribute('tabindex')).toBe('-1');
      expect(focused).toHaveBeenCalled();
    });

    it('Home focuses the first badge and End focuses the last', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([
        createTabBarItem({ id: 'a', index: 1, isActive: false }),
        createTabBarItem({ id: 'b', index: 2, isActive: true }),
        createTabBarItem({ id: 'c', index: 3, isActive: false }),
      ]);

      const [first, middle, last] = containerEl._children;

      const endFocus = jest.fn();
      last.addEventListener('focus', endFocus);
      middle.dispatchEvent('keydown', { key: 'End', preventDefault: jest.fn() });
      expect(last.getAttribute('tabindex')).toBe('0');
      expect(middle.getAttribute('tabindex')).toBe('-1');
      expect(endFocus).toHaveBeenCalled();

      const homeFocus = jest.fn();
      first.addEventListener('focus', homeFocus);
      last.dispatchEvent('keydown', { key: 'Home', preventDefault: jest.fn() });
      expect(first.getAttribute('tabindex')).toBe('0');
      expect(last.getAttribute('tabindex')).toBe('-1');
      expect(homeFocus).toHaveBeenCalled();
    });

    it('treats arrows as no-ops for a single badge but consumes the key', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'only', isActive: true })]);

      const [only] = containerEl._children;
      const preventDefault = jest.fn();
      only.dispatchEvent('keydown', { key: 'ArrowRight', preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(only.getAttribute('tabindex')).toBe('0');
      expect(callbacks.onTabClick).not.toHaveBeenCalled();
    });

    it('still activates on Enter/Space and still closes on Delete with roving enabled', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'kbd', canClose: true })]);

      const [badge] = containerEl._children;

      badge.dispatchEvent('keydown', { key: ' ', preventDefault: jest.fn() });
      expect(callbacks.onTabClick).toHaveBeenCalledWith('kbd');

      badge.dispatchEvent('keydown', { key: 'Delete', preventDefault: jest.fn() });
      expect(callbacks.onTabClose).toHaveBeenCalledWith('kbd');
    });

    it('fires onTabClick on Enter keydown', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'kbd-tab' })]);

      const preventDefault = jest.fn();
      containerEl._children[0].dispatchEvent('keydown', { key: 'Enter', preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(callbacks.onTabClick).toHaveBeenCalledWith('kbd-tab');
    });

    it('fires onTabClose on Delete keydown for a closeable badge', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);

      const badge = containerEl._children[0];
      expect(badge.getAttribute('aria-keyshortcuts')).toBe('Delete');

      const preventDefault = jest.fn();
      badge.dispatchEvent('keydown', { key: 'Delete', preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(callbacks.onTabClose).toHaveBeenCalledWith('closeable-tab');
    });

    it('does not close on Delete keydown when canClose is false', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'uncloseable-tab', canClose: false })]);

      const badge = containerEl._children[0];
      expect(badge.getAttribute('aria-keyshortcuts')).toBeNull();
      badge.dispatchEvent('keydown', { key: 'Delete', preventDefault: jest.fn() });

      expect(callbacks.onTabClose).not.toHaveBeenCalled();
    });

    it('marks inner icon glyphs aria-hidden', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ index: 2, isAgentBound: true })]);

      const icon = containerEl._children[0]._children.find((c: MockElement) =>
        c.hasClass('specorator-tab-badge-agent-icon'),
      );
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('destroy', () => {
    it('should empty container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);
      expect(containerEl._children.length).toBe(2);

      tabBar.destroy();

      expect(containerEl._children.length).toBe(0);
    });

    it('should remove tab badges class from container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      expect(containerEl._classList.has('specorator-tab-badges')).toBe(true);

      tabBar.destroy();

      expect(containerEl._classList.has('specorator-tab-badges')).toBe(false);
    });
  });

  describe('agent-bound badge', () => {
    it('renders a user glyph, --agent class, number span, and "agent" aria qualifier', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ index: 2, isAgentBound: true, title: 'My chat' })]);

      const badge = containerEl._children[0];
      expect(badge.hasClass('specorator-tab-badge--agent')).toBe(true);
      expect(badge._children.some((c: MockElement) => c.hasClass('specorator-tab-badge-agent-icon'))).toBe(true);
      const number = badge._children.find((c: MockElement) => c.hasClass('specorator-tab-badge-number'));
      expect(number?.textContent).toBe('2');
      expect(badge.getAttribute('aria-label')).toBe('My chat (agent)');
    });

    it('does not mark a non-bound chat badge', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ index: 3 })]);

      const badge = containerEl._children[0];
      expect(badge.hasClass('specorator-tab-badge--agent')).toBe(false);
      expect(badge._children.some((c: MockElement) => c.hasClass('specorator-tab-badge-agent-icon'))).toBe(false);
      expect(badge.textContent).toBe('3');
    });

    it('ignores isAgentBound on a work-order badge (glyph gated to chat)', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ kind: 'work-order', isAgentBound: true })]);

      const badge = containerEl._children[0];
      expect(badge.hasClass('specorator-tab-badge--agent')).toBe(false);
      expect(badge._children.some((c: MockElement) => c.hasClass('specorator-tab-badge-agent-icon'))).toBe(false);
    });
  });
});
