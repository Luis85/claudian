/**
 * Shared keyboard-navigation helpers for list-style dropdowns
 * (ResumeSessionDropdown, SlashCommandDropdown).
 *
 * These are stateless utilities operating on a selection index and the
 * rendered item elements, so each dropdown keeps owning its own state,
 * element queries, and visibility/guard logic.
 */

export interface DropdownNavigationHandlers {
  /** Number of currently selectable items. */
  itemCount: number;
  /** Move the highlighted item by the given delta and repaint. */
  navigate: (direction: number) => void;
  /** Commit the highlighted item. */
  select: () => void;
  /** Close the dropdown. */
  dismiss: () => void;
}

/**
 * Dispatch an arrow/enter/tab/escape key for a dropdown. Returns true when the
 * event was consumed (and `preventDefault` called), false otherwise. Callers
 * are responsible for their own visibility/enabled gating before invoking.
 */
export function handleDropdownNavigationKey(
  e: KeyboardEvent,
  handlers: DropdownNavigationHandlers,
): boolean {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      handlers.navigate(1);
      return true;
    case 'ArrowUp':
      e.preventDefault();
      handlers.navigate(-1);
      return true;
    case 'Enter':
    case 'Tab':
      if (handlers.itemCount > 0) {
        e.preventDefault();
        handlers.select();
        return true;
      }
      return false;
    case 'Escape':
      e.preventDefault();
      handlers.dismiss();
      return true;
  }
  return false;
}

/** Clamp `current + delta` into the valid [0, maxIndex] selection range. */
export function clampSelectionIndex(current: number, delta: number, maxIndex: number): number {
  return Math.max(0, Math.min(maxIndex, current + delta));
}

/**
 * Toggle the `selected` class across rendered items, scrolling the active one
 * into view. Accepts the raw `querySelectorAll` result (possibly undefined).
 */
export function applySelectionClass(
  items: NodeListOf<Element> | undefined,
  selectedIndex: number,
): void {
  items?.forEach((item, index) => {
    if (index === selectedIndex) {
      item.addClass('selected');
      (item as HTMLElement).scrollIntoView({ block: 'nearest' });
    } else {
      item.removeClass('selected');
    }
  });
}
