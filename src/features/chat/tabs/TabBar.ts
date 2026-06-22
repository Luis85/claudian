import { setIcon } from 'obsidian';

import type { TabBarItem, TabId } from './types';

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab badge is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when the close button is clicked on a tab. */
  onTabClose: (tabId: TabId) => void;

  /** Called when the new tab button is clicked. */
  onNewTab: () => void;
}

/**
 * TabBar renders minimal numbered badge navigation.
 *
 * Chat tabs render with their 1-based index number; work-order tabs render
 * with a wrench glyph instead so they read as a distinct kind at a glance.
 * The first work-order badge after a chat group gets `--work-order-first` for
 * an extra left margin separating the two groups.
 */
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.build();
  }

  /** Builds the tab bar UI. */
  private build(): void {
    this.containerEl.addClass('claudian-tab-badges');
    // The badges are `role="tab"`; their container must be the enclosing tablist
    // for assistive tech to announce position/count correctly.
    this.containerEl.setAttribute('role', 'tablist');
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    // Clear existing badges
    this.containerEl.empty();

    // Roving tabindex (WAI-ARIA APG tablist): exactly one badge is a tab stop.
    // It's the active tab, or — when none is active — the first badge.
    const rovingIndex = Math.max(items.findIndex((item) => item.isActive), 0);

    // Render badges. Track when the chat→work-order boundary is crossed so the
    // first WO badge gets an extra-gap modifier class.
    let sawChat = false;
    let workOrderGroupStarted = false;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const isFirstWorkOrder = item.kind === 'work-order' && sawChat && !workOrderGroupStarted;
      if (item.kind === 'work-order') {
        workOrderGroupStarted = true;
      } else {
        sawChat = true;
      }
      this.renderBadge(item, isFirstWorkOrder, i === rovingIndex);
    }
  }

  /** Builds the state/kind class list for a badge. */
  private badgeStateClasses(item: TabBarItem, isFirstWorkOrder: boolean): string[] {
    const classes = ['claudian-tab-badge'];
    if (item.isActive) classes.push('claudian-tab-badge-active');
    if (item.needsAttention) classes.push('claudian-tab-badge-attention');
    if (item.isStreaming) classes.push('claudian-tab-badge-working');
    if (!item.isActive && !item.needsAttention && !item.isStreaming) classes.push('claudian-tab-badge-idle');
    if (item.kind === 'work-order') classes.push('claudian-tab-badge--work-order');
    if (item.kind !== 'work-order' && item.isAgentBound) classes.push('claudian-tab-badge--agent');
    if (isFirstWorkOrder) classes.push('claudian-tab-badge--work-order-first');
    return classes;
  }

  // Work-order tabs render a wrench glyph instead of the index number. An
  // agent-bound chat tab prepends a small user glyph before the number so the
  // binding reads at a glance. A plain chat tab keeps the number as the badge's
  // own text (unchanged).
  private createBadgeEl(item: TabBarItem, cls: string): HTMLElement {
    if (item.kind === 'work-order') {
      const el = this.containerEl.createDiv({ cls });
      setIcon(el.createSpan({ cls: 'claudian-tab-badge-icon' }), 'wrench');
      return el;
    }
    if (item.isAgentBound) {
      const el = this.containerEl.createDiv({ cls });
      setIcon(el.createSpan({ cls: 'claudian-tab-badge-agent-icon' }), 'user');
      el.createSpan({ cls: 'claudian-tab-badge-number', text: String(item.index) });
      return el;
    }
    return this.containerEl.createDiv({ cls, text: String(item.index) });
  }

  /** Composes the aria-label, suffixing kind/state qualifiers in one `(...)` group. */
  private badgeAriaLabel(item: TabBarItem): string {
    const qualifiers: string[] = [];
    if (item.kind === 'work-order') qualifiers.push('work order');
    if (item.kind !== 'work-order' && item.isAgentBound) qualifiers.push('agent');
    if (item.isStreaming) qualifiers.push('working');
    return qualifiers.length > 0 ? `${item.title} (${qualifiers.join(', ')})` : item.title;
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem, isFirstWorkOrder: boolean, isTabStop: boolean): void {
    const badgeEl = this.createBadgeEl(item, this.badgeStateClasses(item, isFirstWorkOrder).join(' '));

    // Tooltip with full title (aria-label only; adding title too causes double tooltip).
    badgeEl.setAttribute('aria-label', this.badgeAriaLabel(item));
    // Badges form a tab strip: expose role/selection and keep them keyboard-reachable.
    badgeEl.setAttribute('role', 'tab');
    // Roving tabindex: only the single tab stop is `0`; the rest are reachable
    // by arrow keys, not Tab.
    badgeEl.setAttribute('tabindex', isTabStop ? '0' : '-1');
    badgeEl.setAttribute('aria-selected', String(item.isActive));
    if (item.isStreaming) {
      badgeEl.setAttribute('aria-busy', 'true');
      badgeEl.setAttribute('data-working', 'true');
    }
    badgeEl.setAttribute('data-provider', item.providerId);
    badgeEl.setAttribute('data-kind', item.kind);
    // Inner glyphs are decorative; the composite aria-label carries the meaning.
    for (const iconCls of ['claudian-tab-badge-icon', 'claudian-tab-badge-agent-icon']) {
      badgeEl.querySelector(`.${iconCls}`)?.setAttribute('aria-hidden', 'true');
    }
    this.wireBadgeInteraction(badgeEl, item);
  }

  /** Wires click, right-click close, and keyboard activation/close for a badge. */
  private wireBadgeInteraction(badgeEl: HTMLElement, item: TabBarItem): void {
    badgeEl.addEventListener('click', () => {
      this.callbacks.onTabClick(item.id);
    });

    // Right-click to close (if allowed)
    if (item.canClose) {
      badgeEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.callbacks.onTabClose(item.id);
      });
      // Delete/Backspace mirrors the right-click close as the keyboard path.
      badgeEl.setAttribute('aria-keyshortcuts', 'Delete');
    }

    badgeEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.callbacks.onTabClick(item.id);
        return;
      }
      if (item.canClose && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        this.callbacks.onTabClose(item.id);
        return;
      }
      // Manual-activation tablist: arrows move focus only; they never switch the
      // active chat tab (that would be disruptive). Enter/Space still activates.
      if (this.handleRovingKey(e, badgeEl)) {
        e.preventDefault();
      }
    });
  }

  /**
   * Roving tabindex navigation over the currently rendered badges. Reads the
   * live badge set from the container at keydown time so it never holds stale
   * references across `update()` rebuilds. Returns true if the key was handled.
   */
  private handleRovingKey(e: KeyboardEvent, badgeEl: HTMLElement): boolean {
    const badges = Array.from(
      this.containerEl.querySelectorAll('.claudian-tab-badge'),
    ) as HTMLElement[];
    const current = badges.indexOf(badgeEl);
    if (current === -1 || badges.length === 0) return false;

    let target: number;
    switch (e.key) {
      case 'ArrowRight':
        target = (current + 1) % badges.length;
        break;
      case 'ArrowLeft':
        target = (current - 1 + badges.length) % badges.length;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = badges.length - 1;
        break;
      default:
        return false;
    }
    if (target === current) return true; // single badge: arrows are no-ops but consumed.

    // Shift the roving tab stop to the focus target, then move focus.
    badges[current].setAttribute('tabindex', '-1');
    badges[target].setAttribute('tabindex', '0');
    badges[target].focus();
    return true;
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-tab-badges');
  }
}
