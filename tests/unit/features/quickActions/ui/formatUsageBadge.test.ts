import type { UsageRecord } from '@/core/usage/types';
import { formatUsageBadge } from '@/features/quickActions/ui/formatUsageBadge';

const i18nFixture = {
  uses_zero: '0 uses',
  uses_one: '1 use',
  uses_many: '{count} uses',
  never: 'never',
  today: 'today',
  daysAgo_one: '1 day ago',
  daysAgo_many: '{count} days ago',
};

const oneDayMs = 24 * 60 * 60 * 1000;

describe('formatUsageBadge', () => {
  it('renders never for null record', () => {
    expect(formatUsageBadge(null, 100_000, i18nFixture)).toBe('0 uses · never');
  });

  it('renders today for same-day timestamps', () => {
    const rec: UsageRecord = { count: 1, lastUsedAt: 100_000 };
    expect(formatUsageBadge(rec, 100_000, i18nFixture)).toBe('1 use · today');
  });

  it('renders "1 day ago" for exactly one day', () => {
    const rec: UsageRecord = { count: 5, lastUsedAt: 100_000 };
    expect(formatUsageBadge(rec, 100_000 + oneDayMs, i18nFixture))
      .toBe('5 uses · 1 day ago');
  });

  it('renders "N days ago" for older', () => {
    const rec: UsageRecord = { count: 47, lastUsedAt: 100_000 };
    expect(formatUsageBadge(rec, 100_000 + oneDayMs * 12, i18nFixture))
      .toBe('47 uses · 12 days ago');
  });
});
