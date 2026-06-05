import type { UsageRecord } from '../../../core/usage/types';
import { t } from '../../../i18n/i18n';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageBadgeI18n {
  uses_zero: string;
  uses_one: string;
  uses_many: string;       // contains "{count}"
  never: string;
  today: string;
  daysAgo_one: string;
  daysAgo_many: string;    // contains "{count}"
}

/**
 * Returns the small muted text shown after an action or skill name.
 * Examples: "0 uses · never", "1 use · today", "47 uses · 12 days ago".
 *
 * `nowMs` is injected so callers can pass a fixture clock in tests.
 */
export function formatUsageBadge(
  record: UsageRecord | null,
  nowMs: number,
  i18n: UsageBadgeI18n,
): string {
  const count = record?.count ?? 0;
  const usesPart =
    count === 0 ? i18n.uses_zero
    : count === 1 ? i18n.uses_one
    : i18n.uses_many.replace('{count}', String(count));

  if (!record || count === 0) {
    return `${usesPart} · ${i18n.never}`;
  }

  const days = Math.floor((nowMs - record.lastUsedAt) / ONE_DAY_MS);
  const lastPart =
    days < 1 ? i18n.today
    : days === 1 ? i18n.daysAgo_one
    : i18n.daysAgo_many.replace('{count}', String(days));

  return `${usesPart} · ${lastPart}`;
}

/**
 * Loads the i18n strings for the badge from the active locale.
 * Shared by UsageStatsTab and inline-badge sites.
 */
export function loadBadgeI18n(): UsageBadgeI18n {
  return {
    uses_zero: t('quickActions.usage.uses_zero'),
    uses_one: t('quickActions.usage.uses_one'),
    uses_many: t('quickActions.usage.uses'),
    never: t('quickActions.usage.lastUsed.never'),
    today: t('quickActions.usage.lastUsed.today'),
    daysAgo_one: t('quickActions.usage.lastUsed.daysAgo_one'),
    daysAgo_many: t('quickActions.usage.lastUsed.daysAgo'),
  };
}
