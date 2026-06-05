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
});
