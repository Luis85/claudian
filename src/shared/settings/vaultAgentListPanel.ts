import type { App } from 'obsidian';

import { renderSettingsListBody, renderSettingsListHeader, renderSettingsListItem } from '../components/settingsListUI';
import { confirmDelete } from '../modals/ConfirmModal';

interface VaultListPanelOptions<T> {
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
 * Shared scaffold for the provider vault settings panels (Codex/Opencode
 * skills and subagents): a labelled header with refresh/add action buttons, an
 * empty state, and the per-item list container. Per-item row rendering diverges
 * between panels, so callers supply their own `renderItem`.
 */
export function renderVaultListPanel<T>(
  containerEl: HTMLElement,
  options: VaultListPanelOptions<T>,
): void {
  renderSettingsListHeader(containerEl, {
    label: options.label,
    onRefresh: options.onRefresh,
    onAdd: options.onAdd,
  });
  // This panel shows its empty hint only when there is nothing to list and never
  // renders an empty list container, so gate the hint on item count and return
  // early when empty.
  renderSettingsListBody({
    containerEl,
    items: options.items,
    emptyText: options.items.length === 0 ? options.emptyText : null,
    returnEarlyIfEmpty: true,
    renderItem: options.renderItem,
  });
}

interface VaultAgentListItemOptions {
  /** Agent name shown in the row header. */
  name: string;
  /** Optional description rendered under the header. */
  description?: string;
  /** Invoked when the edit affordance is clicked. */
  onEdit: () => void;
  /** Confirm-modal prompt shown before deleting. */
  deleteConfirmMessage: string;
  /**
   * Performs the delete. Resolves once the backing store has removed the agent
   * and any post-delete re-render/notify side effects have run. Callers own the
   * provider-specific success/failure notices; this helper only orchestrates the
   * confirm gate and surfaces failures through {@link onDeleteFailed}.
   */
  onDelete: () => Promise<void>;
  /** Invoked when {@link onDelete} throws, so callers can surface a notice. */
  onDeleteFailed: () => void;
}

/**
 * Standard vault agent/subagent list row: a {@link renderSettingsListItem} with
 * an edit affordance and a confirm-gated delete affordance. Returns the header
 * row so callers can append provider-specific badges after the name. The
 * delete flow (app guard, {@link confirmDelete}, delete, failure surfacing) is
 * identical across the Codex and Opencode panels; only the prompt text, the
 * delete body, and the notices differ, so those are parameterized.
 */
export function renderVaultAgentListItem(
  listEl: HTMLElement,
  app: App | undefined,
  options: VaultAgentListItemOptions,
): { headerRow: HTMLElement } {
  return renderSettingsListItem(listEl, {
    name: options.name,
    description: options.description,
    actions: [
      { icon: 'pencil', ariaLabel: 'Edit', onClick: options.onEdit },
      {
        icon: 'trash-2',
        ariaLabel: 'Delete',
        danger: true,
        onClick: () => {
          void (async (): Promise<void> => {
            if (!app) return;
            const confirmed = await confirmDelete(app, options.deleteConfirmMessage);
            if (!confirmed) return;
            try {
              await options.onDelete();
            } catch {
              options.onDeleteFailed();
            }
          })();
        },
      },
    ],
  });
}
