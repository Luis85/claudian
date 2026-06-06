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
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    // Clear existing badges
    this.containerEl.empty();

    // Render badges. Track when the chat→work-order boundary is crossed so the
    // first WO badge gets an extra-gap modifier class.
    let sawChat = false;
    let workOrderGroupStarted = false;
    for (const item of items) {
      const isFirstWorkOrder = item.kind === 'work-order' && sawChat && !workOrderGroupStarted;
      if (item.kind === 'work-order') {
        workOrderGroupStarted = true;
      } else {
        sawChat = true;
      }
      this.renderBadge(item, isFirstWorkOrder);
    }
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem, isFirstWorkOrder: boolean): void {
    const stateClasses = ['claudian-tab-badge'];
    if (item.isActive) {
      stateClasses.push('claudian-tab-badge-active');
    }
    if (item.needsAttention) {
      stateClasses.push('claudian-tab-badge-attention');
    }
    if (item.isStreaming) {
      stateClasses.push('claudian-tab-badge-working');
    }
    if (!item.isActive && !item.needsAttention && !item.isStreaming) {
      stateClasses.push('claudian-tab-badge-idle');
    }
    if (item.kind === 'work-order') {
      stateClasses.push('claudian-tab-badge--work-order');
    }
    if (isFirstWorkOrder) {
      stateClasses.push('claudian-tab-badge--work-order-first');
    }

    // Work-order tabs render a wrench glyph instead of the index number so the
    // kind reads at a glance. Chat tabs keep the numeric badge.
    const badgeEl = item.kind === 'work-order'
      ? this.containerEl.createDiv({ cls: stateClasses.join(' ') })
      : this.containerEl.createDiv({ cls: stateClasses.join(' '), text: String(item.index) });

    if (item.kind === 'work-order') {
      const iconEl = badgeEl.createSpan({ cls: 'claudian-tab-badge-icon' });
      setIcon(iconEl, 'wrench');
    }

    // Tooltip with full title (aria-label only; adding title too causes double tooltip).
    // Combine work-order + working into a single parenthesised qualifier so the
    // label doesn't accumulate two adjacent `(...)` groups on a streaming WO tab.
    const qualifiers: string[] = [];
    if (item.kind === 'work-order') qualifiers.push('work order');
    if (item.isStreaming) qualifiers.push('working');
    const ariaLabel = qualifiers.length > 0
      ? `${item.title} (${qualifiers.join(', ')})`
      : item.title;
    badgeEl.setAttribute('aria-label', ariaLabel);
    if (item.isStreaming) {
      badgeEl.setAttribute('aria-busy', 'true');
      badgeEl.setAttribute('data-working', 'true');
    }
    badgeEl.setAttribute('data-provider', item.providerId);
    badgeEl.setAttribute('data-kind', item.kind);
    // Click handler to switch tab
    badgeEl.addEventListener('click', () => {
      this.callbacks.onTabClick(item.id);
    });

    // Right-click to close (if allowed)
    if (item.canClose) {
      badgeEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.callbacks.onTabClose(item.id);
      });
    }
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-tab-badges');
  }
}
