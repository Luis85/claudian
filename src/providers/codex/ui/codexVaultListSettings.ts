import { renderCodexListPanel } from './codexListPanel';

/**
 * Shared lifecycle for the Codex vault settings panels (skills, subagents).
 *
 * Both panels share the same `render()` flow: clear the container, load the
 * vault items (treating a load failure as an empty list), then hand off to
 * {@link renderCodexListPanel}. Subclasses keep their own item-row rendering,
 * add/edit modal wiring, and delete flows because those genuinely diverge per
 * panel; only the load-and-render skeleton lives here.
 */
export abstract class CodexVaultListSettings<TItem> {
  protected items: TItem[] = [];

  protected constructor(protected readonly containerEl: HTMLElement) {}

  /** Header label shown at the top-left of the panel. */
  protected abstract getLabel(): string;
  /** Message shown when there are no items to list. */
  protected abstract getEmptyText(): string;
  /** Loads the vault items; thrown errors are treated as an empty list. */
  protected abstract loadItems(): Promise<TItem[]>;
  /** Renders a single item row into the shared list container. */
  protected abstract renderItem(listEl: HTMLElement, item: TItem): void;
  /** Opens the add/edit modal for the panel. */
  protected abstract openModal(existing: TItem | null): void;

  /** Invoked by the panel's refresh button; defaults to a plain re-render. */
  protected onRefresh(): void {
    void this.render();
  }

  async render(): Promise<void> {
    this.containerEl.empty();

    try {
      this.items = await this.loadItems();
    } catch {
      this.items = [];
    }

    renderCodexListPanel(this.containerEl, {
      label: this.getLabel(),
      emptyText: this.getEmptyText(),
      items: this.items,
      onRefresh: () => { this.onRefresh(); },
      onAdd: () => this.openModal(null),
      renderItem: (listEl, item) => this.renderItem(listEl, item),
    });
  }
}
