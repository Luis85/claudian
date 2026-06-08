/**
 * Agents persona seam — the assignee concept for work orders.
 *
 * A persona is the visible identity a work order is assigned to. Today only the
 * built-in `standard` persona ships; a future Agents feature registers custom
 * personas through the registry without changing the read sites here.
 */
export interface AgentPersona {
  /** Stable identity. `'standard'` is reserved for the built-in. */
  id: string;
  /** Display name. Sourced from i18n for the built-in so it localizes. */
  name: string;
  /**
   * Avatar color as an Obsidian CSS variable string (e.g. `var(--color-purple)`),
   * NOT a hardcoded hex — consumed via `color-mix` / a CSS custom property.
   */
  color: string;
  /** Two-letter monogram for custom personas (the built-in uses an icon). */
  initials?: string;
  /** True only for the built-in `standard` persona. */
  builtin?: boolean;
}

/** Reserved id of the built-in persona — the resolve fallback target. */
export const STANDARD_PERSONA_ID = 'standard';
