/**
 * Migrates legacy tab-budget keys to the current shape.
 *
 * Rules:
 * - If `maxTabs` exists and `maxChatTabs` does not, copy `maxTabs → maxChatTabs`.
 * - Drop `maxTabs` and `maxWorkOrderTabs` from the raw record. The work-order
 *   tab cap is no longer a standalone setting; the Agent Board queue cap
 *   (`agentBoardQueueCap`) is the single source of truth for "how many work
 *   orders at once", and `TabManager` derives the WO tab cap from it.
 *
 * Idempotent: safe to call on any partial or already-migrated state.
 * Pure mutation on the raw record so it slots into the settings load path
 * before validation/merge runs.
 */
export function migrateTabBudget(raw: Record<string, unknown>): void {
  if ('maxTabs' in raw && !('maxChatTabs' in raw)) {
    raw.maxChatTabs = raw.maxTabs;
  }
  delete raw.maxTabs;
  delete raw.maxWorkOrderTabs;
}
