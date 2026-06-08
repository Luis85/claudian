import { setIcon } from 'obsidian';

import type { WorkOrderActivitySummary } from '../../../core/types/workOrderActivity';
import { t } from '../../../i18n/i18n';

export interface WorkOrderActivityDropdownProps {
  summary: WorkOrderActivitySummary;
  onOpenItem(id: string): void | Promise<void>;
  onCloseItem(tabId: string): void | Promise<void>;
}

export class WorkOrderActivityDropdown {
  private open = false;

  constructor(private readonly hostEl: HTMLElement, private props: WorkOrderActivityDropdownProps) {
    this.render();
  }

  update(summary: WorkOrderActivitySummary): void {
    this.props = { ...this.props, summary };
    if (this.entryCount(summary) === 0) this.open = false;
    this.render();
  }

  destroy(): void {
    this.hostEl.empty();
  }

  private entryCount(summary: WorkOrderActivitySummary): number {
    return summary.items.length + summary.closableTabs.length;
  }

  private render(): void {
    this.hostEl.empty();
    const { summary } = this.props;
    const isEmpty = this.entryCount(summary) === 0;
    // Toggle hidden so the empty host stops contributing to the parent's
    // flexbox gap — otherwise a 12px gap on each side leaks ~24px between
    // sibling header buttons when no work-order activity exists.
    this.hostEl.toggleClass('claudian-hidden', isEmpty);
    if (isEmpty) return;
    const root = this.hostEl.createDiv({ cls: 'claudian-work-order-activity' });
    const classes = ['claudian-header-btn', 'claudian-work-order-activity-toggle'];
    if (summary.attentionCount > 0) classes.push('claudian-work-order-activity-toggle--attention');
    const toggle = root.createDiv({ cls: classes.join(' ') });
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('tabindex', '0');
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', this.open ? 'true' : 'false');
    toggle.setAttribute('aria-label', this.toggleLabel(summary));
    setIcon(toggle.createSpan({ cls: 'claudian-work-order-activity-icon' }), 'clipboard-list');
    toggle.createSpan({ cls: 'claudian-work-order-activity-count', text: String(this.entryCount(summary)) });
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.open = !this.open;
      this.render();
    });
    toggle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.open = !this.open;
      this.render();
    });
    if (this.open) this.renderMenu(root);
  }

  private renderMenu(root: HTMLElement): void {
    const menu = root.createDiv({ cls: 'claudian-work-order-activity-menu' });
    menu.setAttribute('role', 'menu');
    for (const item of this.props.summary.items) {
      const row = menu.createDiv({ cls: 'claudian-work-order-activity-item' });
      row.setAttribute('role', 'menuitem');
      row.setAttribute('tabindex', '0');
      row.createSpan({ cls: 'claudian-work-order-activity-title', text: item.title });
      row.createSpan({ cls: 'claudian-work-order-activity-status', text: t(item.labelKey) });
      row.createSpan({ cls: 'claudian-work-order-activity-action', text: t(item.actionHintKey) });
      row.addEventListener('click', () => {
        this.selectItem(item.id);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.selectItem(item.id);
      });
    }
    for (const tab of this.props.summary.closableTabs) {
      const row = menu.createDiv({
        cls: 'claudian-work-order-activity-item claudian-work-order-activity-item--finished',
      });
      row.setAttribute('role', 'menuitem');
      row.createSpan({ cls: 'claudian-work-order-activity-title', text: tab.title });
      row.createSpan({ cls: 'claudian-work-order-activity-status', text: t('workOrderActivity.status.finished') });
      const close = row.createSpan({ cls: 'claudian-work-order-activity-close' });
      close.setAttribute('role', 'button');
      close.setAttribute('tabindex', '0');
      close.setAttribute('aria-label', t('workOrderActivity.action.close'));
      setIcon(close, 'x');
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        this.closeTab(tab.tabId);
      });
      close.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        this.closeTab(tab.tabId);
      });
    }
  }

  private selectItem(id: string): void {
    this.open = false;
    void this.props.onOpenItem(id);
    this.render();
  }

  private closeTab(tabId: string): void {
    void this.props.onCloseItem(tabId);
    // Keep the menu open so the user can dismiss several finished tabs in a row;
    // the subsequent summary update re-renders (and collapses if nothing remains).
  }

  private toggleLabel(summary: WorkOrderActivitySummary): string {
    if (summary.attentionCount > 0) {
      return t('workOrderActivity.toggleAttention', {
        count: String(summary.items.length),
        attention: String(summary.attentionCount),
      });
    }
    if (summary.items.length === 0 && summary.closableTabs.length > 0) {
      return t('workOrderActivity.toggleFinished', { count: String(summary.closableTabs.length) });
    }
    return t('workOrderActivity.toggleRunning', { count: String(summary.items.length) });
  }
}