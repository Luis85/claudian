import {
  getLaneForStatus,
  loadBoardConfig,
  writeBoardQueuePaused,
  writeLaneCollapsed,
} from '../../../../../src/features/tasks/config/BoardConfigStore';
import { DEFAULT_BOARD_CONFIG } from '../../../../../src/features/tasks/config/boardConfigTypes';

describe('loadBoardConfig', () => {
  it('returns the default config when none is set', () => {
    expect(loadBoardConfig({})).toEqual({ config: DEFAULT_BOARD_CONFIG, errors: [] });
  });

  it('keeps a valid custom config and normalizes defaults', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [{ id: 'a', title: 'A', statuses: ['ready', 'running'], definitionOfReady: ['x'] }],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(errors).toEqual([]);
    expect(config.lanes[0].statuses).toEqual(['ready', 'running']);
    expect(config.lanes[0].visible).toBe(true);
    expect(config.lanes[0].definitionOfDone).toEqual([]);
  });

  it('preserves user intent across duplicate statuses with a warning per duplicate', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready', 'running'] },
        { id: 'b', title: 'B', statuses: ['ready', 'done'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    // Tolerant store: the user's lanes survive verbatim so the lane editor can
    // show inline duplicate hints. Earlier behavior fell back to
    // DEFAULT_BOARD_CONFIG, which silently reverted the user's edits on every
    // settings re-render and made the UI feel frozen.
    expect(config.lanes.map((lane) => lane.id)).toEqual(['a', 'b']);
    expect(config.lanes[0].statuses).toEqual(['ready', 'running']);
    expect(config.lanes[1].statuses).toEqual(['ready', 'done']);
    expect(errors.some((e) => e.includes('"ready"') && e.includes('more than one lane'))).toBe(true);
  });

  it('reports exactly one warning per cross-lane duplicate without collapsing lanes', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready', 'running'] },
        { id: 'b', title: 'B', statuses: ['ready', 'running', 'done'] },
        { id: 'c', title: 'C', statuses: ['ready', 'failed'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes.map((lane) => lane.statuses)).toEqual([
      ['ready', 'running'],
      ['ready', 'running', 'done'],
      ['ready', 'failed'],
    ]);
    // Exactly 3 warnings expected: lane b duplicates `ready` and `running`,
    // lane c duplicates `ready`. Stricter than `>= 3` so a future regression
    // that emits per-status-per-lane (or over-counts intra-lane) is caught.
    expect(errors.length).toBe(3);
  });

  it('collapses intra-lane duplicate statuses silently and still detects later cross-lane duplicates', () => {
    // A hand-edited config with `['ready', 'ready']` in one lane used to poison
    // the cross-lane duplicate detector: the first occurrence pushed a warning
    // and skipped `seen.add(...)`, so a later legitimate lane claiming `ready`
    // was wrongly accepted as unique. Now `normalizeLane` dedupes intra-lane
    // first, and `seen.add(...)` runs unconditionally.
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready', 'ready', 'running'] },
        { id: 'b', title: 'B', statuses: ['ready'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes[0].statuses).toEqual(['ready', 'running']);
    expect(config.lanes[1].statuses).toEqual(['ready']);
    // Exactly one cross-lane warning: lane b's `ready` conflicts with lane a.
    // The intra-lane duplicate must NOT show up as a warning of its own.
    const dupWarnings = errors.filter((e) => e.includes('more than one lane'));
    expect(dupWarnings).toHaveLength(1);
    expect(dupWarnings[0]).toContain('ready');
  });

  it('falls back to default when a lane has no title', () => {
    const agentBoardConfig = { schemaVersion: 1, lanes: [{ id: 'a', title: '', statuses: ['ready'] }] };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('drops unknown statuses with a warning but keeps the config', () => {
    const agentBoardConfig = { schemaVersion: 1, lanes: [{ id: 'a', title: 'A', statuses: ['ready', 'bogus'] }] };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes[0].statuses).toEqual(['ready']);
    expect(errors.some((e) => e.includes('bogus'))).toBe(true);
  });

  it('accepts an explicit empty lanes array', () => {
    const { config, errors } = loadBoardConfig({ agentBoardConfig: { schemaVersion: 1, lanes: [] } });
    expect(config.lanes).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('returns a frozen default that callers cannot mutate', () => {
    const { config } = loadBoardConfig({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => config.lanes.push(config.lanes[0])).toThrow();
    expect(DEFAULT_BOARD_CONFIG.lanes).toHaveLength(11);
  });

  it('injects collapsible/collapsed defaults for legacy lanes', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [{ id: 'a', title: 'A', statuses: ['ready'] }],
    };
    const { config } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes[0].collapsible).toBe(false);
    expect(config.lanes[0].collapsed).toBe(false);
  });

  it('preserves explicit collapsible/collapsed values', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready'], collapsible: true, collapsed: true },
      ],
    };
    const { config } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes[0].collapsible).toBe(true);
    expect(config.lanes[0].collapsed).toBe(true);
  });

  it('clears orphan collapsed=true when collapsible=false on disk', () => {
    // Defensive: a stale config (Collapsible un-checked without a writeLaneCollapsed
    // round-trip) must not be able to resurrect a collapsed strip after load.
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'a', title: 'A', statuses: ['ready'], collapsible: false, collapsed: true },
      ],
    };
    const { config } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes[0].collapsible).toBe(false);
    expect(config.lanes[0].collapsed).toBe(false);
  });

  it('falls back to default when two lanes share an id', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'dup', title: 'A', statuses: ['ready'] },
        { id: 'dup', title: 'B', statuses: ['done'] },
      ],
    };
    const { config, errors } = loadBoardConfig({ agentBoardConfig });
    expect(config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(errors.some((e) => e.includes('Lane id "dup"'))).toBe(true);
  });
});

