/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import { EventBus } from '@/core/events/EventBus';
import type { UsageEventMap } from '@/core/usage/events';
import { serializeKey } from '@/core/usage/keys';
import type { UsageRecord } from '@/core/usage/types';
import type { SkillTabEntry } from '@/features/quickActions/skills/types';
import type { QuickAction } from '@/features/quickActions/types';
import { UsageStatsTab } from '@/features/quickActions/ui/UsageStatsTab';

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'quickActions.usage.empty') return 'No usage tracked yet';
    if (params && 'count' in params) {
      return String(key).replace('{count}', String(params.count));
    }
    return String(key);
  },
}));

const NOW = 1_000_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function makeTrackerStub(records: Record<string, UsageRecord>) {
  return {
    getAll(): ReadonlyMap<string, UsageRecord> {
      return new Map(Object.entries(records));
    },
  };
}

function makeQuickAction(stem: string): QuickAction {
  return {
    id: `Quick Actions/${stem}`,
    name: stem,
    description: '',
    prompt: 'p',
    filePath: `Quick Actions/${stem}.md`,
  };
}

function makeSkill(name: string, providerId: 'claude' | 'codex'): SkillTabEntry {
  return {
    id: `${providerId}:${name}`,
    providerId,
    providerDisplayName: providerId,
    name,
    description: '',
    insertPrefix: '$',
    sourceFilePath: null,
    providerEnabled: true,
  };
}

