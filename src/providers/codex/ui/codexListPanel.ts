import { setIcon } from 'obsidian';

interface CodexListPanelOptions<T> {
  /** Header label shown at the top-left of the panel. */
  label: string;
  /** Message shown when there are no items to list. */
  emptyText: string;
  /** Items to render; an empty array swaps in the empty state. */
  items: T[];
  /** Invoked when the refresh action button is clicked. */
  onRefresh: () => void;
  /** Invoked when the add action button is clicked. */
  onAdd: () => void;
  /** Renders a single item row into the shared list container. */
  renderItem: (listEl: HTMLElement, item: T) => void;
}

/**
 * Shared scaffold for the Codex vault settings panels (skills, subagents):
 * a labelled header with refresh/add action buttons, an empty state, and the
 * per-item list container. Per-item row rendering diverges between panels, so
 * callers supply their own `renderItem`.
 */
export function renderCodexListPanel<T>(
  containerEl: HTMLElement,
  options: CodexListPanelOptions<T>,
): void {
  const headerEl = containerEl.createDiv({ cls: 'claudian-sp-header' });
  headerEl.createSpan({ text: options.label, cls: 'claudian-sp-label' });

  const actionsEl = headerEl.createDiv({ cls: 'claudian-sp-header-actions' });

  const refreshBtn = actionsEl.createEl('button', {
    cls: 'claudian-settings-action-btn',
    attr: { 'aria-label': 'Refresh' },
  });
  setIcon(refreshBtn, 'refresh-cw');
  refreshBtn.addEventListener('click', options.onRefresh);

  const addBtn = actionsEl.createEl('button', {
    cls: 'claudian-settings-action-btn',
    attr: { 'aria-label': 'Add' },
  });
  setIcon(addBtn, 'plus');
  addBtn.addEventListener('click', options.onAdd);

  if (options.items.length === 0) {
    const emptyEl = containerEl.createDiv({ cls: 'claudian-sp-empty-state' });
    emptyEl.setText(options.emptyText);
    return;
  }

  const listEl = containerEl.createDiv({ cls: 'claudian-sp-list' });
  for (const item of options.items) {
    options.renderItem(listEl, item);
  }
}
