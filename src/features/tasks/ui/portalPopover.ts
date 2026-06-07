import { setIcon } from 'obsidian';

/**
 * One row in a portal-positioned popover menu.
 */
export interface PortalPopoverItem {
  /** Already-translated, user-visible label. */
  label: string;
  /** Lucide glyph rendered as a leading icon. */
  icon: string;
  /** Marks a destructive action (rendered in `--color-red`). */
  danger?: boolean;
  /** Invoked when the item is selected; the menu closes first. */
  run: () => void;
}

interface PortalPopoverOptions {
  /** The button the popover anchors to (its rect drives `position: fixed`). */
  trigger: HTMLElement;
  items: PortalPopoverItem[];
  /** Class applied to the popover root (caller owns the visual styling). */
  menuClass: string;
  /** Class applied to each menu item button. */
  itemClass: string;
  /** Class applied to each item's leading icon span. */
  itemIconClass: string;
  /** Modifier class added to destructive items. */
  itemDangerClass: string;
  /** Modifier class added when the popover flips above the trigger. */
  upClass: string;
}

// Per-item height + padding used to estimate the popover height before it is
// measured, so the viewport-flip decision can be made up front. Mirrors the
// prototype's `items.length * 34 + 8`.
const ITEM_HEIGHT = 34;
const MENU_PADDING = 8;
const MENU_MIN_WIDTH = 180;
// Gap between the trigger and the popover edge.
const OFFSET = 4;
// Keep the popover this far from the viewport edges when clamping horizontally.
const VIEWPORT_MARGIN = 8;

/**
 * A portal-positioned popover menu.
 *
 * Why this exists (and not Obsidian's `Menu`): the Agent Board lane card list is
 * an `overflow-y: auto` container. An absolutely-positioned popover taller than
 * its card would add a vertical scrollbar to the lane. Obsidian's built-in
 * `Menu` mounts relative to the cursor and does not expose the fixed-from-rect
 * positioning model we need. This helper renders the popover on `document.body`
 * (a portal), positions it with `position: fixed` computed from the trigger's
 * `getBoundingClientRect()`, flips upward near the viewport bottom, and closes
 * on scroll / resize / outside-click / Escape — returning focus to the trigger.
 *
 * Lifecycle: `open()` mounts the popover and registers listeners; `close()`
 * removes the popover AND every listener (no leaked detached nodes or dangling
 * scroll/resize/click handlers). `isOpen()` lets the caller toggle.
 */
export class PortalPopover {
  private popover: HTMLElement | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly options: PortalPopoverOptions) {}

  isOpen(): boolean {
    return this.popover !== null;
  }

  open(): void {
    if (this.popover) return;
    const { items, menuClass, itemClass, itemIconClass, itemDangerClass } = this.options;

    const pop = document.body.createDiv({ cls: menuClass });
    pop.setAttribute('role', 'menu');
    // Keep the popover focusable so Escape (and a programmatic focus on open)
    // has a reliable target even before any item is hovered.
    pop.setAttribute('tabindex', '-1');
    pop.style.position = 'fixed';
    // The card itself opens the detail view on click; keep popover clicks local.
    pop.addEventListener('click', (event) => event.stopPropagation());
    pop.addEventListener('mousedown', (event) => event.stopPropagation());

    for (const item of items) {
      const button = pop.createEl('button', { cls: itemClass, attr: { type: 'button' } });
      button.setAttribute('role', 'menuitem');
      if (item.danger) button.addClass(itemDangerClass);
      const iconEl = button.createSpan({ cls: itemIconClass });
      iconEl.setAttribute('aria-hidden', 'true');
      iconEl.setAttribute('data-icon', item.icon);
      setIcon(iconEl, item.icon);
      button.createSpan({ text: item.label });
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.close();
        item.run();
      });
    }

    this.popover = pop;
    this.position(pop, items.length);

    // Outside-click (mousedown so a drag-start outside also dismisses), scroll
    // (capture: catches scrolling inside any ancestor, e.g. the lane), resize,
    // and Escape all close — listeners torn down together in close().
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (this.options.trigger.contains(target) || pop.contains(target)) return;
      this.close();
    };
    const onReflow = (): void => this.close();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    };

    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    pop.addEventListener('keydown', onKeyDown);
    this.cleanups.push(
      () => document.removeEventListener('mousedown', onPointerDown, true),
      () => window.removeEventListener('scroll', onReflow, true),
      () => window.removeEventListener('resize', onReflow),
      () => pop.removeEventListener('keydown', onKeyDown),
    );

    pop.focus();
  }

  close(): void {
    if (!this.popover) return;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const pop = this.popover;
    this.popover = null;
    pop.remove();
    // Return focus to the trigger so keyboard users are not stranded.
    this.options.trigger.focus();
  }

  /** Compute fixed coordinates from the trigger rect, flipping up near the bottom. */
  private position(pop: HTMLElement, itemCount: number): void {
    const rect = this.options.trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const estimatedHeight = itemCount * ITEM_HEIGHT + MENU_PADDING;

    const dropUp = rect.bottom + estimatedHeight + OFFSET > viewportHeight && rect.top - estimatedHeight > 0;
    const top = dropUp ? rect.top - estimatedHeight - OFFSET : rect.bottom + OFFSET;
    // Right-align the popover under the trigger, clamped into the viewport.
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.right - MENU_MIN_WIDTH, viewportWidth - MENU_MIN_WIDTH - VIEWPORT_MARGIN),
    );

    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    pop.toggleClass(this.options.upClass, dropUp);
  }
}
