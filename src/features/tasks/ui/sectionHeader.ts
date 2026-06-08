import { setIcon } from 'obsidian';

export interface SectionHeaderOptions {
  /** Lucide icon name rendered (faint) before the label. */
  icon: string;
  /** Uppercased-via-CSS label text (store natural-case; CSS handles casing). */
  label: string;
}

export interface SectionHeaderHandle {
  /** The `.claudian-work-order-modal-section` wrapper. */
  section: HTMLElement;
  /** The header row holding the icon + label + right slot. */
  header: HTMLElement;
  /**
   * Right-aligned slot in the header row (e.g. the Acceptance progress ring +
   * count). Created lazily on first access so headers without a trailing widget
   * stay clean.
   */
  right(): HTMLElement;
}

/**
 * Shared work-order modal section-header pattern: an uppercase label
 * (`--font-ui-smaller` / `--font-semibold` / `--text-muted`, letter-spacing
 * `--letter-spacing-wide`) with a leading faint Lucide icon and an optional
 * right-side slot. First consumer is the Objective + Acceptance slice; the
 * Activity-block slice reuses this helper rather than re-implementing the
 * pattern. Returns the section wrapper plus a lazy `right()` slot so callers
 * append trailing widgets (the Acceptance ring/count) only when needed.
 */
export function renderSectionHeader(
  parent: HTMLElement,
  options: SectionHeaderOptions,
): SectionHeaderHandle {
  const section = parent.createDiv({ cls: 'claudian-work-order-modal-section' });
  const header = section.createDiv({ cls: 'claudian-work-order-modal-section-head' });

  const title = header.createSpan({ cls: 'claudian-work-order-modal-section-title' });
  const iconEl = title.createSpan({ cls: 'claudian-work-order-modal-section-icon' });
  iconEl.setAttr('aria-hidden', 'true');
  // Mirror the editable-value-chip convention: stamp the icon name as a data
  // attribute so tests (where setIcon is a no-op) can assert which glyph renders.
  iconEl.setAttr('data-icon', options.icon);
  setIcon(iconEl, options.icon);
  title.createSpan({ cls: 'claudian-work-order-modal-section-label', text: options.label });

  let rightEl: HTMLElement | undefined;
  return {
    section,
    header,
    right: () => {
      rightEl ??= header.createDiv({ cls: 'claudian-work-order-modal-section-right' });
      return rightEl;
    },
  };
}
