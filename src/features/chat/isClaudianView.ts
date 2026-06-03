import type { ClaudianView } from './ClaudianView';

/**
 * Structural predicate for `ClaudianView` leaves.
 *
 * Used wherever code looks up a chat-view leaf via `workspace.getLeavesOfType`
 * and needs to access `ClaudianView`-specific methods without an unchecked
 * cast. Duck-typed against `getTabManager` so the predicate has no runtime
 * dependency on the `ClaudianView` class (avoids cycles between `main.ts`
 * and feature modules).
 *
 * Pair with `leaf.loadIfDeferred()` before the predicate when the leaf may
 * still be a placeholder — Obsidian's deferred-view feature can hand back a
 * leaf whose `view` is a stub until the user activates it.
 */
export function isClaudianView(value: unknown): value is ClaudianView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}