describe('UsageStatsTab', () => {
  let bus: EventBus<UsageEventMap>;

  beforeEach(() => {
    bus = new EventBus<UsageEventMap>();
  });

  it('renders empty state when no records exist', () => {
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub({}),
      events: bus,
      quickActions: () => [],
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);
    expect(host.textContent).toContain('No usage tracked yet');
  });

  it('paints top-5 most-used live entries in count-desc order', () => {
    const records: Record<string, UsageRecord> = {};
    for (let i = 1; i <= 6; i++) {
      records[serializeKey({ kind: 'quickAction', name: `a${i}` })] = {
        count: i * 5,
        lastUsedAt: NOW,
      };
    }
    const liveActions = [1, 2, 3, 4, 5, 6].map((i) => makeQuickAction(`a${i}`));
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => liveActions,
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const topRows = host.querySelectorAll('.claudian-usage-top-row');
    expect(topRows).toHaveLength(5);
    expect(topRows[0].textContent).toContain('a6');
    expect(topRows[4].textContent).toContain('a2');
  });

  it('hides orphans (usage key with no live action) from all sections', () => {
    const records: Record<string, UsageRecord> = {
      [serializeKey({ kind: 'quickAction', name: 'gone' })]: { count: 10, lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'live' })]: { count: 1, lastUsedAt: NOW },
    };
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => [makeQuickAction('live')],
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    expect(host.textContent).not.toContain('gone');
    expect(host.textContent).toContain('live');
  });

  it('lists drop candidates: count below median AND last used > 30 days ago', () => {
    const liveActions = ['heavy', 'medium', 'stale'].map(makeQuickAction);
    const records: Record<string, UsageRecord> = {
      [serializeKey({ kind: 'quickAction', name: 'heavy' })]:  { count: 100, lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'medium' })]: { count: 50,  lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'stale' })]:  { count: 1,   lastUsedAt: NOW - 60 * ONE_DAY },
    };
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => liveActions,
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const dropRows = host.querySelectorAll('.claudian-usage-drop-row');
    expect(dropRows).toHaveLength(1);
    expect(dropRows[0].textContent).toContain('stale');
  });

  it('clear-all confirm emits usage.cleared via onClearAll callback', () => {
    const onClearAll = jest.fn();
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub({}),
      events: bus,
      quickActions: () => [],
      skills: () => [],
      now: () => NOW,
      onClearAll,
    });
    const host = document.createElement('div');
    tab.render(host);

    const btn = host.querySelector<HTMLButtonElement>('.claudian-usage-clear-all');
    btn?.click();
    expect(onClearAll).toHaveBeenCalled();
  });

  it('separate-provider skill counters render as distinct rows', () => {
    const records: Record<string, UsageRecord> = {
      [serializeKey({ kind: 'skill', name: 'x', providerId: 'claude' })]: { count: 4, lastUsedAt: NOW },
      [serializeKey({ kind: 'skill', name: 'x', providerId: 'codex' })]:  { count: 2, lastUsedAt: NOW },
    };
    const skills = [makeSkill('x', 'claude'), makeSkill('x', 'codex')];
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => [],
      skills: () => skills,
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const rows = host.querySelectorAll('.claudian-usage-all-row');
    expect(rows).toHaveLength(2);
  });

  it('excludes drop candidates whose count equals the median (strict less-than)', () => {
    // Counts [50, 50, 50, 100, 1] sorted → [1, 50, 50, 50, 100]. Median
    // index = floor(5/2) = 2 → counts[2] = 50. The three count==50 rows
    // are stale-eligible but must NOT appear in drop candidates because
    // the rule is `count < median`, not `<=`.
    const names = ['hot', 'med1', 'med2', 'med3', 'low'];
    const liveActions = names.map(makeQuickAction);
    const records: Record<string, UsageRecord> = {
      [serializeKey({ kind: 'quickAction', name: 'hot' })]:  { count: 100, lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'med1' })]: { count: 50,  lastUsedAt: NOW - 60 * ONE_DAY },
      [serializeKey({ kind: 'quickAction', name: 'med2' })]: { count: 50,  lastUsedAt: NOW - 60 * ONE_DAY },
      [serializeKey({ kind: 'quickAction', name: 'med3' })]: { count: 50,  lastUsedAt: NOW - 60 * ONE_DAY },
      [serializeKey({ kind: 'quickAction', name: 'low' })]:  { count: 1,   lastUsedAt: NOW - 60 * ONE_DAY },
    };
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => liveActions,
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const dropRows = host.querySelectorAll('.claudian-usage-drop-row');
    expect(dropRows).toHaveLength(1);
    expect(dropRows[0].textContent).toContain('low');
    for (const row of Array.from(dropRows)) {
      expect(row.textContent).not.toContain('med');
    }
  });

  it('excludes drop candidates whose lastUsedAt is exactly 30 days ago (strict greater-than)', () => {
    // Counts [100, 100, 100, 1, 1] sorted → [1, 1, 100, 100, 100]. Median
    // index = floor(5/2) = 2 → counts[2] = 100. Both count==1 rows pass
    // the count filter; `edge` is dated exactly 30 days back (delta == 30d,
    // rule is `> 30d`, so excluded); `old` is 31 days back and qualifies.
    const names = ['h1', 'h2', 'h3', 'edge', 'old'];
    const liveActions = names.map(makeQuickAction);
    const records: Record<string, UsageRecord> = {
      [serializeKey({ kind: 'quickAction', name: 'h1' })]:   { count: 100, lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'h2' })]:   { count: 100, lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'h3' })]:   { count: 100, lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'edge' })]: { count: 1,   lastUsedAt: NOW - 30 * ONE_DAY },
      [serializeKey({ kind: 'quickAction', name: 'old' })]:  { count: 1,   lastUsedAt: NOW - 31 * ONE_DAY },
    };
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => liveActions,
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const dropRows = host.querySelectorAll('.claudian-usage-drop-row');
    expect(dropRows).toHaveLength(1);
    expect(dropRows[0].textContent).toContain('old');
    for (const row of Array.from(dropRows)) {
      expect(row.textContent).not.toContain('edge');
    }
  });

  it('caps drop candidates at 10 and orders them oldest-first', () => {
    // 12 hot actions (count 100) + 12 stale low-use actions (count 1).
    // 24 total; median index = floor(24/2) = 12 → counts[12] = 100. All
    // 12 stale rows satisfy `count < 100` and `> 30d`; the section caps
    // at 10 and sorts by ascending lastUsedAt (oldest first).
    const liveActions: QuickAction[] = [];
    const records: Record<string, UsageRecord> = {};
    for (let i = 0; i < 12; i++) {
      const hotName = `hot${String(i).padStart(2, '0')}`;
      liveActions.push(makeQuickAction(hotName));
      records[serializeKey({ kind: 'quickAction', name: hotName })] = {
        count: 100,
        lastUsedAt: NOW,
      };
    }
    for (let i = 0; i < 12; i++) {
      const staleName = `stale${String(i).padStart(2, '0')}`;
      liveActions.push(makeQuickAction(staleName));
      records[serializeKey({ kind: 'quickAction', name: staleName })] = {
        count: 1,
        // Larger `i` = older (lower lastUsedAt). Oldest = i==11.
        lastUsedAt: NOW - (40 + i) * ONE_DAY,
      };
    }
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => liveActions,
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const dropRows = host.querySelectorAll('.claudian-usage-drop-row');
    expect(dropRows).toHaveLength(10);
    // Slot 0 = oldest qualifying entry; slot 9 = 10th-oldest. Slots 10–11
    // (stale01, stale00) are dropped by the cap.
    expect(dropRows[0].textContent).toContain('stale11');
    expect(dropRows[9].textContent).toContain('stale02');
  });

  it('re-renders when usage.cleared fires on the bus', () => {
    jest.useFakeTimers();
    try {
      const liveActions = [makeQuickAction('only')];
      let records: Record<string, UsageRecord> = {
        [serializeKey({ kind: 'quickAction', name: 'only' })]: { count: 3, lastUsedAt: NOW },
      };
      const tab = new UsageStatsTab({
        tracker: { getAll: () => new Map(Object.entries(records)) },
        events: bus,
        quickActions: () => liveActions,
        skills: () => [],
        now: () => NOW,
        onClearAll: jest.fn(),
      });
      const host = document.createElement('div');
      tab.render(host);
      expect(host.textContent).toContain('only');

      // Simulate UsageTracker clearing its in-memory map, then emit the bus event.
      records = {};
      bus.emit('usage.cleared');
      jest.advanceTimersByTime(500);

      expect(host.textContent).toContain('No usage tracked yet');
      expect(host.textContent).not.toContain('only');
    } finally {
      jest.useRealTimers();
    }
  });
});