describe('loadBoardConfig — queue.paused', () => {
  it('defaults queue.paused to false when settings have no queue block', () => {
    const { config } = loadBoardConfig({
      agentBoardConfig: {
        lanes: [{ id: 'inbox', title: 'Inbox', statuses: ['inbox'] }],
      },
    });
    expect(config.queue).toEqual({ paused: false });
  });

  it('round-trips queue.paused=true from settings', () => {
    const { config } = loadBoardConfig({
      agentBoardConfig: {
        lanes: [{ id: 'inbox', title: 'Inbox', statuses: ['inbox'] }],
        queue: { paused: true },
      },
    });
    expect(config.queue).toEqual({ paused: true });
  });

  it('coerces malformed queue block to default', () => {
    const { config } = loadBoardConfig({
      agentBoardConfig: {
        lanes: [{ id: 'inbox', title: 'Inbox', statuses: ['inbox'] }],
        queue: 'nope',
      },
    });
    expect(config.queue).toEqual({ paused: false });
  });

  it('keeps default lanes but preserves queue.paused when lanes are absent', () => {
    const { config } = loadBoardConfig({ agentBoardConfig: { queue: { paused: true } } });
    expect(config.lanes.map((lane) => lane.id)).toEqual(
      DEFAULT_BOARD_CONFIG.lanes.map((lane) => lane.id),
    );
    expect(config.queue).toEqual({ paused: true });
  });

  it('preserves queue.paused when falling back from a malformed lane', () => {
    // A lane edited to a blank title fails validation; the board reverts to
    // default lanes, but the user's pause must survive or the queue silently
    // resumes auto-starting work orders.
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [{ id: 'a', title: '', statuses: ['ready'] }],
      queue: { paused: true },
    };
    const { config } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes.map((lane) => lane.id)).toEqual(
      DEFAULT_BOARD_CONFIG.lanes.map((lane) => lane.id),
    );
    expect(config.queue).toEqual({ paused: true });
  });

  it('preserves queue.paused when falling back from duplicate lane ids', () => {
    const agentBoardConfig = {
      schemaVersion: 1,
      lanes: [
        { id: 'dup', title: 'A', statuses: ['ready'] },
        { id: 'dup', title: 'B', statuses: ['done'] },
      ],
      queue: { paused: true },
    };
    const { config } = loadBoardConfig({ agentBoardConfig });
    expect(config.lanes.map((lane) => lane.id)).toEqual(
      DEFAULT_BOARD_CONFIG.lanes.map((lane) => lane.id),
    );
    expect(config.queue).toEqual({ paused: true });
  });
});

describe('writeBoardQueuePaused', () => {
  it('sets queue.paused on the settings object in place', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: { lanes: [], queue: { paused: false } },
    };
    writeBoardQueuePaused(settings, true);
    expect(settings.agentBoardConfig).toEqual({
      lanes: [],
      queue: { paused: true },
    });
  });

  it('creates the queue block if missing', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: { lanes: [] },
    };
    writeBoardQueuePaused(settings, true);
    expect(settings.agentBoardConfig).toEqual({
      lanes: [],
      queue: { paused: true },
    });
  });

  it('persists only the queue flag (no fabricated lanes) when no config exists', () => {
    const settings: Record<string, unknown> = {};
    writeBoardQueuePaused(settings, true);
    expect(settings.agentBoardConfig).toEqual({ queue: { paused: true } });
    // Regression: persisting the queue flag on a fresh vault must not collapse
    // the board to zero lanes — loadBoardConfig still restores the defaults.
    const { config } = loadBoardConfig(settings);
    expect(config.queue).toEqual({ paused: true });
    expect(config.lanes.map((lane) => lane.id)).toEqual(
      DEFAULT_BOARD_CONFIG.lanes.map((lane) => lane.id),
    );
  });
});

describe('writeLaneCollapsed', () => {
  it('sets collapsed=true on the target lane only', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: {
        schemaVersion: 1,
        lanes: [
          { id: 'a', title: 'A', statuses: ['ready'], collapsible: true, collapsed: false },
          { id: 'b', title: 'B', statuses: ['running'], collapsible: true, collapsed: false },
        ],
      },
    };
    writeLaneCollapsed(settings, 'a', true);
    const stored = (settings.agentBoardConfig as { lanes: Array<{ id: string; collapsed: boolean }> }).lanes;
    expect(stored.find((lane) => lane.id === 'a')?.collapsed).toBe(true);
    expect(stored.find((lane) => lane.id === 'b')?.collapsed).toBe(false);
  });

  it('is a no-op for an unknown lane id', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: {
        schemaVersion: 1,
        lanes: [{ id: 'a', title: 'A', statuses: ['ready'], collapsible: true, collapsed: false }],
      },
    };
    const before = JSON.stringify(settings.agentBoardConfig);
    writeLaneCollapsed(settings, 'ghost', true);
    expect(JSON.stringify(settings.agentBoardConfig)).toBe(before);
  });

  it('refuses to collapse a non-collapsible lane', () => {
    const settings: Record<string, unknown> = {
      agentBoardConfig: {
        schemaVersion: 1,
        lanes: [{ id: 'a', title: 'A', statuses: ['ready'], collapsible: false, collapsed: false }],
      },
    };
    writeLaneCollapsed(settings, 'a', true);
    const stored = (settings.agentBoardConfig as { lanes: Array<{ id: string; collapsed: boolean }> }).lanes;
    expect(stored[0].collapsed).toBe(false);
  });
});

describe('getLaneForStatus', () => {
  it('finds the lane owning a status, else null', () => {
    expect(getLaneForStatus(DEFAULT_BOARD_CONFIG, 'review')?.id).toBe('review');
  });

  it('returns null when no lane owns the status', () => {
    const config = {
      schemaVersion: 1 as const,
      lanes: [{ id: 'a', title: 'A', statuses: ['ready' as const], visible: true, definitionOfReady: [], definitionOfDone: [], collapsible: false, collapsed: false }],
    };
    expect(getLaneForStatus(config, 'done')).toBeNull();
  });
});
